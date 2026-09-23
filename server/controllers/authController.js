const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const VALID_INDUSTRIES = require("../data/industries");
const storageService = require("../services/storageService");
const { logAuditEvent } = require("../services/auditService");
const { notifyManyUsers } = require("../services/notificationService");
const { forceLogout } = require("../services/sessionService");
const {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendEmailVerification,
  sendEmailChangeVerification,
  sendEmailChangeAlert,
} = require("../services/mailService");
const { OAuth2Client } = require("google-auth-library");
const { isAdultAge, MIN_ACCOUNT_AGE } = require("../utils/age");
const { normalizeEmail } = require("../utils/normalizeEmail");
const SystemSettings = require("../models/SystemSettings");

// Suspension/ban appeal token lifetime, in days — configurable via
// Settings → System Preferences (superadmin). Falls back to 14 (the
// front-end draft default) if the settings read fails for any reason.
const getAppealWindowDays = async () => {
  try {
    const settings = await SystemSettings.getSingleton();
    const days = Number(settings.appealWindowDays);
    return Number.isFinite(days) && days > 0 ? days : 14;
  } catch {
    return 14;
  }
};

// Where the reset link should point (the SPA). Falls back to the first allowed
// client origin, then localhost dev.
const clientBaseUrl = () =>
  (process.env.APP_URL ||
    (process.env.CLIENT_ORIGINS || "http://localhost:5173").split(",")[0] ||
    "http://localhost:5173")
    .trim()
    .replace(/\/+$/, "");

const PASSWORD_RESET_TTL_MINUTES = 30;
const EMAIL_CHANGE_TTL_MINUTES = 30;
// Longer than the password-reset/email-change links above: verifying a
// registration email isn't a security-sensitive action the way changing a
// password or an email address is, so there's no reason to force a quick
// turnaround.
const EMAIL_VERIFICATION_TTL_HOURS = 24;
// SHA-256 of any link token, so a DB leak can't be replayed against the flow.
const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");
const hashResetToken = hashToken; // kept for existing call sites

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Generates a verification token for `user`, saves it, and emails the link.
// Called right after a password-based registration. Never throws — sendMail
// itself already falls back to a console log instead of throwing, so a dead
// SMTP transport can't fail registration.
// @returns {Promise<string|null>} the dev-mode verify URL (non-production only)
const issueEmailVerification = async (user) => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  user.emailVerificationToken = hashToken(rawToken);
  user.emailVerificationExpires = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
  await user.save();

  const verifyUrl = `${clientBaseUrl()}/confirm-email?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

  await sendEmailVerification({
    to: user.email,
    name: user.name,
    verifyUrl,
    expiresHours: EMAIL_VERIFICATION_TTL_HOURS,
  });

  return process.env.NODE_ENV !== "production" ? verifyUrl : null;
};

// Lazily-built Google OAuth client. GOOGLE_CLIENT_ID is the same Web client ID
// the SPA uses; the ID token's audience is checked against it.
const googleClientId = () => (process.env.GOOGLE_CLIENT_ID || "").trim();
let _googleClient = null;
const getGoogleClient = () => {
  if (!_googleClient) _googleClient = new OAuth2Client(googleClientId());
  return _googleClient;
};

// Bump when the community guidelines / terms change so returning users are
// prompted to re-accept.
const CURRENT_TERMS_VERSION = "2026-01";

// Helper to update or create role profile
const upsertProfile = async (userId, role, data) => {
  let Model = role === "jobseeker" ? JobseekerProfile : EmployerProfile;
  return Model.findOneAndUpdate({ userId }, { $set: data }, { new: true, upsert: true });
};

// Helper to safely parse JSON from string or return default
const parseJSON = (value, fallback = null) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const CLEAR_SENTINELS = new Set(["", "null", "undefined", "remove", "clear"]);

const getDocumentFieldRemovals = (payload = {}) => {
  const removals = {};
  const appendRemoval = (field, value) => {
    if (value === undefined) return;
    const norm = String(value).trim().toLowerCase();
    if (CLEAR_SENTINELS.has(norm) || value === null) {
      removals[field] = null;
    }
  };

  const fieldMap = {
    resumeFile: "resumeFile",
    validIdFile: "validIdFile",
    businessPermit: "businessPermitUrl",
    registrationDoc: "registrationDocUrl",
    resume: "resumeFile",
    supportingDocument: "validIdFile",
  };

  for (const [field, targetField] of Object.entries(fieldMap)) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      appendRemoval(targetField, payload[field]);
    }
  }

  return removals;
};

// ---------- Registration ----------
exports.register = async (req, res) => {
  const { name, password, surname, firstName, middleName, suffix, dateOfBirth } = req.body;
  const email = normalizeEmail(req.body.email);
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already exists" });

    // Age gate: STRAM PESO accounts are for adults only.
    if (dateOfBirth !== undefined && dateOfBirth !== null && dateOfBirth !== "") {
      if (!isAdultAge(dateOfBirth)) {
        return res.status(400).json({
          message: `You must be at least ${MIN_ACCOUNT_AGE} years old to create an account.`,
        });
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    const composedName = [firstName, middleName, surname, suffix].filter(Boolean).join(" ").trim();
    const user = await User.create({
      name: composedName || name,
      surname: surname || null,
      firstName: firstName || null,
      middleName: middleName || null,
      suffix: suffix || null,
      dateOfBirth: dateOfBirth || null,
      email,
      password: hashed,
      role: "jobseeker",
    });

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: "jobseeker",
      action: "auth.user.registered",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
    });

    await JobseekerProfile.create({ userId: user._id });

    user.isEmailVerified = false;
    const devVerifyUrl = await issueEmailVerification(user);

    // Deliberately no session token here: the account exists but stays
    // inert (can't sign in — see the isEmailVerified check in login()) until
    // the verification link is opened. A bogus/typo'd email just never
    // receives that link, so that account can never reach onboarding at all.
    res.status(201).json({
      message: "Account created. Check your email to verify it before signing in.",
      email: user.email,
      ...(devVerifyUrl ? { devVerifyUrl } : {}),
    });
  } catch (error) {
    // A concurrent request can slip past the findOne check above and lose the
    // race to the unique index on email — surface the same clean message
    // instead of a raw duplicate-key error.
    if (error.code === 11000) {
      return res.status(400).json({ message: "Email already exists" });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.registerEmployer = async (req, res) => {
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashed,
      role: "employer",
      // Left at the schema default ("unverified") — "pending" is reserved for
      // once the employer has actually uploaded and submitted their business
      // permit + DTI/SEC registration for review (see
      // submitEmployerVerification). Setting it here meant every new
      // employer landed in the admin verification queue immediately, before
      // they'd submitted anything to review.
    });

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: "employer",
      action: "auth.employer.registered",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
    });

    await EmployerProfile.create({ userId: user._id });

    user.isEmailVerified = false;
    const devVerifyUrl = await issueEmailVerification(user);

    const admins = await User.find({ role: "admin" }).select("_id");
    await notifyManyUsers({
      recipientIds: admins.map((admin) => admin._id),
      actorId: user._id,
      type: "admin_action",
      title: "New employer registered",
      message: `${user.name} registered as an employer. They'll appear in the verification queue once they submit their documents.`,
      relatedEntityType: "user",
      relatedEntityId: user._id,
      actionUrl: "/admin/verification",
      io: req.app.get("io"),
      preferenceKey: "notifyVerificationRequest",
    });

    // Deliberately no session token here — see the matching comment in
    // register(). The employer must verify, then sign in normally before
    // they can reach onboarding or the document-upload/verification step.
    res.status(201).json({
      message: "Employer registered. Check your email to verify it before signing in.",
      email: user.email,
      ...(devVerifyUrl ? { devVerifyUrl } : {}),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Email already exists" });
    }
    res.status(500).json({ message: error.message });
  }
};

