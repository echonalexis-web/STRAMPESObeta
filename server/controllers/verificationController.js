const User = require("../models/User");
const { createNotificationForUser } = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");
const { postSystemMessage } = require("./messageController");
const { escapeRegex } = require("../utils/sanitize");

// ---------------------------------------------------------------------------
// Shared helpers — submission-received fan-out and the approve/reject core,
// factored out so every entry point (the legacy self-only routes and the
// employer/admin-id-scoped routes below) behaves identically.
// ---------------------------------------------------------------------------
const notifySubmissionReceived = async (user, req) => {
  const io = req.app.get("io");
  const companyLabel = user.companyName || user.name || "An employer";
  const userId = user._id;

  const admins = await User.find({ role: "admin" }).select("_id");
  await Promise.all(
    admins.map((admin) =>
      createNotificationForUser({
        recipientId: admin._id,
        actorId: userId,
        type: "admin_action",
        title: "Employer verification request",
        message: `${companyLabel} submitted documents for verification review.`,
        relatedEntityType: "user",
        relatedEntityId: userId,
        actionUrl: "/admin/verification",
        metadata: { verificationStatus: "pending" },
        io,
        preferenceKey: "notifyVerificationRequest",
      })
    )
  );

  await createNotificationForUser({
    recipientId: userId,
    type: "admin_action",
    title: "Documents submitted for review",
    message:
      "Your verification documents were received. LMD Admin will review them and message you with the result.",
    relatedEntityType: "user",
    relatedEntityId: userId,
    actionUrl: "/employer",
    metadata: { verificationStatus: "pending" },
    io,
  });
};

// Applies an approve/reject/reset decision to one employer, writes the audit
// event + notification + message, and returns the updated user. Returns
// { error: { status, message } } instead of throwing so callers can map it
// straight onto a response.
const applyVerificationDecision = async ({ userId, verificationStatus, note, req }) => {
  const trimmedNote = typeof note === "string" ? note.trim().slice(0, 500) : "";
  if (verificationStatus === "rejected" && !trimmedNote) {
    return { error: { status: 400, message: "A reason is required when rejecting a submission." } };
  }

  const update = {
    verificationStatus,
    verificationReviewedAt: new Date(),
    verificationReviewedBy: req.user.id,
  };
  if (verificationStatus === "rejected") update.verificationNote = trimmedNote;
  if (verificationStatus === "verified") update.verificationNote = null;

  // $set only these fields so validation on unrelated fields (companySize) is skipped.
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: update },
    { new: true, runValidators: true }
  );

  if (!user) {
    return { error: { status: 404, message: "User not found" } };
  }
  if (user.role !== "employer") {
    return { error: { status: 400, message: "Only employers can be verified" } };
  }

  await logAuditEvent({
    req,
    actorId: req.user.id,
    actorRole: req.user.role,
    action: "admin.user.verification_updated",
    targetUserId: user._id,
    targetType: "user",
    targetId: String(user._id),
    severity: verificationStatus === "verified" ? "info" : "warning",
    metadata: { verificationStatus, note: trimmedNote || undefined },
  });

  const io = req.app.get("io");
  const verificationMessages = {
    verified: "Your employer account has been verified. You can now post jobs.",
    rejected: `Your verification was not approved. Reason: ${trimmedNote} — update your documents in Profile → Verification and submit again.`,
    pending: "Your employer verification is under review.",
    unverified: "Your employer verification status was reset. Please re-submit your documents.",
  };
  const resultMessage =
    verificationMessages[verificationStatus] || "Your employer verification status was updated.";

  await createNotificationForUser({
    recipientId: user._id,
    actorId: req.user.id,
    type: "admin_action",
    title: "Employer verification updated",
    message: resultMessage,
    relatedEntityType: "user",
    relatedEntityId: user._id,
    actionUrl: "/employer",
    metadata: { verificationStatus },
    io,
  });

  // Deliver the decision into a message thread the employer can reply to.
  if (["verified", "rejected"].includes(verificationStatus)) {
    try {
      await postSystemMessage({
        fromUserId: req.user.id,
        toUserId: user._id,
        content: resultMessage,
        io,
      });
    } catch (msgErr) {
      console.warn("Failed to post verification message:", msgErr.message);
    }
  }

  return { user, verificationStatus, note: trimmedNote };
};

