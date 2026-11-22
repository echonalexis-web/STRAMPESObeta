const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const { logAuditEvent } = require("../services/auditService");
const { runPostCommit } = require("../utils/postCommit");
const { createNotificationForUser } = require("../services/notificationService");
const { forceLogout } = require("../services/sessionService");
const { sendError } = require("../utils/sendError");
const invites = require("../services/staffInviteService");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A readable one-time password: 4 groups of 4 unambiguous characters, e.g.
// "K7PF-3RXM-9TQW-2HYD". Used only by "reset password" below; provisioning a new
// staff account no longer generates or shows any password (see createAdmin).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const generateTempPassword = () => {
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
};

// Shape an admin document for the console list. Additions only: `accountStatus` and
// `invite` are new. Never the token, its hash or the password.
const toAdminView = (u, inviteExtras) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  staffNote: u.staffNote || null,
  isActive: u.isActive !== false,
  mustChangePassword: u.mustChangePassword === true,
  lastLoginAt: u.lastLoginAt || null,
  createdAt: u.createdAt,
  accountStatus: u.accountStatus || "active",
  invite: invites.inviteView(u, inviteExtras),
});

// Fields the console reads from an invite; the token hash is deliberately absent.
const INVITE_FIELDS =
  "staffInvite.status staffInvite.expiresAt staffInvite.sentAt staffInvite.lastSentAt staffInvite.resendCount staffInvite.activatedAt staffInvite.outboxId staffInvite.queueFailed";

// The staff roles a superadmin may provision. "staff_moderator" is the PESO staff
// role and is stored as the existing "admin" role. Superadmin is never an option.
const PROVISIONABLE_ROLES = ["admin", "staff_moderator"];
const NAME_MAX = 100;
const POSITION_MAX = 120;

const fieldError = (res, field, message, status = 400, code) =>
  res.status(status).json({ message, field, ...(code ? { code } : {}) });

const pendingResponse = (res) =>
  res.status(409).json({
    code: "PENDING_ACTIVATION",
    message: "This account has not been activated yet. Resend or cancel the invite instead.",
  });

const inviterNameOf = async (userId) => {
  try {
    const me = await User.findById(userId).select("name").lean();
    return (me && me.name) || "A superadmin";
  } catch {
    return "A superadmin";
  }
};

// Queues the invite email for `admin` and records where it went. A queue failure
// is audited and returned as emailStatus "failed", never thrown.
const sendInviteEmail = async ({ req, admin, rawToken, expiresAt }) => {
  const inviterName = await inviterNameOf(req.user.id);
  const result = await invites.queueInviteEmail({
    user: admin,
    rawToken,
    expiresAt,
    inviterName,
    actorId: req.user.id,
  });
  if (result.queued) {
    await User.updateOne({ _id: admin._id }, { $set: { "staffInvite.outboxId": result.outboxId } });
    return { emailStatus: "queued", outboxId: result.outboxId };
  }
  await User.updateOne({ _id: admin._id }, { $set: { "staffInvite.queueFailed": true } });
  await logAuditEvent({
    req,
    actorId: req.user.id,
    actorRole: "superadmin",
    action: "staff.invite.failed",
    targetUserId: admin._id,
    targetType: "user",
    targetId: String(admin._id),
    severity: "warning",
    metadata: { stage: "queue" },
  });
  return { emailStatus: "failed", outboxId: null };
};

// GET /superadmin/admins — every LMDPESO staff (admin) account.
exports.listAdmins = async (req, res) => {
  try {
    const admins = await User.find({ role: "admin" })
      .select(`name email staffNote isActive mustChangePassword lastLoginAt createdAt accountStatus ${INVITE_FIELDS}`)
      .sort({ createdAt: -1 });
    const { cooldownSeconds, expiryHours } = await invites.getInviteSettings();
    const statuses = await invites.emailStatusFor(admins.filter((a) => a.accountStatus === "pending_activation"));
    return res.json({
      admins: admins.map((a) =>
        toAdminView(a, { emailStatus: statuses.get(String(a._id)) || null, cooldownSeconds })
      ),
      inviteSettings: { expiryHours, cooldownSeconds, maxResends: invites.MAX_RESENDS },
    });
  } catch (error) {
    return sendError(res, error, "Failed to load admin accounts");
  }
};