// A precomputed hash of an unguessable, never-used password — compared
// against whenever the real lookup fails to find a user (or the user has no
// password set, e.g. a Google-only account). Keeps the login response time
// for "no such account" indistinguishable from "wrong password", instead of
// short-circuiting before the bcrypt cost is paid.
const DUMMY_PASSWORD_HASH = "$2a$10$Lw6.qhsvJZhB3YkGv.m/4uA/edj4yKVYLcOYAkCySmNp6gajYfvdK";

// ---------- Login ----------
exports.login = async (req, res) => {
  const { password } = req.body;
  const email = normalizeEmail(req.body.email);
  try {
    const user = await User.findOne({ email });

    // Same generic message and the same bcrypt work either way, so neither
    // the response text nor the response time discloses whether this email
    // has an account.
    const match = await bcrypt.compare(password || "", user?.password || DUMMY_PASSWORD_HASH);
    if (!user || !match) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    if (user.isActive === false && (user.role === "admin" || user.role === "superadmin")) {
      // Staff accounts are disabled by a superadmin, not moderated — no appeal
      // path, just a plain rejection.
      return res.status(403).json({
        code: "ACCOUNT_DISABLED",
        message: "This staff account has been disabled. Contact the system superadmin.",
      });
    }

    // Self-deactivated from Settings → Danger Zone. Credentials already
    // checked out above, which is the "self-service relogin" the owner used
    // to turn the account back on — reactivate it here and fall through to
    // a normal login, instead of the suspension/appeal wall below.
    let reactivated = false;
    if (user.isActive === false && user.accountStatus === "deactivated") {
      user.isActive = true;
      user.accountStatus = "active";
      user.deactivatedAt = null;
      await user.save();
      reactivated = true;
    }

    if (user.isActive === false) {
      // Credentials are valid but the account is suspended/banned. Issue a
      // narrow "appeal-only" token so the client can render the suspension
      // wall and let the user file an appeal to LMD Admin — nothing else.
      const appealWindowDays = await getAppealWindowDays();
      const appealToken = jwt.sign(
        { id: user._id, scope: "appeal", tokenVersion: user.tokenVersion },
        process.env.JWT_SECRET,
        { expiresIn: `${appealWindowDays}d` }
      );

      return res.status(403).json({
        code: "ACCOUNT_SUSPENDED",
        message: "Your account has been suspended.",
        accountStatus: user.accountStatus === "banned" ? "banned" : "suspended",
        suspensionReason: user.suspensionReason || null,
        suspendedAt: user.suspendedAt || null,
        appealToken,
      });
    }

    // Registration email not yet confirmed. Only ever true for a
    // password-based account explicitly created after this check shipped —
    // see the "no schema default" note on User.isEmailVerified — so this
    // never blocks a pre-existing account or a Google-signed-in one (Google
    // already verified that email; googleAuth() sets this to true).
    if (user.isEmailVerified === false) {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email address before signing in. Check your inbox for the verification link, or request a new one.",
      });
    }

    // Record the sign-in so the superadmin console can flag dormant admin
    // accounts. Fire-and-forget — a write hiccup must not fail a valid login.
    User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).catch(() => {});

    const token = jwt.sign(
      { id: user._id, role: user.role, tokenVersion: user.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        verificationStatus: user.verificationStatus,
        isEmailVerified: user.isEmailVerified !== false,
        hasCompletedOnboarding: user.hasCompletedOnboarding,
        onboardingComplete: user.onboardingComplete,
        acceptedTermsAt: user.acceptedTermsAt,
        termsVersion: user.termsVersion,
        mustChangePassword: user.mustChangePassword === true,
      },
      termsVersion: CURRENT_TERMS_VERSION,
      ...(reactivated ? { reactivated: true } : {}),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Change password for the signed-in user ----------
// Used both for the normal "change my password" action and to clear the
// `mustChangePassword` flag on a superadmin-provisioned admin's first sign-in.
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Your new password must be at least 8 characters." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.password) {
      return res.status(400).json({
        message: 'Set a password first via "Forgot password?" before changing it.',
      });
    }

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ message: "Your current password is incorrect." });

    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ message: "The new password must be different from the current one." });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.mustChangePassword = false;
    // Invalidates every other token issued before this change (other
    // devices/tabs, or a leaked token). The caller's own current token is
    // now stale too, so a fresh one is issued below to keep this session
    // logged in.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    sendPasswordChangedEmail({ to: user.email, name: user.name }).catch(() => {});

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "user.password.changed",
      targetType: "user",
      targetId: String(user._id),
      severity: "warning",
    });

    const token = jwt.sign(
      { id: user._id, role: user.role, tokenVersion: user.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({ message: "Your password has been updated.", token });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not change the password" });
  }
};

