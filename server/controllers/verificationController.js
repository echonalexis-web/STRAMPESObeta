const User = require("../models/User");
const { createNotificationForUser } = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");
const { postSystemMessage } = require("./messageController");

// ---------------------------------------------------------------------------
// Employer submits their uploaded documents to LMD Admin for verification.
// The documents themselves are uploaded via the profile update endpoint; this
// route only flips the account into the review queue and fans out the
// notifications / confirmation described in the feature spec.
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
          "Upload both your business permit and DTI/SEC registration in Profile → Documents, save, then submit for review.",
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

    const io = req.app.get("io");
    const companyLabel = user.companyName || user.name || "An employer";

    // Notify every admin that a request is waiting.
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
        })
      )
    );

    // Confirmation prompt for the employer.
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
// Staff read the pending-employer queue. Both admin and superadmin may list it
// (superadmin gets a read-only view); only admin may act on an entry.
// ---------------------------------------------------------------------------
exports.getVerificationQueue = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
    const search = String(req.query.search || "").trim();

    const filter = {
      role: "employer",
      verificationStatus: "pending",
    };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
      ];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select(
          "name email companyName verificationStatus businessPermitUrl registrationDocUrl verificationNote verificationSubmittedAt createdAt"
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      items: users,
      total,
      currentPage: page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load verification queue" });
  }
};

// ---------------------------------------------------------------------------
// Admin approves or rejects an employer's submission. Accepts an
// approve/reject verb ({ decision, note }) or an explicit status (legacy).
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

    const trimmedNote = typeof note === "string" ? note.trim().slice(0, 500) : "";
    if (verificationStatus === "rejected" && !trimmedNote) {
      return res.status(400).json({ message: "A reason is required when rejecting a submission." });
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
      id,
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== "employer") {
      return res.status(400).json({ message: "Only employers can be verified" });
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
      rejected: `Your verification was not approved. Reason: ${trimmedNote} — update your documents in Profile → Documents and submit again.`,
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

    return res.json({ message: "Employer verification updated", user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update verification" });
  }
};