// POST /superadmin/admins — provision a staff account.
// Body: { name, email, position, role? }. The account is created "pending
// activation" with a password nobody knows and the owner is emailed a one-time
// activation link. No password is generated, shown, emailed or logged.
exports.createAdmin = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    // `staffNote` is the legacy name of the same free-text field.
    const position = String(req.body.position || "").trim();
    const legacyNote = String(req.body.staffNote || "").trim();
    const role = String(req.body.role || "admin").trim().toLowerCase();

    if (!name) return fieldError(res, "name", "Enter the staff member's name.");
    if (name.length > NAME_MAX) return fieldError(res, "name", `The name must be ${NAME_MAX} characters or fewer.`);
    if (!EMAIL_RE.test(email)) return fieldError(res, "email", "Enter a valid email address.");
    if (!position && !legacyNote) {
      return fieldError(res, "position", "Add the person's PESO position or office.");
    }
    if (position.length > POSITION_MAX) {
      return fieldError(res, "position", `The position must be ${POSITION_MAX} characters or fewer.`);
    }
    if (!PROVISIONABLE_ROLES.includes(role)) {
      return fieldError(res, "role", "Choose a valid staff role.");
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return fieldError(res, "email", "An account with that email already exists.", 400, "EMAIL_EXISTS");
    }

    const { expiryHours } = await invites.getInviteSettings();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000);
    const rawToken = invites.newToken();
    // Nobody ever sees or knows this value: the account cannot sign in until its
    // owner chooses a password from the emailed link.
    const hashed = await bcrypt.hash(invites.unusablePasswordValue(), 10);

    let admin;
    try {
      admin = await User.create({
        name,
        email,
        password: hashed,
        role: "admin",
        isActive: false,
        accountStatus: "pending_activation",
        mustChangePassword: false,
        createdBySuperadmin: req.user.id,
        // "Full name, Position" keeps the report "Prepared by" block consistent.
        staffNote: position ? `${name}, ${position}` : legacyNote,
        hasCompletedOnboarding: true,
        onboardingComplete: true,
        staffInvite: {
          tokenHash: invites.hashToken(rawToken),
          status: "pending",
          expiresAt,
          sentAt: now,
          lastSentAt: now,
          resendCount: 0,
        },
      });
    } catch (createError) {
      // Two requests for the same email raced: the unique index decided.
      if (createError && createError.code === 11000) {
        return fieldError(res, "email", "An account with that email already exists.", 400, "EMAIL_EXISTS");
      }
      throw createError;
    }

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: "staff.account.provisioned",
      targetUserId: admin._id,
      targetType: "user",
      targetId: String(admin._id),
      severity: "critical",
      metadata: { email, role: "admin" },
    });

    const delivery = await sendInviteEmail({ req, admin, rawToken, expiresAt });

    return res.status(201).json({
      message:
        delivery.emailStatus === "failed"
          ? "Account created, but the invitation email could not be queued. Use Resend to try again."
          : "Account created. An activation email is on its way.",
      admin: toAdminView(admin, { emailStatus: delivery.emailStatus }),
      emailStatus: delivery.emailStatus,
    });
  } catch (error) {
    return sendError(res, error, "Failed to create admin account");
  }
};