// ---------- Forgot password: issue a reset link ----------
exports.forgotPassword = async (req, res) => {
  // Always answer the same way so this endpoint can't be used to probe which
  // emails have accounts.
  const generic = { message: "If that email is registered, a password reset link has been sent." };
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email });
    if (!user) return res.json(generic);

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetToken = hashResetToken(rawToken);
    user.passwordResetExpires = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
    await user.save();

    const resetUrl = `${clientBaseUrl()}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

    await sendPasswordResetEmail({
      to: email,
      name: user.name,
      resetUrl,
      expiresMinutes: PASSWORD_RESET_TTL_MINUTES,
    });

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "auth.password.reset_requested",
      targetType: "user",
      targetId: String(user._id),
      severity: "warning",
    });

    // No mailer yet — surface the link so the flow is usable outside production.
    if (process.env.NODE_ENV !== "production") {
      return res.json({ ...generic, devResetUrl: resetUrl });
    }
    return res.json(generic);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not process the request" });
  }
};

// ---------- Reset password with a valid token ----------
exports.resetPassword = async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!token || !email) {
      return res.status(400).json({ message: "This reset link is incomplete. Request a new one." });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Your new password must be at least 8 characters." });
    }

    const user = await User.findOne({
      email,
      passwordResetToken: hashResetToken(token),
      passwordResetExpires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({
        message: "This reset link is invalid or has expired. Please request a new one.",
      });
    }

    user.password = await bcrypt.hash(password, 10);
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    // Invalidates every token issued before this reset — the reset flow
    // itself sends the user to a fresh login, so there's no "current
    // session" to keep alive here (unlike the self-service changePassword).
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // Security notice to the account's own address (fire-and-forget — a mail
    // hiccup must not fail a completed reset).
    sendPasswordChangedEmail({ to: user.email, name: user.name }).catch(() => {});

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "auth.password.reset",
      targetType: "user",
      targetId: String(user._id),
      severity: "warning",
    });

    return res.json({ message: "Your password has been reset. You can now sign in." });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not reset the password" });
  }
};

// ---------- Email change: request a confirmation link ----------
exports.requestEmailChange = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const newEmail = normalizeEmail(req.body.newEmail);
    const currentPassword = String(req.body.currentPassword || "");

    if (!newEmail) return res.status(400).json({ message: "Enter the new email address." });
    if (!EMAIL_RE.test(newEmail)) {
      return res.status(400).json({ message: "That doesn't look like a valid email address." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (newEmail === normalizeEmail(user.email)) {
      return res.status(400).json({ message: "That is already your email address." });
    }

    // Re-authenticate with the current password. Google-only accounts have none
    // yet — they must set one first.
    if (!user.password) {
      return res.status(400).json({
        message:
          'Set a password first (use "Forgot password?" on the login page) before changing your email.',
      });
    }
    const passwordOk = await bcrypt.compare(currentPassword, user.password);
    if (!passwordOk) {
      return res.status(400).json({ message: "Your current password is incorrect." });
    }

    const taken = await User.findOne({ email: newEmail, _id: { $ne: user._id } });
    if (taken) {
      return res.status(400).json({ message: "That email is already in use by another account." });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.pendingEmail = newEmail;
    user.emailChangeToken = hashToken(rawToken);
    user.emailChangeExpires = new Date(Date.now() + EMAIL_CHANGE_TTL_MINUTES * 60 * 1000);
    await user.save();

    const verifyUrl = `${clientBaseUrl()}/verify-email?token=${rawToken}&email=${encodeURIComponent(newEmail)}`;

    await sendEmailChangeVerification({
      to: newEmail,
      name: user.name,
      verifyUrl,
      expiresMinutes: EMAIL_CHANGE_TTL_MINUTES,
    });
    // Heads-up to the current address so the real owner can react if this
    // wasn't them.
    sendEmailChangeAlert({ to: user.email, name: user.name, newEmail }).catch(() => {});

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "auth.email_change_requested",
      targetType: "user",
      targetId: String(user._id),
      severity: "warning",
    });

    const body = { message: `We sent a confirmation link to ${newEmail}. Open it to finish the change.` };
    if (process.env.NODE_ENV !== "production") body.devVerifyUrl = verifyUrl;
    return res.json(body);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not start the email change" });
  }
};

// ---------- Email change: confirm with the token from the link ----------
exports.confirmEmailChange = async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const email = normalizeEmail(req.body.email); // the NEW address

    if (!token || !email) {
      return res.status(400).json({ message: "This confirmation link is incomplete. Start the change again." });
    }

    const user = await User.findOne({
      pendingEmail: email,
      emailChangeToken: hashToken(token),
      emailChangeExpires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({
        message: "This confirmation link is invalid or has expired. Start the change again.",
      });
    }

    // The address may have been registered by someone else between request and
    // confirm.
    const taken = await User.findOne({ email, _id: { $ne: user._id } });
    if (taken) {
      user.pendingEmail = null;
      user.emailChangeToken = null;
      user.emailChangeExpires = null;
      await user.save();
      return res.status(400).json({
        message:
          "That email was registered by someone else before you confirmed. Start the change again with a different address.",
      });
    }

    const previousEmail = user.email;
    user.email = user.pendingEmail;
    user.pendingEmail = null;
    user.emailChangeToken = null;
    user.emailChangeExpires = null;
    // Confirming this link already proves ownership of the new address, the
    // same way clicking the registration link would — so it counts as
    // verification too, independent of whether the original address was
    // ever confirmed.
    user.isEmailVerified = true;
    user.emailVerifiedAt = new Date();
    await user.save();

    sendEmailChangeAlert({
      to: previousEmail,
      name: user.name,
      newEmail: user.email,
      completed: true,
    }).catch(() => {});

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "auth.email_change_completed",
      targetType: "user",
      targetId: String(user._id),
      severity: "warning",
    });

    return res.json({ message: "Your email address has been updated. Please sign in with your new email." });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not confirm the email change" });
  }
};

// ---------- Google sign-in ----------
// The SPA obtains a Google ID token (credential) via Google Identity Services
// and posts it here. We verify it, then find-or-create the STRAM PESO account
// and issue our own JWT — exactly like a normal login from that point on.
exports.googleAuth = async (req, res) => {
  try {
    if (!googleClientId()) {
      return res.status(503).json({ message: "Google sign-in is not configured on this server." });
    }

    const credential = String(req.body.credential || "").trim();
    if (!credential) return res.status(400).json({ message: "Missing Google credential." });

    let payload;
    try {
      const ticket = await getGoogleClient().verifyIdToken({
        idToken: credential,
        audience: googleClientId(),
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ message: "Could not verify your Google sign-in. Please try again." });
    }

    if (!payload || !payload.email || payload.email_verified === false) {
      return res.status(401).json({ message: "Your Google account has no verified email address." });
    }

    const email = normalizeEmail(payload.email);
    const googleId = String(payload.sub);
    const displayName = (payload.name || "").trim() || email.split("@")[0];

    // Which sign-up flow the button lived on. Only consulted when we're
    // creating a brand-new account; capped to the two self-service roles so a
    // hand-crafted request can't mint an admin/superadmin.
    const signupRole = String(req.body.intent || "").trim() === "employer" ? "employer" : "jobseeker";

    let user = await User.findOne({ $or: [{ googleId }, { email }] });
    let isNewUser = false;

    if (!user) {
      // First sign-in with no existing account → create one and drop the user
      // into onboarding to finish their profile.
      user = await User.create({
        name: displayName,
        email,
        googleId,
        authProvider: "google",
        role: signupRole,
        // Google already verified this address before issuing the ID token
        // (checked above via payload.email_verified) — no confirmation link
        // needed on our side.
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        // Left at the schema default ("unverified") — see the matching note
        // in registerEmployer. A Google sign-up hasn't submitted any
        // verification documents yet either.
      });
      if (signupRole === "employer") {
        await EmployerProfile.create({ userId: user._id });
      } else {
        await JobseekerProfile.create({ userId: user._id });
      }
      isNewUser = true;

      await logAuditEvent({
        req,
        actorId: user._id,
        actorRole: signupRole,
        action: signupRole === "employer" ? "auth.employer.registered" : "auth.user.registered",
        targetUserId: user._id,
        targetType: "user",
        targetId: String(user._id),
        severity: "info",
      });

      if (signupRole === "employer") {
        const admins = await User.find({ role: "admin" }).select("_id");
        await notifyManyUsers({
          recipientIds: admins.map((admin) => admin._id),
          actorId: user._id,
          type: "admin_action",
          title: "New employer registered",
          message: `${user.name} registered as an employer. They'll appear in the verification queue once they submit their documents.`,
          relatedEntityType: "user",
          relatedEntityId: user._id,
          actionUrl: "/admin/verification",
          io: req.app.get("io"),
          preferenceKey: "notifyVerificationRequest",
        });
      }
    } else {
      let needsSave = false;
      if (!user.googleId) {
        // Existing password account with the same (Google-verified) email — link it.
        user.googleId = googleId;
        needsSave = true;
      }
      // Only vouch for the account's CURRENT email — a user found via a
      // stale googleId whose email has since changed on our side must not
      // have the old (Google-verified) address verify the new one.
      if (user.isEmailVerified !== true && normalizeEmail(user.email) === email) {
        user.isEmailVerified = true;
        user.emailVerifiedAt = new Date();
        needsSave = true;
      }
      if (needsSave) await user.save();
    }

    // Self-deactivated — a successful Google sign-in already proves identity
    // ownership the same way a correct password would, so it reactivates the
    // account here too (see the matching comment in login()).
    let reactivated = false;
    if (user.isActive === false && user.accountStatus === "deactivated") {
      user.isActive = true;
      user.accountStatus = "active";
      user.deactivatedAt = null;
      await user.save();
      reactivated = true;
    }

    if (user.isActive === false) {
      const appealWindowDays = await getAppealWindowDays();
      const appealToken = jwt.sign(
        { id: user._id, scope: "appeal", tokenVersion: user.tokenVersion },
        process.env.JWT_SECRET,
        { expiresIn: `${appealWindowDays}d` }
      );
      return res.status(403).json({
        code: "ACCOUNT_SUSPENDED",
        message: "Your account has been suspended.",
        accountStatus: user.accountStatus === "banned" ? "banned" : "suspended",
        suspensionReason: user.suspensionReason || null,
        suspendedAt: user.suspendedAt || null,
        appealToken,
      });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, tokenVersion: user.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "auth.user.login_success",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
    });

    return res.json({
      token,
      isNewUser,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        verificationStatus: user.verificationStatus,
        isEmailVerified: user.isEmailVerified === true,
        hasCompletedOnboarding: user.hasCompletedOnboarding,
        onboardingComplete: user.onboardingComplete,
        acceptedTermsAt: user.acceptedTermsAt,
        termsVersion: user.termsVersion,
      },
      termsVersion: CURRENT_TERMS_VERSION,
      ...(reactivated ? { reactivated: true } : {}),
    });
  } catch (error) {
    // Same email-uniqueness race as register/registerEmployer: two concurrent
    // first-time Google sign-ins (or a Google sign-in racing a plain
    // register) can both pass the find-or-create check before either
    // commits. The loser hits the unique index instead of creating a
    // duplicate — tell the user to just try signing in again.
    if (error.code === 11000) {
      return res.status(409).json({
        message: "An account with this email was just created. Please try signing in again.",
      });
    }
    return res.status(500).json({ message: error.message || "Google sign-in failed" });
  }
};