// ---------------------------------------------------------------------------
// Employer submits their uploaded documents to LMD Admin for verification.
// Legacy self-only route (POST /users/verification/submit) — the documents
// themselves are uploaded separately via the profile update endpoint; this
// route only flips the account into the review queue.
// ---------------------------------------------------------------------------
exports.submitEmployerVerification = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const user = await User.findById(userId).select(
      "role name companyName businessPermitUrl registrationDocUrl verificationStatus"
    );

    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "employer") {
      return res.status(403).json({ message: "Only employers can submit verification documents." });
    }
    if (!user.businessPermitUrl || !user.registrationDocUrl) {
      return res.status(400).json({
        message:
          "Upload both your business permit and DTI/SEC registration in Profile → Verification, save, then submit for review.",
      });
    }
    if (user.verificationStatus === "verified") {
      return res.status(400).json({ message: "Your account is already verified." });
    }
    if (user.verificationStatus === "pending") {
      return res.status(400).json({ message: "Your documents are already under review." });
    }

    user.verificationStatus = "pending";
    user.verificationSubmittedAt = new Date();
    user.verificationNote = null;
    await user.save();

    await notifySubmissionReceived(user, req);

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: "employer",
      action: "employer.verification.submitted",
      targetUserId: userId,
      targetType: "user",
      targetId: String(userId),
      severity: "info",
    });

    return res.json({
      message:
        "Your documents have been submitted. LMD Admin will review them and message you with the result.",
      verificationStatus: "pending",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to submit verification" });
  }
};

// ---------------------------------------------------------------------------
// Employer uploads/replaces their profile picture.
// POST /employers/:id/avatar — id-scoped so only the owning employer can act.
// ---------------------------------------------------------------------------
exports.uploadEmployerAvatar = async (req, res) => {
  try {
    const { id } = req.params;
    const actingId = String(req.user.id || req.user._id);

    if (String(id) !== actingId) {
      return res.status(403).json({ message: "You can only update your own profile picture." });
    }
    if (req.user.role !== "employer") {
      return res.status(403).json({ message: "Only employers can use this endpoint." });
    }
    if (!req.file?.storedValue) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const avatarUrl = req.file.storedValue;
    await User.findByIdAndUpdate(id, { profileImage: avatarUrl });

    await logAuditEvent({
      req,
      actorId: id,
      actorRole: "employer",
      action: "user.profile_image.uploaded",
      targetType: "user",
      targetId: String(id),
      severity: "info",
    });

    return res.json({ success: true, avatarUrl });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to upload profile picture" });
  }
};

// ---------------------------------------------------------------------------
// Employer uploads their business permit / registration document (or reuses
// documents already on file) and submits for review in one call.
// POST /employers/:id/verification/submit — id-scoped, form-data files
// "businessPermit" and "registrationDoc".
// ---------------------------------------------------------------------------
exports.submitEmployerVerificationWithDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    const actingId = String(req.user.id || req.user._id);

    if (String(id) !== actingId) {
      return res.status(403).json({ message: "You can only submit your own verification documents." });
    }

    const user = await User.findById(id).select(
      "role name companyName businessPermitUrl registrationDocUrl verificationStatus"
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "employer") {
      return res.status(403).json({ message: "Only employers can submit verification documents." });
    }
    if (user.verificationStatus === "verified") {
      return res.status(400).json({ message: "Your account is already verified." });
    }
    if (user.verificationStatus === "pending") {
      return res.status(400).json({ message: "Your documents are already under review." });
    }

    const files = req.files && !Array.isArray(req.files) ? req.files : {};
    const newPermit = files.businessPermit?.[0]?.storedValue || null;
    const newRegistration = files.registrationDoc?.[0]?.storedValue || null;

    const effectivePermit = newPermit || user.businessPermitUrl;
    const effectiveRegistration = newRegistration || user.registrationDocUrl;

    if (!effectivePermit || !effectiveRegistration) {
      return res.status(400).json({
        message: "Both a business permit and a DTI/SEC registration document are required.",
      });
    }

    if (newPermit) user.businessPermitUrl = newPermit;
    if (newRegistration) user.registrationDocUrl = newRegistration;
    user.verificationStatus = "pending";
    user.verificationSubmittedAt = new Date();
    user.verificationNote = null;
    await user.save();

    await notifySubmissionReceived(user, req);

    await logAuditEvent({
      req,
      actorId: actingId,
      actorRole: "employer",
      action: "employer.verification.submitted",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
    });

    return res.json({
      success: true,
      verificationStatus: "pending",
      businessPermitUrl: user.businessPermitUrl,
      registrationDocUrl: user.registrationDocUrl,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to submit verification" });
  }
};