// POST /superadmin/admins/:id/resend-invite — a fresh link; the old one stops
// working at once. One atomic update enforces pending state, cooldown and cap.
exports.resendInvite = async (req, res) => {
  try {
    const { id } = req.params;
    const { expiryHours, cooldownSeconds } = await invites.getInviteSettings();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000);
    const rawToken = invites.newToken();

    const admin = await User.findOneAndUpdate(
      {
        _id: id,
        role: "admin",
        accountStatus: "pending_activation",
        deletedAt: null,
        "staffInvite.status": "pending",
        "staffInvite.lastSentAt": { $lte: new Date(now.getTime() - cooldownSeconds * 1000) },
        "staffInvite.resendCount": { $lt: invites.MAX_RESENDS },
      },
      {
        $set: {
          "staffInvite.tokenHash": invites.hashToken(rawToken),
          "staffInvite.expiresAt": expiresAt,
          "staffInvite.sentAt": now,
          "staffInvite.lastSentAt": now,
        },
        $inc: { "staffInvite.resendCount": 1 },
        $unset: { "staffInvite.queueFailed": "" },
      },
      { new: true }
    ).select(`name email accountStatus ${INVITE_FIELDS}`);

    if (!admin) {
      // Nothing was changed: say why, without revealing anything else.
      const current = await User.findOne({ _id: id, role: "admin" }).select(
        "accountStatus deletedAt staffInvite.status staffInvite.lastSentAt staffInvite.resendCount"
      );
      if (!current || current.deletedAt) return res.status(404).json({ message: "Admin account not found" });
      const invite = current.staffInvite || {};
      if (current.accountStatus !== "pending_activation" || invite.status !== "pending") {
        return res.status(409).json({
          code: "NOT_PENDING",
          message: "This account is not waiting for activation.",
        });
      }
      if ((invite.resendCount || 0) >= invites.MAX_RESENDS) {
        return res.status(429).json({
          code: "RESEND_LIMIT",
          message: "This invite has been resent too many times. Cancel it and provision the account again.",
        });
      }
      const lastSent = invite.lastSentAt ? new Date(invite.lastSentAt).getTime() : 0;
      const retryAfterSeconds = Math.max(1, Math.ceil((lastSent + cooldownSeconds * 1000 - now.getTime()) / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        code: "RESEND_COOLDOWN",
        retryAfterSeconds,
        message: `Wait ${retryAfterSeconds} seconds before sending another invite.`,
      });
    }

    // The new link is the only valid one: drop any older invite email still waiting.
    await invites.suppressQueuedInvites(admin._id).catch(() => {});
    const delivery = await sendInviteEmail({ req, admin, rawToken, expiresAt });

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: "staff.invite.resent",
      targetUserId: admin._id,
      targetType: "user",
      targetId: String(admin._id),
      severity: "warning",
      metadata: { resendCount: admin.staffInvite.resendCount },
    });

    return res.json({
      message:
        delivery.emailStatus === "failed"
          ? "A new link was created, but the email could not be queued. Try Resend again."
          : "A new activation email is on its way. The previous link no longer works.",
      admin: toAdminView(admin, { emailStatus: delivery.emailStatus, cooldownSeconds }),
      emailStatus: delivery.emailStatus,
    });
  } catch (error) {
    return sendError(res, error, "Failed to resend the invite");
  }
};

// DELETE /superadmin/admins/:id/invite — cancel a pending invite. The account
// never signed in and holds no data, so the stub is removed; the link dies with it.
exports.cancelInvite = async (req, res) => {
  try {
    const { id } = req.params;
    const removed = await User.findOneAndDelete({
      _id: id,
      role: "admin",
      accountStatus: "pending_activation",
      deletedAt: null,
      "staffInvite.status": "pending",
    }).select("name email");

    if (!removed) {
      const current = await User.findOne({ _id: id, role: "admin" }).select("accountStatus");
      if (!current) return res.status(404).json({ message: "Admin account not found" });
      return res.status(409).json({
        code: "NOT_PENDING",
        message: "Only an account that is still waiting for activation can be cancelled.",
      });
    }

    await invites.suppressQueuedInvites(removed._id).catch(() => {});
    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: "staff.invite.revoked",
      targetUserId: removed._id,
      targetType: "user",
      targetId: String(removed._id),
      severity: "warning",
      metadata: { email: removed.email },
    });

    return res.json({ message: "Invite cancelled and the pending account removed." });
  } catch (error) {
    return sendError(res, error, "Failed to cancel the invite");
  }
};