// ---------- Email verification: resend the link ----------
// Public + email-enumeration-safe, same pattern as forgotPassword: always
// answer the same way regardless of whether the address exists or is already
// verified, so this can't be used to probe registered emails.
exports.resendEmailVerification = async (req, res) => {
  const generic = { message: "If that email is registered and not yet verified, a verification link has been sent." };
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email });
    if (!user || user.isEmailVerified === true) return res.json(generic);

    const devVerifyUrl = await issueEmailVerification(user);
    return res.json(devVerifyUrl ? { ...generic, devVerifyUrl } : generic);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not process the request" });
  }
};

// ---------- Email verification: confirm with the token from the link ----------
exports.confirmEmailVerification = async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const email = normalizeEmail(req.body.email);

    if (!token || !email) {
      return res.status(400).json({ message: "This verification link is incomplete. Request a new one." });
    }

    const user = await User.findOne({
      email,
      emailVerificationToken: hashToken(token),
      emailVerificationExpires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({
        message: "This verification link is invalid or has expired. Request a new one.",
      });
    }

    user.isEmailVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "auth.email.verified",
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
    });

    return res.json({ message: "Your email has been verified. You can now sign in." });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not verify the email" });
  }
};

// ---------- Accept terms / community guidelines ----------
exports.acceptTerms = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const version = String(req.body.version || CURRENT_TERMS_VERSION);

    const user = await User.findByIdAndUpdate(
      userId,
      { acceptedTermsAt: new Date(), termsVersion: version },
      { new: true }
    ).select("-password");

    if (!user) return res.status(404).json({ message: "User not found" });

    return res.json({
      message: "Terms accepted",
      acceptedTermsAt: user.acceptedTermsAt,
      termsVersion: user.termsVersion,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.CURRENT_TERMS_VERSION = CURRENT_TERMS_VERSION;

// ---------- Get current user (basic) ----------
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Get full profile (user + role-specific profile) ----------
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    let profile = null;
    if (user.role === "jobseeker") {
      profile = await JobseekerProfile.findOne({ userId: user._id });
    } else if (user.role === "employer") {
      profile = await EmployerProfile.findOne({ userId: user._id });
    }

    res.json({ user, profile });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Unified updateProfile ----------
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const currentUser = await User.findById(userId).select("role password verificationStatus");
    if (!currentUser) return res.status(404).json({ message: "User not found" });

    // ---- 1. Email is immutable through this endpoint ----
    // Changing the sign-in email now goes through the verified flow
    // (POST /auth/email-change/request + /confirm), so any `email` in this
    // payload is ignored here.
    delete req.body.email;

    // ---- 2. Staff (admin / superadmin) password change ----
    const isStaff = currentUser.role === "admin" || currentUser.role === "superadmin";
    if (isStaff && req.body.newPassword) {
      const isCurrentValid = await bcrypt.compare(req.body.currentPassword || "", currentUser.password);
      if (!isCurrentValid) return res.status(400).json({ message: "Current password is incorrect" });
      if (req.body.newPassword.length < 8) return res.status(400).json({ message: "New password must be at least 8 characters" });
    }

    // ---- 3. Prepare common user updates ----
    // Every field here is included only when actually present in this
    // request (see the matching note above profileData) — `x || null`
    // on a field that's simply absent from a partial payload would
    // otherwise blank it out on every save that doesn't happen to include it.
    const commonUpdates = {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      about: req.body.about,
      address: req.body.address,
    };
    if (req.body.dateOfBirth !== undefined) commonUpdates.dateOfBirth = req.body.dateOfBirth || null;
    if (req.body.gender !== undefined) commonUpdates.gender = req.body.gender || null;

    if (req.body.surname || req.body.firstName || req.body.middleName || req.body.suffix) {
      commonUpdates.surname = req.body.surname || null;
      commonUpdates.firstName = req.body.firstName || null;
      commonUpdates.middleName = req.body.middleName || null;
      commonUpdates.suffix = req.body.suffix || null;
      const composedName = [req.body.firstName, req.body.middleName, req.body.surname, req.body.suffix]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (composedName) commonUpdates.name = composedName;
    }

    // For jobseekers, also update career fields (but NOT skills – moved to profile)
    if (currentUser.role === "jobseeker") {
      if (req.body.desiredJobTitle !== undefined) commonUpdates.desiredJobTitle = req.body.desiredJobTitle || null;
      if (req.body.workExperience !== undefined) commonUpdates.workExperience = req.body.workExperience || null;
      if (req.body.educationalAttainment !== undefined) commonUpdates.educationalAttainment = req.body.educationalAttainment || null;
      if (req.body.availabilityStatus !== undefined) commonUpdates.availabilityStatus = req.body.availabilityStatus || null;
      // skills are handled in profileData below

      // Keep desiredJobTitle (used by the matching algorithm) in sync with the first preferred occupation
      if (req.body.preferredOccupations) {
        const occupations = parseJSON(req.body.preferredOccupations, []);
        if (Array.isArray(occupations) && occupations.length > 0) {
          commonUpdates.desiredJobTitle = occupations[0];
        }
      }
      
      // Handle industry preferences
      if (req.body.preferredIndustries) {
        const industries = parseJSON(req.body.preferredIndustries, []);
        if (Array.isArray(industries) && industries.length > 0) {
          const validSelectedIndustries = industries.filter((ind) => VALID_INDUSTRIES.includes(ind));
          if (validSelectedIndustries.length > 0) {
            commonUpdates.preferredIndustries = validSelectedIndustries;
          }
        }
      }
      if (req.body.industryPreferenceLevel) {
        const level = req.body.industryPreferenceLevel;
        if (level === "strict" || level === "flexible") {
          commonUpdates.industryPreferenceLevel = level;
        }
      }
    }

    // For employers, update company fields
    if (currentUser.role === "employer") {
      const employerCommonFields = ["companyName", "industry", "website", "companyDescription", "businessAddress"];
      employerCommonFields.forEach(field => {
        if (req.body[field] !== undefined) commonUpdates[field] = req.body[field];
      });

      if (req.body.companySize !== undefined) {
        commonUpdates.companySize = User.normalizeCompanySize(req.body.companySize);
      }

      // For an employer, `name` IS the business's display identity — used
      // everywhere from the navbar to notifications to Edit Profile's own
      // sidebar. Password-based registration already asks for it as
      // "Business Name" and stores it in `name`, but a Google sign-up has no
      // business name to offer — it seeds `name` from the personal Google
      // account's display name instead, and nothing ever corrected it. Keep
      // `name` mirroring `companyName` here so it's always right by the time
      // any Save happens, regardless of how the account was created.
      const trimmedCompanyName = String(req.body.companyName || "").trim();
      if (trimmedCompanyName) {
        commonUpdates.name = trimmedCompanyName;
      }
    }

    // ---- 4. File uploads + explicit clears (persisted to storage backend by persistFields middleware) ----
    const storedValueOf = (field) => req.files?.[field]?.[0]?.storedValue;
    if (storedValueOf("resumeFile")) commonUpdates.resumeFile = storedValueOf("resumeFile");
    if (storedValueOf("validIdFile")) commonUpdates.validIdFile = storedValueOf("validIdFile");
    // Verification documents can't be silently swapped out through the
    // generic profile save while a submission is already under review —
    // submitEmployerVerification(WithDocuments) both refuse to re-submit in
    // that state ("Your documents are already under review"), so allowing a
    // swap here would let the files an admin is about to look at change out
    // from under them with no re-review triggered and nobody notified. Once
    // verified, the documents are locked for the same reason job posting is.
    const documentsLocked = ["pending", "verified"].includes(currentUser.verificationStatus);
    if (!documentsLocked) {
      if (storedValueOf("businessPermit")) commonUpdates.businessPermitUrl = storedValueOf("businessPermit");
      if (storedValueOf("registrationDoc")) commonUpdates.registrationDocUrl = storedValueOf("registrationDoc");
    }
    if (storedValueOf("resume")) commonUpdates.resumeFile = storedValueOf("resume");
    if (storedValueOf("supportingDocument")) commonUpdates.validIdFile = storedValueOf("supportingDocument");

    const fieldRemovals = getDocumentFieldRemovals(req.body || {});
    if (documentsLocked) {
      delete fieldRemovals.businessPermitUrl;
      delete fieldRemovals.registrationDocUrl;
    }
    Object.assign(commonUpdates, fieldRemovals);

    // Onboarding completion flag
    if (req.body.onboardingComplete === true || req.body.onboardingComplete === "true") {
      commonUpdates.hasCompletedOnboarding = true;
      commonUpdates.onboardingComplete = true;
    }

    // ---- 5. Apply common updates ----
    const cleanCommon = Object.fromEntries(
      Object.entries(commonUpdates).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(cleanCommon).length > 0) {
      await User.findByIdAndUpdate(userId, cleanCommon);
    }

    // ---- 6. Build role‑specific profile data (NSRP fields) ----
    let profileData = {};
    const allFields = req.body;

    // NOTE: every field below is only added to profileData when it was
    // actually present in this request. upsertProfile() applies profileData
    // via Mongo's $set, which only touches the keys it's given — so a field
    // left out here leaves the jobseeker/employer's previously-saved value
    // untouched. Earlier this built a fully-populated object unconditionally
    // (missing fields defaulting to null/[]/{}), which meant any endpoint
    // hitting this controller with a partial payload — e.g. the Resume
    // Studio's "Save to Profile", which PATCHes /auth/me with only a resume
    // file and no other fields — silently wiped every other NSRP profile
    // field (address, work history, skills, etc.) back to blank.
    if (currentUser.role === "jobseeker") {
      profileData = {};
      if (allFields.civilStatus !== undefined) profileData.civilStatus = allFields.civilStatus || null;
      if (allFields.placeOfBirth !== undefined) profileData.placeOfBirth = allFields.placeOfBirth || null;
      if (allFields.citizenship !== undefined) profileData.citizenship = allFields.citizenship || null;
      if (allFields.height !== undefined) profileData.height = allFields.height ? parseFloat(allFields.height) : null;
      if (allFields.weight !== undefined) profileData.weight = allFields.weight ? parseFloat(allFields.weight) : null;
      if (allFields.landline !== undefined) profileData.landline = allFields.landline || null;
      if (allFields.mobileSecondary !== undefined) profileData.mobileSecondary = allFields.mobileSecondary || null;
      if (allFields.presentAddress !== undefined) {
        profileData.presentAddress = parseJSON(allFields.presentAddress, { street: "", barangay: "", municipality: "", province: "", region: "" });
      }
      if (allFields.permanentAddress !== undefined) {
        profileData.permanentAddress = parseJSON(allFields.permanentAddress, { street: "", barangay: "", municipality: "", province: "", region: "" });
      }
      if (allFields.disability !== undefined) profileData.disability = parseJSON(allFields.disability, []);
      if (allFields.is4psBeneficiary !== undefined) profileData.is4psBeneficiary = allFields.is4psBeneficiary === "true";
      if (allFields._4psHouseholdId !== undefined) profileData._4psHouseholdId = allFields._4psHouseholdId || null;
      if (allFields.isOfw !== undefined) profileData.isOfw = allFields.isOfw === "true";
      if (allFields.isRepatriated !== undefined) profileData.isRepatriated = allFields.isRepatriated === "true";
      if (allFields.repatriationIntent !== undefined) profileData.repatriationIntent = allFields.repatriationIntent || null;
      if (allFields.employmentStatus !== undefined) profileData.employmentStatus = allFields.employmentStatus || null;
      if (allFields.employmentType !== undefined) profileData.employmentType = allFields.employmentType || null;
      if (allFields.unemploymentReason !== undefined) profileData.unemploymentReason = allFields.unemploymentReason || null;
      if (allFields.laidoffCountry !== undefined) profileData.laidoffCountry = allFields.laidoffCountry || null;
      if (allFields.passportNo !== undefined) profileData.passportNo = allFields.passportNo || null;
      if (allFields.passportExpiryDate !== undefined) profileData.passportExpiryDate = allFields.passportExpiryDate || null;
      // ==== FIX: skills saved to jobseeker profile ====
      if (allFields.skills !== undefined) profileData.skills = parseJSON(allFields.skills, []);
      // Industry preferences
      if (allFields.preferredIndustries !== undefined) profileData.preferredIndustries = parseJSON(allFields.preferredIndustries, []);

      // Religion & government IDs (optional)
      if (allFields.religion !== undefined) profileData.religion = allFields.religion || null;
      if (allFields.tin !== undefined) profileData.tin = allFields.tin || null;
      if (allFields.sssGsisNo !== undefined) profileData.sssGsisNo = allFields.sssGsisNo || null;
      if (allFields.pagibigNo !== undefined) profileData.pagibigNo = allFields.pagibigNo || null;
      if (allFields.philhealthNo !== undefined) profileData.philhealthNo = allFields.philhealthNo || null;

      // Job preference
      if (allFields.preferredOccupations !== undefined) profileData.preferredOccupations = parseJSON(allFields.preferredOccupations, []);
      if (allFields.preferredWorkLocationLocal !== undefined) profileData.preferredWorkLocationLocal = parseJSON(allFields.preferredWorkLocationLocal, []);
      if (allFields.preferredWorkLocationOverseas !== undefined) profileData.preferredWorkLocationOverseas = parseJSON(allFields.preferredWorkLocationOverseas, []);
      if (allFields.expectedSalaryMin !== undefined) profileData.expectedSalaryMin = allFields.expectedSalaryMin ? parseFloat(allFields.expectedSalaryMin) : null;
      if (allFields.expectedSalaryMax !== undefined) profileData.expectedSalaryMax = allFields.expectedSalaryMax ? parseFloat(allFields.expectedSalaryMax) : null;

      // Educational background detail
      if (allFields.schoolAttended !== undefined) profileData.schoolAttended = allFields.schoolAttended || null;
      if (allFields.schoolAttendedOther !== undefined) profileData.schoolAttendedOther = allFields.schoolAttendedOther || null;
      if (allFields.course !== undefined) profileData.course = allFields.course || null;
      if (allFields.yearGraduated !== undefined) profileData.yearGraduated = allFields.yearGraduated || null;

      // Language proficiency
      if (allFields.languageProficiency !== undefined) {
        const parsedLanguageProficiency = parseJSON(allFields.languageProficiency, undefined);
        if (parsedLanguageProficiency !== undefined) profileData.languageProficiency = parsedLanguageProficiency;
      }
      if (allFields.languageOthersLabel !== undefined) profileData.languageOthersLabel = allFields.languageOthersLabel || null;

      // Work history / training / eligibility / licenses
      if (allFields.workHistory !== undefined) profileData.workHistory = parseJSON(allFields.workHistory, []);
      if (allFields.vocationalTrainings !== undefined) profileData.vocationalTrainings = parseJSON(allFields.vocationalTrainings, []);
      if (allFields.eligibilities !== undefined) profileData.eligibilities = parseJSON(allFields.eligibilities, []);
      if (allFields.professionalLicenses !== undefined) profileData.professionalLicenses = parseJSON(allFields.professionalLicenses, []);
    } else if (currentUser.role === "employer") {
      profileData = {};
      if (allFields.tradeName !== undefined) profileData.tradeName = allFields.tradeName || null;
      if (allFields.acronym !== undefined) profileData.acronym = allFields.acronym || null;
      if (allFields.tin !== undefined) profileData.tin = allFields.tin || null;
      if (allFields.officeType !== undefined) profileData.officeType = allFields.officeType || null;
      if (allFields.employerClassification !== undefined) {
        profileData.employerClassification = parseJSON(allFields.employerClassification, { type: null, subtype: null });
      }
      if (allFields.totalWorkforceSize !== undefined) profileData.totalWorkforceSize = allFields.totalWorkforceSize || null;
      if (allFields.businessAddressStructured !== undefined) {
        profileData.businessAddress = parseJSON(allFields.businessAddressStructured, { street: "", barangay: "", municipality: "", province: "", region: "" });
      }
      if (allFields.ownerName !== undefined) profileData.ownerName = allFields.ownerName || null;
      if (allFields.contactPersonName !== undefined) profileData.contactPersonName = allFields.contactPersonName || null;
      if (allFields.contactPersonPosition !== undefined) profileData.contactPersonPosition = allFields.contactPersonPosition || null;
      if (allFields.fax !== undefined) profileData.fax = allFields.fax || null;
    }

    // ---- 7. Upsert profile ----
    let updatedProfile = null;
    if (Object.keys(profileData).length > 0) {
      updatedProfile = await upsertProfile(userId, currentUser.role, profileData);
    }

    // ---- 8. Staff (admin / superadmin) password update ----
    if (isStaff && req.body.newPassword) {
      const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
      await User.findByIdAndUpdate(userId, { password: hashedPassword });
    }

    // ---- 9. Fetch updated user ----
    const updatedUser = await User.findById(userId).select("-password");

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: currentUser.role,
      action: "user.profile.updated",
      targetType: "user",
      targetId: String(userId),
      severity: "info",
    });

    res.json({
      message: "Profile updated successfully",
      user: updatedUser,
      profile: updatedProfile,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ message: error.message });
  }
};

