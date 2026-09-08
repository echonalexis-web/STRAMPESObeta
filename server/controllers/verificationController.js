const User = require("../models/User");
const { createNotificationForUser } = require("../services/notificationService");
const { logAuditEvent } = require("../services/auditService");

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
          actionUrl: "/admin/users",
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