// PATCH /superadmin/admins/:id/active — enable or disable an admin account.
// Body: { active: boolean }.
exports.setAdminActive = async (req, res) => {
  try {
    const { id } = req.params;
    const active = req.body.active === true || req.body.active === "true";

    const admin = await User.findById(id);
    if (!admin || admin.role !== "admin") {
      return res.status(404).json({ message: "Admin account not found" });
    }
    if (admin.accountStatus === "pending_activation") return pendingResponse(res);

    admin.isActive = active;
    admin.accountStatus = active ? "active" : "suspended";
    admin.suspensionReason = active ? null : "Disabled by the system superadmin";
    admin.suspendedAt = active ? null : new Date();
    admin.suspendedBy = active ? null : req.user.id;
    // validateModifiedOnly — see authController.js's note above
    // issueEmailVerification.
    await admin.save({ validateModifiedOnly: true });

    if (!active) {
      // Staff accounts get the "disabled" code, not "suspended" — matching
      // verifyToken's own distinction, which routes admin/superadmin away
      // from the jobseeker/employer appeal wall.
      forceLogout(req.app.get("io"), admin._id, {
        code: "ACCOUNT_DISABLED",
        message: "This staff account has been disabled by the system superadmin.",
      });
    }

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: active ? "superadmin.admin.enabled" : "superadmin.admin.disabled",
      targetUserId: admin._id,
      targetType: "user",
      targetId: String(admin._id),
      severity: "critical",
    });

    return res.json({
      message: active ? "Admin account enabled." : "Admin account disabled.",
      admin: toAdminView(admin),
    });
  } catch (error) {
    return sendError(res, error, "Failed to update admin account");
  }
};

// POST /superadmin/admins/:id/reset-password — issue a fresh one-time password.
exports.resetAdminPassword = async (req, res) => {
  try {
    const { id } = req.params;

    const admin = await User.findById(id);
    if (!admin || admin.role !== "admin") {
      return res.status(404).json({ message: "Admin account not found" });
    }
    if (admin.accountStatus === "pending_activation") return pendingResponse(res);

    const tempPassword = generateTempPassword();
    admin.password = await bcrypt.hash(tempPassword, 10);
    admin.mustChangePassword = true;
    // Invalidates any token this admin already holds.
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    // validateModifiedOnly — see authController.js's note above
    // issueEmailVerification.
    await admin.save({ validateModifiedOnly: true });

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: "superadmin.admin.password_reset",
      targetUserId: admin._id,
      targetType: "user",
      targetId: String(admin._id),
      severity: "critical",
    });

    return res.json({ message: "Temporary password issued.", tempPassword });
  } catch (error) {
    return sendError(res, error, "Failed to reset password");
  }
};

// DELETE /superadmin/jobs/:id — permanent policy-violation takedown.
// Hard-removes the vacancy and every application to it. Irreversible; this is
// deliberately superadmin-only (PESO admins can only close/reject a job).
exports.deleteJob = async (req, res) => {
  try {
    const { id } = req.params;
    const reason = String(req.body.reason || "").trim();

    const job = await JobVacancy.findById(id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    const removedApplications = await JobApplication.countDocuments({ vacancy: job._id });

    await Promise.all([
      JobApplication.deleteMany({ vacancy: job._id }),
      JobVacancy.findByIdAndDelete(job._id),
    ]);

    // The job is already deleted; audit and notification are best-effort.
    const postCommitCtx = { req, resourceType: "job", resourceId: job._id };
    await runPostCommit("job_takedown.audit", postCommitCtx, () => logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: "superadmin.job.policy_takedown",
      targetType: "job",
      targetId: String(job._id),
      severity: "critical",
      metadata: {
        title: job.title,
        employer: String(job.employer || ""),
        reason: reason || null,
        removedApplications,
      },
    }));

    if (job.employer) {
      await runPostCommit("job_takedown.notify_employer", postCommitCtx, () => createNotificationForUser({
        recipientId: job.employer,
        actorId: req.user.id,
        type: "admin_action",
        title: "Your job posting was removed",
        message: reason
          ? `"${job.title}" was permanently removed for a policy violation: ${reason}`
          : `"${job.title}" was permanently removed for a policy violation.`,
        relatedEntityType: "job",
        io: req.app.get("io"),
      }));
    }

    return res.json({ message: "Job permanently removed.", removedApplications });
  } catch (error) {
    return sendError(res, error, "Failed to remove job");
  }
};