// ---------- Profile picture ----------
// Standalone from updateProfile so it works for every role and both onboarding
// flows (jobseeker multipart, employer JSON) without touching their payloads.
// The image is already persisted to the storage backend by the persistUploads
// middleware, which sets req.file.storedValue.
exports.updateAvatar = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const storedValue = req.file?.storedValue;
    if (!storedValue) return res.status(400).json({ message: "No image uploaded" });

    const user = await User.findById(userId).select("profileImage");
    if (!user) return res.status(404).json({ message: "User not found" });

    const previous = user.profileImage;
    user.profileImage = storedValue;
    await user.save();

    // Best-effort cleanup of the replaced image (never throws).
    if (previous && previous !== storedValue) storageService.remove(previous);

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: req.user.role,
      action: "user.profile_image.uploaded",
      targetType: "user",
      targetId: String(userId),
      severity: "info",
    });

    res.json({ message: "Profile picture updated", profileImage: storedValue });
  } catch (error) {
    console.error("Update avatar error:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.getDocumentFieldRemovals = getDocumentFieldRemovals;

// ---------- Settings: notification preferences + privacy ----------
const NOTIFICATION_PREFERENCE_KEYS = [
  "notifyMessages",
  "notifyJobMatch",
  "notifyApplicationUpdate",
  "notifyNewApplicant",
  "notifyJobExpiring",
  "notifyVerificationRequest",
  "notifyUserReport",
  "notifySpesSubmission",
];
const PROFILE_VISIBILITY_VALUES = ["public", "employers", "hidden"];
const ALLOW_MESSAGES_FROM_VALUES = ["anyone", "employers"];

exports.getSettings = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("notificationPreferences privacy");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      notificationPreferences: user.notificationPreferences,
      privacy: user.privacy,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Could not load settings" });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { notificationPreferences, privacy } = req.body || {};

    const $set = {};

    if (notificationPreferences && typeof notificationPreferences === "object") {
      for (const key of NOTIFICATION_PREFERENCE_KEYS) {
        if (typeof notificationPreferences[key] === "boolean") {
          $set[`notificationPreferences.${key}`] = notificationPreferences[key];
        }
      }
    }

    if (privacy && typeof privacy === "object") {
      if (PROFILE_VISIBILITY_VALUES.includes(privacy.profileVisibility)) {
        $set["privacy.profileVisibility"] = privacy.profileVisibility;
      }
      if (ALLOW_MESSAGES_FROM_VALUES.includes(privacy.allowMessagesFrom)) {
        $set["privacy.allowMessagesFrom"] = privacy.allowMessagesFrom;
      }
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ message: "No valid settings fields were provided." });
    }

    const user = await User.findByIdAndUpdate(userId, { $set }, { new: true }).select(
      "notificationPreferences privacy"
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      message: "Settings saved.",
      notificationPreferences: user.notificationPreferences,
      privacy: user.privacy,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Could not save settings" });
  }
};