// ---------------------------------------------------------------------------
// Staff read the employer verification list, filtered by status. Both admin
// and superadmin may list it (superadmin gets a read-only view for every
// status; a plain admin may act only while status="pending" — enforced by
// the route guards, not here). Defaults to "pending" for backward
// compatibility with existing callers that never pass ?status.
// ---------------------------------------------------------------------------
const QUEUE_STATUSES = ["pending", "verified", "rejected", "unverified"];

exports.getVerificationQueue = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
    const search = String(req.query.search || "").trim();
    const status = QUEUE_STATUSES.includes(req.query.status) ? req.query.status : "pending";

    const filter = {
      role: "employer",
      verificationStatus: status,
    };

    if (search) {
      const searchRegex = escapeRegex(search);
      filter.$or = [
        { name: { $regex: searchRegex, $options: "i" } },
        { email: { $regex: searchRegex, $options: "i" } },
        { companyName: { $regex: searchRegex, $options: "i" } },
      ];
    }

    // Pending submissions are queued oldest-review-first by creation time;
    // already-decided employers (verified/rejected) surface the most
    // recently reviewed one first.
    const sort =
      status === "pending" ? { createdAt: -1 } : { verificationReviewedAt: -1, createdAt: -1 };

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select(
          "name email companyName verificationStatus businessPermitUrl registrationDocUrl verificationNote verificationSubmittedAt verificationReviewedAt createdAt"
        )
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      items: users,
      total,
      currentPage: page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      status,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load verification queue" });
  }
};

// ---------------------------------------------------------------------------
// Admin approves or rejects an employer's submission. Accepts an
// approve/reject verb ({ decision, note }) or an explicit status (legacy).
// Legacy combined route: PATCH /verification/:id
// ---------------------------------------------------------------------------
exports.reviewEmployerVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { verificationStatus: rawStatus, decision, note } = req.body;

    let verificationStatus = rawStatus;
    if (decision === "approved") verificationStatus = "verified";
    else if (decision === "rejected") verificationStatus = "rejected";

    if (!["unverified", "pending", "verified", "rejected"].includes(verificationStatus)) {
      return res.status(400).json({ message: "Invalid verification status" });
    }

    const result = await applyVerificationDecision({ userId: id, verificationStatus, note, req });
    if (result.error) return res.status(result.error.status).json({ message: result.error.message });

    return res.json({ message: "Employer verification updated", user: result.user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update verification" });
  }
};

// ---------------------------------------------------------------------------
// Admin-id-scoped approve/reject, matching the documented API contract:
//   POST /admin/employers/:id/verification/approve
//   POST /admin/employers/:id/verification/reject  { reason }
// ---------------------------------------------------------------------------
exports.approveEmployerVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await applyVerificationDecision({
      userId: id,
      verificationStatus: "verified",
      note: "",
      req,
    });
    if (result.error) return res.status(result.error.status).json({ message: result.error.message });

    return res.json({ success: true, verificationStatus: "verified" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to approve verification" });
  }
};

exports.rejectEmployerVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: "A reason is required when rejecting a submission." });
    }

    const result = await applyVerificationDecision({
      userId: id,
      verificationStatus: "rejected",
      note: reason,
      req,
    });
    if (result.error) return res.status(result.error.status).json({ message: result.error.message });

    return res.json({
      success: true,
      verificationStatus: "rejected",
      verificationNote: result.note,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to reject verification" });
  }
};
