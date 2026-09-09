const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser } = require("../services/notificationService");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A readable one-time password: 4 groups of 4 unambiguous characters, e.g.
// "K7PF-3RXM-9TQW-2HYD". The superadmin reads this to the staff member once;
// they are forced to replace it on first sign-in.
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

// Shape an admin document for the console list.
const toAdminView = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  staffNote: u.staffNote || null,
  isActive: u.isActive !== false,
  mustChangePassword: u.mustChangePassword === true,
  lastLoginAt: u.lastLoginAt || null,
  createdAt: u.createdAt,
});

// GET /superadmin/admins — every LMDPESO staff (admin) account.
exports.listAdmins = async (req, res) => {
  try {
    const admins = await User.find({ role: "admin" })
      .select("name email staffNote isActive mustChangePassword lastLoginAt createdAt")
      .sort({ createdAt: -1 });
    return res.json({ admins: admins.map(toAdminView) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load admin accounts" });
  }
};

// POST /superadmin/admins — provision a new admin account.
// Body: { name, email, staffNote }. Returns the one-time temporary password.
exports.createAdmin = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const staffNote = String(req.body.staffNote || "").trim();

    if (!name) return res.status(400).json({ message: "Enter the staff member's name." });
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    if (!staffNote) {
      return res.status(400).json({
        message: "Add a note identifying this person (name and PESO position).",
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "An account with that email already exists." });
    }

    const tempPassword = generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);

    const admin = await User.create({
      name,
      email,
      password: hashed,
      role: "admin",
      mustChangePassword: true,
      createdBySuperadmin: req.user.id,
      staffNote,
      hasCompletedOnboarding: true,
      onboardingComplete: true,
    });

    await logAuditEvent({
      req,
      actorId: req.user.id,
      actorRole: "superadmin",
      action: "superadmin.admin.created",
      targetUserId: admin._id,
      targetType: "user",
      targetId: String(admin._id),
      severity: "critical",
      metadata: { email, staffNote },
    });

    return res.status(201).json({
      message: "Admin account created.",
      admin: toAdminView(admin),
      tempPassword,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to create admin account" });
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

    admin.isActive = active;
    admin.accountStatus = active ? "active" : "suspended";
    admin.suspensionReason = active ? null : "Disabled by the system superadmin";
    admin.suspendedAt = active ? null : new Date();
    admin.suspendedBy = active ? null : req.user.id;
    await admin.save();

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
    return res.status(500).json({ message: error.message || "Failed to update admin account" });
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

    const tempPassword = generateTempPassword();
    admin.password = await bcrypt.hash(tempPassword, 10);
    admin.mustChangePassword = true;
    await admin.save();

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
    return res.status(500).json({ message: error.message || "Failed to reset password" });
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

    await logAuditEvent({
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
    });

    if (job.employer) {
      await createNotificationForUser({
        recipientId: job.employer,
        actorId: req.user.id,
        type: "admin_action",
        title: "Your job posting was removed",
        message: reason
          ? `"${job.title}" was permanently removed for a policy violation: ${reason}`
          : `"${job.title}" was permanently removed for a policy violation.`,
        relatedEntityType: "job",
        io: req.app.get("io"),
      });
    }

    return res.json({ message: "Job permanently removed.", removedApplications });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to remove job" });
  }
};