// ---------- Settings: self-service account deactivation ----------
// Distinct from adminController.deactivateUser (a superadmin suspending
// someone else's account for moderation). Requires the current password as
// re-authentication for a destructive, session-ending action. Reactivation
// is self-service too — see the matching branch in login()/googleAuth().
exports.deactivateAccount = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const password = String(req.body.password || "");

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "admin" || user.role === "superadmin") {
      return res.status(403).json({ message: "Staff accounts cannot be self-deactivated from here." });
    }

    if (!user.password) {
      return res.status(400).json({
        message: 'Set a password first (use "Forgot password?" on the login page) before deactivating your account.',
      });
    }
    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      return res.status(400).json({ message: "Your password is incorrect." });
    }

    if (user.isActive === false) {
      return res.status(400).json({ message: "This account is already deactivated." });
    }

    user.isActive = false;
    user.accountStatus = "deactivated";
    user.deactivatedAt = new Date();
    await user.save();

    // Ends this session immediately, and any other device/tab this account
    // is signed into right now — not just the one that clicked Deactivate.
    forceLogout(req.app.get("io"), user._id, {
      code: "ACCOUNT_DEACTIVATED",
      message: "This account has been deactivated. Sign in again to reactivate it.",
    });

    await logAuditEvent({
      req,
      actorId: userId,
      actorRole: user.role,
      action: "user.account.self_deactivated",
      targetType: "user",
      targetId: String(userId),
      severity: "warning",
    });

    return res.json({
      message: "Your account has been deactivated. Sign in again at any time to reactivate it.",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not deactivate the account" });
  }
};