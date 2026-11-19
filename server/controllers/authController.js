const User = require("../models/User");
const JobseekerProfile = require("../models/JobseekerProfile");
const EmployerProfile = require("../models/EmployerProfile");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { getActiveValues } = require("../services/systemOptionService");
const { resolveCover } = require("../services/bannerTemplateService");
const { resolveAvatarPreset } = require("../services/avatarPresetService");
const { GOVERNMENT_ID_TYPE_OTHER } = require("../data/governmentIdTypes");
const { computeProfileCompleteness } = require("../utils/profileCompleteness");
const storageService = require("../services/storageService");
const { logAuditEvent } = require("../services/auditService");
const { runPostCommit } = require("../utils/postCommit");
const { notifyManyUsers } = require("../services/notificationService");
const { forceLogout } = require("../services/sessionService");
const { sendError } = require("../utils/sendError");
const logger = require("../utils/logger");
const {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendPasswordAddedEmail,
  sendEmailVerification,
  sendEmailChangeVerification,
  sendEmailChangeAlert,
  sendRecoveryEmailVerification,
  sendRecoveryEmailAlert,
  sendBackupCodesGeneratedEmail,
  sendBackupCodeRedeemedEmail,
} = require("../services/mailService");
const { OAuth2Client } = require("google-auth-library");
const { validateDobInput, parseDateOnly, getAgeTier } = require("../utils/age");
const { isUsernameSignupEnabled, hasVerifiedEmail } = require("../utils/usernameSignup");
const { sessionUserPayload } = require("../utils/sessionUser");
const loginLock = require("../services/loginLockService");
const accountAlerts = require("../services/accountAlertService");
const passwordPolicy = require("../utils/passwordPolicy");
const { phoneProblem, parsePhone, canonicalPhone, phoneMessage, allowLandlineForRole } = require("../utils/phone");
const {
  EMPLOYMENT_STATUS_VALUES,
  EMPLOYMENT_TYPE_VALUES,
  UNEMPLOYMENT_REASON_VALUES,
} = require("../utils/enumValues");

// Applies the shared password policy for a known account. Returns true when it
// already answered the request (400), so callers can `if (rejectWeakPassword(...)) return;`.
// Inert while USERNAME_SIGNUP_ENABLED is off.
const rejectWeakPassword = (res, user, password) => {
  const verdict = passwordPolicy.enforce({
    password,
    username: user.username,
    dateOfBirth: user.dateOfBirth,
    usernameOnly: !user.email,
  });
  if (verdict.ok) return false;
  res.status(400).json({ code: verdict.code, message: verdict.message });
  return true;
};

const { DOB_ERROR_MESSAGES } = require("../utils/dobPolicy");
const { normalizeEmail } = require("../utils/normalizeEmail");
const { normalizeHeightUnit, normalizeWeightUnit } = require("../utils/unitFields");
const SystemSettings = require("../models/SystemSettings");
const ReservedUsername = require("../models/ReservedUsername");
const usernameUtil = require("../utils/username");
const { scheduleIdOcr } = require("../services/idOcrService");

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
// client origin, then localhost dev. (Moved to utils/clientUrl.js so other
// services can build the same absolute links — see that file.)
const { clientBaseUrl } = require("../utils/clientUrl");
const { tidyCitizenship, tidyNamedList } = require("../utils/profileText");

const PASSWORD_RESET_TTL_MINUTES = 30;
const EMAIL_CHANGE_TTL_MINUTES = 30;
const RECOVERY_EMAIL_TTL_MINUTES = 30;
// Scoped token issued after redeeming a valid backup code — short-lived
// since its only job is to carry the user from "just proved who they are"
// to "has a new password set", not to be a general session.
const RECOVERY_TOKEN_TTL_MINUTES = 15;
// Longer than the password-reset/email-change links above: verifying a
// registration email isn't a security-sensitive action the way changing a
// password or an email address is, so there's no reason to force a quick
// turnaround.
const EMAIL_VERIFICATION_TTL_HOURS = 24;
// SHA-256 of any link token, so a DB leak can't be replayed against the flow.
const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");
const hashResetToken = hashToken; // kept for existing call sites

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reset / verification links are only echoed back in API responses when this
// is explicitly opted into (local development without SMTP). Off by default
// in every environment, including when NODE_ENV is unset.
const exposeDevLinks = () => process.env.EXPOSE_DEV_LINKS === "true";

// Every save on `user` below passes `{ validateModifiedOnly: true }`.
// Without it, Mongoose re-validates EVERY path on the document on every
// save — not just the ones this particular call actually changed — so a
// narrow action like setting a username or adding a password can fail with
// an unrelated 500 if the account happens to be carrying a legacy value in
// some other field that predates a later schema tightening (this is exactly
// what happened: an old `workExperience` enum value blocked
// POST /auth/username for several accounts until
// scripts/migrateWorkExperienceLegacyValues.js cleaned the data up — see
// scripts/checkEnumDrift.js to check for any more of this). This flag
// doesn't weaken validation of the fields each call actually touches, and
// document-level hooks (e.g. companySize's pre("validate") normalizer)
// still run regardless — it only skips re-checking paths nothing here
// modified. updateProfile is the one write path that sets several of these
// enum fields directly from request input, which needed the complementary
// fix instead — see its own findByIdAndUpdate(..., { runValidators: true })
// comment below, which enforces the enum going forward without being
// blocked by unrelated fields the way a full-document .save() would be.
//
// Generates a verification token for `user`, saves it, and emails the link.
// Called right after a password-based registration. Never throws — sendMail
// itself already falls back to a console log instead of throwing, so a dead
// SMTP transport can't fail registration.
// @returns {Promise<string|null>} the verify URL only when EXPOSE_DEV_LINKS=true
const issueEmailVerification = async (user) => {
  // A username-only account has no address to verify.
  if (!user.email) return null;
  const rawToken = crypto.randomBytes(32).toString("hex");
  user.emailVerificationToken = hashToken(rawToken);
  user.emailVerificationExpires = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
  await user.save({ validateModifiedOnly: true });

  const verifyUrl = `${clientBaseUrl()}/confirm-email?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

  await sendEmailVerification({
    to: user.email,
    name: user.name,
    verifyUrl,
    expiresHours: EMAIL_VERIFICATION_TTL_HOURS,
  });

  return exposeDevLinks() ? verifyUrl : null;
};

// Best-effort: assigns an available username derived from the email's local
// part to a freshly created account, so a day-one user already has a
// username to sign in with even if they never bother to set one in
// Settings. Deliberately does NOT set usernameChangedAt — an auto-suggested
// default isn't a user-initiated change, so it must not start the 30-day
// change cooldown (utils/username.js's getChangeCooldown) against a name
// the user never actually chose. Never throws: account creation must
// succeed whether or not a username could be found.
const assignSuggestedUsername = async (user) => {
  if (!user.email) return;
  try {
    const suggested = await usernameUtil.suggestFromEmailLocalPart(user.email.split("@")[0]);
    if (suggested) {
      user.username = suggested;
      await user.save({ validateModifiedOnly: true });
    }
  } catch (err) {
    logger.error("Failed to suggest a username at account creation", {
      userId: String(user._id),
      error: err.message,
    });
  }
};

// Resolves an OPTIONAL, user-CHOSEN username at registration (as opposed to
// the auto-suggested one assignSuggestedUsername falls back to when this
// returns `{ username: null }`, i.e. the field was left blank).
//
// Unlike the auto-suggestion path, a username the user actually typed and
// submitted is never silently swapped for something else: an invalid
// format or a collision is reported back as a real error so registration
// can be retried with a different choice, same as it already is for a
// taken email — see both register() and registerEmployer()'s callers.
const resolveChosenUsername = async (rawUsername) => {
  const trimmed = String(rawUsername || "").trim();
  if (!trimmed) return { username: null };

  const format = usernameUtil.validateFormat(trimmed);
  if (!format.ok) return { error: format.error };

  const available = await usernameUtil.isAvailable(format.normalized);
  if (!available) return { error: "That username is already taken." };

  return { username: format.normalized };
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

// Which unique index fired on an E11000.
const duplicateKeyField = (error) => {
  const pattern = error?.keyPattern || error?.keyValue || {};
  if (pattern.username !== undefined) return "username";
  if (pattern.email !== undefined) return "email";
  return null;
};

// ---------- Registration ----------
exports.register = async (req, res) => {
  const { name, password, surname, firstName, middleName, suffix, dateOfBirth } = req.body;
  const usernameMode = req.body.signupMode === "username";
  try {
    // Defence in depth: the route also refuses this before validation runs.
    if (usernameMode && !isUsernameSignupEnabled()) {
      return res.status(403).json({
        code: "SIGNUP_DISABLED",
        message: "Sign-up with a username is not available right now.",
      });
    }

    // Age gate FIRST, before any username or email lookup: the date of birth is
    // required and must put the applicant at MIN_ACCOUNT_AGE or older
    // (Asia/Manila calendar). A rejected attempt stores nothing and the date is
    // never logged.
    const dob = validateDobInput(dateOfBirth);
    if (!dob.ok) {
      return res.status(400).json({ code: dob.code, message: DOB_ERROR_MESSAGES[dob.code] });
    }

    // Username mode never has an email: any email sent is ignored, never
    // queried, never stored.
    const email = usernameMode ? "" : normalizeEmail(req.body.email);
    if (!usernameMode) {
      const existingUser = await User.findOne({ email });
      if (existingUser) return res.status(400).json({ message: "Email already exists" });
    }

    // Optional in email mode (blank falls back to assignSuggestedUsername after
    // the account exists); required in username mode.
    const usernameChoice = await resolveChosenUsername(req.body.username);
    if (usernameChoice.error) {
      return res.status(400).json({
        ...(usernameMode ? { code: "USERNAME_INVALID" } : {}),
        message: usernameChoice.error,
        field: "username",
      });
    }
    if (usernameMode && !usernameChoice.username) {
      return res.status(400).json({ code: "USERNAME_INVALID", message: "Choose a username.", field: "username" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const composedName = [firstName, middleName, surname, suffix].filter(Boolean).join(" ").trim();
    let user;
    try {
      user = await User.create({
        name: composedName || name,
        surname: surname || null,
        firstName: firstName || null,
        middleName: middleName || null,
        suffix: suffix || null,
        dateOfBirth: dob.date,
        dobLockedAt: new Date(),
        dobSource: "registration",
        ...(usernameMode ? {} : { email }),
        password: hashed,
        role: "jobseeker",
        ...(usernameChoice.username ? { username: usernameChoice.username } : {}),
      });
    } catch (createError) {
      // A concurrent registration can still win a race against the
      // isAvailable() check above: the unique indexes are the final word.
      // keyPattern tells us which one actually fired.
      if (createError.code === 11000) {
        const field = duplicateKeyField(createError);
        if (field === "username") {
          return res.status(400).json({
            ...(usernameMode ? { code: "USERNAME_TAKEN" } : {}),
            message: "That username is already taken.",
            field: "username",
          });
        }
        if (field === "email" && !usernameMode) {
          return res.status(400).json({ message: "Email already exists" });
        }
      }
      throw createError;
    }

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: "jobseeker",
      action: "auth.user.registered",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
      metadata: { signupMode: usernameMode ? "username" : "email" },
    });

    await JobseekerProfile.create({ userId: user._id });

    if (usernameMode) {
      // No mailbox to prove, so no inert-until-verified step: the user gets a
      // session straight away. `isEmailVerified` stays unset (a literal false
      // would block login); the absent email is what limits access.
      const token = jwt.sign(
        { id: user._id, role: user.role, tokenVersion: user.tokenVersion },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );
      return res.status(201).json({ token, user: sessionUserPayload(user), termsVersion: CURRENT_TERMS_VERSION });
    }

    user.isEmailVerified = false;
    const devVerifyUrl = await issueEmailVerification(user);
    // Only auto-suggest when the user did not choose their own above.
    if (!usernameChoice.username) {
      await assignSuggestedUsername(user);
    }

    // Deliberately no session token here: the account exists but stays
    // inert (cannot sign in, see the isEmailVerified check in login()) until
    // the verification link is opened. A bogus or mistyped email just never
    // receives that link, so that account can never reach onboarding at all.
    res.status(201).json({
      message: "Account created. Check your email to verify it before signing in.",
      email: user.email,
      ...(devVerifyUrl ? { devVerifyUrl } : {}),
    });
  } catch (error) {
    // A concurrent request can slip past the findOne check above and lose the
    // race to a unique index: surface a clean message instead of a raw
    // duplicate-key error.
    if (error.code === 11000) {
      if (duplicateKeyField(error) === "username") {
        return res.status(400).json({ message: "That username is already taken.", field: "username" });
      }
      if (usernameMode) {
        // No email is stored in this mode, so an email-index collision means the
        // old full unique index is still in place (scripts/swapUserEmailUsernameIndexes.js
        // not run yet). That is a deployment fault, not something to blame on the user.
        logger.error("Username sign-up hit the email unique index; run the index swap script", { error: error.message });
        return sendError(res, error);
      }
      return res.status(400).json({ message: "Email already exists" });
    }
    sendError(res, error);
  }
};

exports.registerEmployer = async (req, res) => {
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);
  try {
    // Employers attest they are 18+; no date of birth is collected or stored.
    if (!["true", "1", "on"].includes(String(req.body.confirmAdult ?? "").toLowerCase())) {
      return res.status(400).json({
        code: "EMPLOYER_ADULT_ATTESTATION_REQUIRED",
        message: "You must confirm that you are 18 years old or older.",
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already exists" });

    // Optional — see register()'s matching comment.
    const usernameChoice = await resolveChosenUsername(req.body.username);
    if (usernameChoice.error) {
      return res.status(400).json({ message: usernameChoice.error, field: "username" });
    }

    const hashed = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await User.create({
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
        ...(usernameChoice.username ? { username: usernameChoice.username } : {}),
      });
    } catch (createError) {
      // See register()'s matching comment — keyPattern disambiguates a rare
      // username-collision race from the far more common email one below.
      if (createError.code === 11000 && createError.keyPattern?.username) {
        return res.status(400).json({ message: "That username is already taken.", field: "username" });
      }
      throw createError;
    }

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
    if (!usernameChoice.username) {
      await assignSuggestedUsername(user);
    }

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
    sendError(res, error);
  }
};

// A precomputed hash of an unguessable, never-used password — compared
// against whenever the real lookup fails to find a user (or the user has no
// password set, e.g. a Google-only account). Keeps the login response time
// for "no such account" indistinguishable from "wrong password", instead of
// short-circuiting before the bcrypt cost is paid.
const DUMMY_PASSWORD_HASH = "$2a$10$Lw6.qhsvJZhB3YkGv.m/4uA/edj4yKVYLcOYAkCySmNp6gajYfvdK";

// Resolves an identifier — an email OR a username — to a User the same way
// everywhere this needs to happen (currently login() and redeemBackupCode()):
// anything containing "@" is looked up as an email; everything else as a
// username. A username can never collide with this check (the format
// validated in utils/username.js rejects "@" entirely), so this is
// unambiguous in both directions. Shared so the two call sites can't drift
// out of sync on what "resolve an identifier" even means.
const resolveIdentifierToUser = async (rawIdentifier) => {
  const identifier = String(rawIdentifier || "").trim();
  if (!identifier) return null;
  if (identifier.includes("@")) {
    return User.findOne({ email: normalizeEmail(identifier) });
  }
  return User.findOne({ username: identifier.toLowerCase() }).collation({ locale: "en", strength: 2 });
};

// ---------- Login ----------
// Accepts `identifier` (preferred) — an email OR a username — with `email`
// kept as an alias so no existing client payload breaks.
exports.login = async (req, res) => {
  const { password } = req.body;
  const rawIdentifier = req.body.identifier || req.body.email || "";
  try {
    const user = await resolveIdentifierToUser(rawIdentifier);

    // Same generic message and the same bcrypt work either way, so neither
    // the response text nor the response time discloses whether this
    // identifier has an account.
    // Per-account lockout: only while the username sign-up feature is on, and
    // only for jobseeker accounts (a staff account must never be lockable by
    // someone typing its name).
    const lockoutOn = isUsernameSignupEnabled();
    const lockable = lockoutOn && user && ["jobseeker", "employee", "resident"].includes(user.role);
    const locked = Boolean(lockable && loginLock.isLocked(user));

    const match = await bcrypt.compare(password || "", user?.password || DUMMY_PASSWORD_HASH);
    if (!user || !match || user.staffRecoveryPending || locked) {
      if (lockoutOn) {
        // One database write on every failure path, real or dummy, so response
        // time does not tell "no such account" from "wrong password" from
        // "locked". A locked account answers exactly like a wrong password,
        // even when the password is right.
        if (lockable && !match && !locked) await loginLock.recordFailure(user, { req });
        else await loginLock.recordFailureDummy();
      }
      return res.status(400).json({ message: "Invalid username/email or password" });
    }
    // Soft-deleted by a superadmin: answered before anything else happens, so a
    // deleted account triggers no lock clearing, no new-device alert and, above
    // all, no self-deactivation auto-reactivation further down.
    if (user.deletedAt) {
      return res.status(403).json({
        code: "ACCOUNT_DELETED",
        message: "This account no longer exists.",
      });
    }
    if (lockable) {
      const failedBefore = (user.loginLock && user.loginLock.failures) || 0;
      if (user.loginLock) await loginLock.clearLock(user._id);
      // In-app alerts (they need no mailbox). Never awaited into the response path.
      if (failedBefore >= 3) void accountAlerts.notifyFailedAttempts(user._id, req);
      void accountAlerts.checkNewDevice(user._id, req.headers && req.headers["user-agent"], req);
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
      await user.save({ validateModifiedOnly: true });
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
    User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).catch((err) =>
      logger.error("Failed to record lastLoginAt", { userId: String(user._id), error: err.message })
    );

    const token = jwt.sign(
      { id: user._id, role: user.role, tokenVersion: user.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      token,
      user: sessionUserPayload(user),
      termsVersion: CURRENT_TERMS_VERSION,
      ...(reactivated ? { reactivated: true } : {}),
    });
  } catch (error) {
    sendError(res, error);
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

    const ok = await loginLock.checkPasswordWithLock(user, currentPassword, { req });
    if (!ok) return res.status(400).json({ message: "Your current password is incorrect." });
    if (rejectWeakPassword(res, user, newPassword)) return;

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
    await user.save({ validateModifiedOnly: true });

    sendPasswordChangedEmail({ to: user.email, name: user.name }).catch((err) =>
      logger.error("Failed to send password-changed notification email", { userId: String(user._id), error: err.message })
    );
    void accountAlerts.notifyPasswordChanged(user._id, req);

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
    return sendError(res, error, "Could not change the password");
  }
};

// ---------- Add a password to a Google-only account ----------
// For accounts created via Google sign-in that have never set a local
// password (`!user.password`). Google sign-in is otherwise this account's
// only way in — a real problem if the owner ever loses access to that
// Google account itself (e.g. its own 2FA challenge, with no phone on
// hand). Letting them add a password from Settings removes that single
// point of failure.
//
// Re-authenticates with a FRESH Google ID token rather than just this
// session's JWT, mirroring why requestEmailChange() demands the current
// password for a local account: a 30-day JWT that leaked or was left
// signed-in on a shared device must not, by itself, be enough to plant a
// password-based backdoor into the account.
exports.setPassword = async (req, res) => {
  try {
    if (!googleClientId()) {
      return res.status(503).json({ message: "Google sign-in is not configured on this server." });
    }

    const userId = req.user._id || req.user.id;
    const credential = String(req.body.credential || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!credential) return res.status(400).json({ message: "Missing Google credential." });
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Your new password must be at least 8 characters." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.password) {
      return res.status(400).json({
        message: "This account already has a password. Use Change Password instead.",
      });
    }
    if (rejectWeakPassword(res, user, newPassword)) return;
    if (!user.googleId) {
      return res.status(400).json({ message: "This account isn't linked to Google." });
    }

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

    // Must be a fresh assertion for the SAME Google account already linked
    // here — not merely "signed in with some Google account".
    if (!payload || String(payload.sub) !== String(user.googleId)) {
      return res.status(401).json({ message: "That Google account doesn't match this account." });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    // No other session predates "had no password" in a way that matters,
    // but bumping tokenVersion keeps this consistent with every other
    // credential change — any other active session is forced to
    // re-authenticate, and a fresh token below keeps this one signed in.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save({ validateModifiedOnly: true });

    sendPasswordAddedEmail({ to: user.email, name: user.name }).catch((err) =>
      logger.error("Failed to send password-added notification email", { userId: String(user._id), error: err.message })
    );

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "user.password.added",
      targetType: "user",
      targetId: String(user._id),
      severity: "warning",
    });

    const token = jwt.sign(
      { id: user._id, role: user.role, tokenVersion: user.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({ message: "A password has been added to your account.", token, hasPassword: true });
  } catch (error) {
    return sendError(res, error, "Could not set the password");
  }
};

// ---------- Username availability (public, rate-limited — see authRoutes.js) ----------
// A live checker necessarily leaks SOME information about which usernames
// exist — accepted here as a deliberate, documented trade-off (see
// markdowns/NOTIF_EMAIL_ID_OCR_AND_ACCOUNT_RECOVERY_PLAN.md §3.5): a
// username is a low-value identifier (not a recovery channel — email is),
// and "submit and fail blind" is bad enough UX that users pick worse names.
exports.checkUsernameAvailable = async (req, res) => {
  try {
    const format = usernameUtil.validateFormat(req.query.u);
    if (!format.ok) {
      return res.json({ available: false, reason: format.error });
    }
    const available = await usernameUtil.isAvailable(format.normalized);
    return res.json({ available, normalized: format.normalized });
  } catch (error) {
    return sendError(res, error, "Could not check username availability");
  }
};

// ---------- Set / change the signed-in user's username ----------
exports.setUsername = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const format = usernameUtil.validateFormat(req.body.username);
    if (!format.ok) {
      return res.status(400).json({ message: format.error });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.username === format.normalized) {
      return res.json({ message: "That's already your username.", username: user.username });
    }

    const cooldown = usernameUtil.getChangeCooldown(user);
    if (!cooldown.ok) {
      return res.status(400).json({
        message: `You can change your username again on ${cooldown.nextAllowedAt.toLocaleDateString()}.`,
        nextAllowedAt: cooldown.nextAllowedAt,
      });
    }

    const available = await usernameUtil.isAvailable(format.normalized, user._id);
    if (!available) {
      return res.status(400).json({ message: "That username is already taken." });
    }

    const previousUsername = user.username;
    user.username = format.normalized;
    user.usernameChangedAt = new Date();

    try {
      await user.save({ validateModifiedOnly: true });
    } catch (error) {
      // A concurrent request can slip past isAvailable() above and lose the
      // race to the unique index — surface the same clean message instead
      // of a raw duplicate-key error.
      if (error.code === 11000) {
        return res.status(400).json({ message: "That username is already taken." });
      }
      throw error;
    }

    // Tombstone the name this account is walking away from, so it can't be
    // immediately re-squatted by someone else (see ReservedUsername.js).
    // Best-effort: a failure here must not undo the username change itself,
    // which has already been saved above.
    if (previousUsername) {
      ReservedUsername.create({ username: previousUsername, releasedBy: user._id, reason: "changed" }).catch((err) =>
        logger.error("Failed to tombstone released username", { username: previousUsername, error: err.message })
      );
    }

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "user.username.changed",
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
      metadata: { previousUsername, newUsername: user.username },
    });

    return res.json({ message: "Your username has been updated.", username: user.username });
  } catch (error) {
    return sendError(res, error, "Could not set the username");
  }
};

// ---------- Forgot password: issue a reset link ----------
exports.forgotPassword = async (req, res) => {
  // Always answer the same way so this endpoint can't be used to probe which
  // emails have accounts.
  const generic = { message: "If that email is registered, a password reset link has been sent." };
  try {
    // With the username sign-up feature on, the page may send a username in
    // `identifier`. The answer is the same neutral message either way, and a
    // reset is only ever mailed to the account's verified email, if it has one.
    const rawIdentifier = isUsernameSignupEnabled() ? req.body.identifier || req.body.email : req.body.email;
    const byUsername = isUsernameSignupEnabled() && rawIdentifier && !String(rawIdentifier).includes("@");
    const email = byUsername ? "" : normalizeEmail(rawIdentifier);
    if (!email && !byUsername) return res.status(400).json({ message: "Email is required" });
    // Explicit opt-in only — never silently preferred, and never reflected
    // in the response either way, so this can't be used to probe whether an
    // account has a (verified) recovery email configured at all.
    const useRecoveryEmail = req.body.useRecoveryEmail === true;

    const user = byUsername ? await resolveIdentifierToUser(rawIdentifier) : await User.findOne({ email });
    if (!user || user.staffRecoveryPending) return res.json(generic);
    // A username-only account with no email has nowhere to send a link.
    if (byUsername && !hasVerifiedEmail(user)) return res.json(generic);
    const primaryEmail = byUsername ? normalizeEmail(user.email) : email;

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetToken = hashResetToken(rawToken);
    user.passwordResetExpires = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
    await user.save({ validateModifiedOnly: true });

    // The link itself always encodes the PRIMARY email — resetPassword()
    // matches on that field regardless of which inbox actually received
    // this message. Only the delivery destination changes.
    const resetUrl = `${clientBaseUrl()}/reset-password?token=${rawToken}&email=${encodeURIComponent(primaryEmail)}`;
    const destination =
      useRecoveryEmail && user.recoveryEmail && user.recoveryEmailVerifiedAt ? user.recoveryEmail : primaryEmail;

    await sendPasswordResetEmail({
      to: destination,
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

    // Local convenience only: the link is returned in the response solely
    // when EXPOSE_DEV_LINKS=true. Never tied to NODE_ENV, so an unset
    // NODE_ENV on a host can't hand a reset link to whoever asks for it.
    if (exposeDevLinks()) {
      return res.json({ ...generic, devResetUrl: resetUrl });
    }
    return res.json(generic);
  } catch (error) {
    return sendError(res, error, "Could not process the request");
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
      staffRecoveryPending: { $ne: true },
    });
    if (!user) {
      return res.status(400).json({
        message: "This reset link is invalid or has expired. Please request a new one.",
      });
    }

    if (rejectWeakPassword(res, user, password)) return;

    user.password = await bcrypt.hash(password, 10);
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    // A completed reset also unlocks the account and drops any pending email code.
    user.loginLock = undefined;
    user.emailCode = undefined;
    // Invalidates every token issued before this reset — the reset flow
    // itself sends the user to a fresh login, so there's no "current
    // session" to keep alive here (unlike the self-service changePassword).
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save({ validateModifiedOnly: true });

    // Security notice to the account's own address (fire-and-forget — a mail
    // hiccup must not fail a completed reset).
    sendPasswordChangedEmail({ to: user.email, name: user.name }).catch((err) =>
      logger.error("Failed to send password-reset notification email", { userId: String(user._id), error: err.message })
    );
    void accountAlerts.notifyPasswordChanged(user._id, req);

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
    return sendError(res, error, "Could not reset the password");
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
    const passwordOk = await loginLock.checkPasswordWithLock(user, currentPassword, { req });
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
    await user.save({ validateModifiedOnly: true });

    const verifyUrl = `${clientBaseUrl()}/verify-email?token=${rawToken}&email=${encodeURIComponent(newEmail)}`;

    await sendEmailChangeVerification({
      to: newEmail,
      name: user.name,
      verifyUrl,
      expiresMinutes: EMAIL_CHANGE_TTL_MINUTES,
    });
    // Heads-up to the current address so the real owner can react if this
    // wasn't them.
    sendEmailChangeAlert({ to: user.email, name: user.name, newEmail }).catch((err) =>
      logger.error("Failed to send email-change alert to previous address", { userId: String(user._id), error: err.message })
    );

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
    if (exposeDevLinks()) body.devVerifyUrl = verifyUrl;
    return res.json(body);
  } catch (error) {
    return sendError(res, error, "Could not start the email change");
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
      await user.save({ validateModifiedOnly: true });
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
    await user.save({ validateModifiedOnly: true });

    sendEmailChangeAlert({
      to: previousEmail,
      name: user.name,
      newEmail: user.email,
      completed: true,
    }).catch((err) =>
      logger.error("Failed to send email-change completion alert", { userId: String(user._id), error: err.message })
    );

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
    return sendError(res, error, "Could not confirm the email change");
  }
};

/* ==================================================================== */
/* Account recovery — recovery email (§4.3 of the account-recovery plan) */
/* ==================================================================== */

// ---------- Request a recovery email (Settings → Security) ----------
// A second address forgotPassword can optionally send the reset link to
// (see its useRecoveryEmail flag) when the primary inbox is itself the one
// that's unreachable — e.g. a Google-only account locked out of Google's
// own 2FA, whose `email` effectively IS that Google account.
//
// Requires the current password, the same re-auth requestEmailChange above
// uses: without it, a hijacked session JWT could quietly point recovery at
// an attacker's inbox, and the next password reset using it would hand
// over the account without ever needing the real password or a live
// Google session. A Google-only account with no password yet must add one
// first (Settings → Security — see authController.setPassword) before it
// can set a recovery email; this is a deliberate, small extra step for a
// meaningfully safer feature.
exports.requestRecoveryEmail = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const newRecoveryEmail = normalizeEmail(req.body.recoveryEmail);
    const currentPassword = String(req.body.currentPassword || "");

    if (!newRecoveryEmail) return res.status(400).json({ message: "Enter a recovery email address." });
    if (!EMAIL_RE.test(newRecoveryEmail)) {
      return res.status(400).json({ message: "That doesn't look like a valid email address." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (newRecoveryEmail === normalizeEmail(user.email)) {
      return res.status(400).json({ message: "Your recovery email must be different from your sign-in email." });
    }

    if (!user.password) {
      return res.status(400).json({
        message: 'Set a password first (Settings → Security → Add a password) before adding a recovery email.',
      });
    }
    const passwordOk = await loginLock.checkPasswordWithLock(user, currentPassword, { req });
    if (!passwordOk) {
      return res.status(400).json({ message: "Your current password is incorrect." });
    }

    const taken = await User.findOne({ recoveryEmail: newRecoveryEmail, _id: { $ne: user._id } });
    if (taken) {
      return res.status(400).json({ message: "That email is already set as the recovery email on another account." });
    }

    // Captured before overwriting below — decides the wording of the alert
    // sent to the primary address further down.
    const alertAction = user.recoveryEmail ? "replaced" : "added";

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.recoveryEmail = newRecoveryEmail;
    user.recoveryEmailVerifiedAt = null;
    user.recoveryEmailToken = hashToken(rawToken);
    user.recoveryEmailExpires = new Date(Date.now() + RECOVERY_EMAIL_TTL_MINUTES * 60 * 1000);
    await user.save({ validateModifiedOnly: true });

    const verifyUrl = `${clientBaseUrl()}/verify-recovery-email?token=${rawToken}&email=${encodeURIComponent(newRecoveryEmail)}`;

    await sendRecoveryEmailVerification({
      to: newRecoveryEmail,
      name: user.name,
      verifyUrl,
      expiresMinutes: RECOVERY_EMAIL_TTL_MINUTES,
    });
    // Always to the PRIMARY address, never the recovery address itself —
    // catches a hijacked session quietly changing this, same purpose as
    // sendEmailChangeAlert above.
    sendRecoveryEmailAlert({
      to: user.email,
      name: user.name,
      recoveryEmail: newRecoveryEmail,
      action: alertAction,
    }).catch((err) =>
      logger.error("Failed to send recovery-email alert", { userId: String(user._id), error: err.message })
    );

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "user.recovery_email.requested",
      targetType: "user",
      targetId: String(user._id),
      severity: "warning",
    });

    const body = { message: `We sent a confirmation link to ${newRecoveryEmail}. Open it to finish setting it up.` };
    if (exposeDevLinks()) body.devVerifyUrl = verifyUrl;
    return res.json(body);
  } catch (error) {
    return sendError(res, error, "Could not set the recovery email");
  }
};

// ---------- Confirm a recovery email with the token from the link ----------
exports.confirmRecoveryEmail = async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const email = normalizeEmail(req.body.email);

    if (!token || !email) {
      return res.status(400).json({ message: "This confirmation link is incomplete. Start again from Settings." });
    }

    const user = await User.findOne({
      recoveryEmail: email,
      recoveryEmailToken: hashToken(token),
      recoveryEmailExpires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({
        message: "This confirmation link is invalid or has expired. Start again from Settings.",
      });
    }

    user.recoveryEmailVerifiedAt = new Date();
    user.recoveryEmailToken = null;
    user.recoveryEmailExpires = null;
    await user.save({ validateModifiedOnly: true });

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "user.recovery_email.confirmed",
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
    });

    return res.json({ message: "Your recovery email has been confirmed." });
  } catch (error) {
    return sendError(res, error, "Could not confirm the recovery email");
  }
};

/* ==================================================================== */
/* Account recovery — backup codes (§4.4 of the account-recovery plan)   */
/* ==================================================================== */

// Excludes 0/O and 1/I/L — characters easy to misread when a code is
// handwritten or read off a screen.
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const BACKUP_CODE_COUNT = 10;

const generateOneBackupCode = () => {
  let raw = "";
  for (let i = 0; i < 8; i++) {
    raw += BACKUP_CODE_ALPHABET[crypto.randomInt(BACKUP_CODE_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
};

// ---------- Generate backup codes (Settings → Security) ----------
// Replaces the whole set every time — regenerating invalidates every code
// generated before it, by design (matches the plan's "regenerating
// invalidates all" requirement, and means a leaked old code stops working
// the moment the owner notices and regenerates).
exports.generateBackupCodes = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const rawCodes = Array.from({ length: BACKUP_CODE_COUNT }, generateOneBackupCode);
    const hashedCodes = await Promise.all(rawCodes.map((code) => bcrypt.hash(code, 10)));

    user.backupCodes = hashedCodes.map((hash) => ({ hash, usedAt: null }));
    user.backupCodesGeneratedAt = new Date();
    await user.save({ validateModifiedOnly: true });

    sendBackupCodesGeneratedEmail({ to: user.email, name: user.name, count: BACKUP_CODE_COUNT }).catch((err) =>
      logger.error("Failed to send backup-codes-generated notice", { userId: String(user._id), error: err.message })
    );

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "user.backup_codes.generated",
      targetType: "user",
      targetId: String(user._id),
      severity: "warning",
    });

    // The ONLY time these exist in plaintext anywhere — never stored,
    // never logged, and unrecoverable the moment this response is sent.
    return res.json({
      message: "Save these codes somewhere safe. Each one works only once, and generating new codes invalidates these.",
      codes: rawCodes,
      generatedAt: user.backupCodesGeneratedAt,
    });
  } catch (error) {
    return sendError(res, error, "Could not generate backup codes");
  }
};

// ---------- Redeem a backup code (public — this IS the recovery path) ----------
// The one recovery path that needs neither the password nor a live Google
// session — reached when both of those are unavailable at once (see
// markdowns/NOTIF_EMAIL_ID_OCR_AND_ACCOUNT_RECOVERY_PLAN.md §4.1-4.4).
// Issues a narrow, short-lived "recovery" scope token (see
// middleware/auth.js's verifyRecoveryToken) that permits only setting a
// new password — never a full session.
exports.redeemBackupCode = async (req, res) => {
  // Always the same generic failure, whatever the actual reason — unknown
  // identifier, no codes ever generated, a wrong code, or an already-used
  // one. This endpoint must not become an oracle for any of those.
  const generic = { message: "That code didn't work. Check it and try again, or contact the PESO office for help." };
  try {
    const rawIdentifier = String(req.body.identifier || "").trim();
    const rawCode = String(req.body.code || "").trim().toUpperCase();
    if (!rawIdentifier || !rawCode) {
      return res.status(400).json(generic);
    }

    const user = await resolveIdentifierToUser(rawIdentifier);
    const activeCodes = (user?.backupCodes || []).filter((entry) => !entry.usedAt);

    let matchedEntry = null;
    if (activeCodes.length === 0) {
      // Pay the same bcrypt cost as a real check either way, so "no such
      // account", "no codes ever generated", and "wrong code" are all
      // indistinguishable by response time.
      await bcrypt.compare(rawCode, DUMMY_PASSWORD_HASH);
    } else {
      for (const entry of activeCodes) {
        // eslint-disable-next-line no-await-in-loop -- sequential by design: stop at the first match
        if (await bcrypt.compare(rawCode, entry.hash)) {
          matchedEntry = entry;
          break;
        }
      }
    }

    if (!user || !matchedEntry || user.staffRecoveryPending) {
      return res.status(400).json(generic);
    }

    // `matchedEntry` is the SAME subdocument reference held in
    // user.backupCodes (filter() above copied the array, not its elements),
    // so mutating it here is enough for save() below to persist it.
    matchedEntry.usedAt = new Date();
    // Invalidates every other live session; the recovery token issued below
    // is signed with this NEW value, so for a moment it is the only thing
    // that still works for this account at all.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save({ validateModifiedOnly: true });

    sendBackupCodeRedeemedEmail({ to: user.email, name: user.name }).catch((err) =>
      logger.error("Failed to send backup-code-redeemed alert", { userId: String(user._id), error: err.message })
    );

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "auth.backup_code.redeemed",
      targetType: "user",
      targetId: String(user._id),
      severity: "critical",
    });

    const recoveryToken = jwt.sign(
      { id: user._id, scope: "recovery", tokenVersion: user.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: `${RECOVERY_TOKEN_TTL_MINUTES}m` }
    );

    return res.json({
      message: "Code accepted. Set a new password to finish recovering your account.",
      recoveryToken,
      expiresInMinutes: RECOVERY_TOKEN_TTL_MINUTES,
    });
  } catch (error) {
    return sendError(res, error, "Could not process the request");
  }
};

// ---------- Finish recovery: set a new password (recovery-token only) ----------
// Mounted behind verifyRecoveryToken, not the normal session middleware —
// see that token's own scope check in middleware/auth.js. Deliberately the
// ONLY action a recovery token can take (the plan's draft also allowed
// setting a new recovery email here; dropped to keep this token's blast
// radius as small as possible — a successful recovery already restores a
// normal, fully-capable session below, which can set one the usual way).
exports.recoverSetPassword = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const newPassword = String(req.body.newPassword || "");
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "Your new password must be at least 8 characters." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (rejectWeakPassword(res, user, newPassword)) return;

    user.password = await bcrypt.hash(newPassword, 10);
    // Recovery also unlocks the account and drops any pending email code.
    user.loginLock = undefined;
    user.emailCode = undefined;
    // Spends this single-use recovery token the moment it's used for its
    // one allowed action — same bump-on-every-credential-change pattern as
    // changePassword/resetPassword/setPassword above.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save({ validateModifiedOnly: true });

    sendPasswordChangedEmail({ to: user.email, name: user.name }).catch((err) =>
      logger.error("Failed to send password-changed notification email", { userId: String(user._id), error: err.message })
    );

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "auth.account.recovered",
      targetType: "user",
      targetId: String(user._id),
      severity: "critical",
    });

    const token = jwt.sign(
      { id: user._id, role: user.role, tokenVersion: user.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({ message: "Your password has been set. You're signed in.", token });
  } catch (error) {
    return sendError(res, error, "Could not set the new password");
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
    if (user?.googleSignInDisabled || user?.staffRecoveryPending) {
      return res.status(403).json({ message: "Sign in with your password or finish your approved account recovery." });
    }
    // An unverified password account for this email may have been created
    // by someone else; never link Google to it (see purgeUnverifiedStub).
    if (isUnverifiedStub(user, email)) {
      const purged = await purgeUnverifiedStub(req, user);
      if (!purged) return res.status(409).json({ message: GOOGLE_RETRY_MESSAGE });
      user = null;
    }
    let isNewUser = false;

    if (!user) {
      // Employers attest 18+ and are created straight away (no DOB stored).
      if (signupRole === "employer") {
        if (!["true", "1", "on"].includes(String(req.body.confirmAdult ?? "").toLowerCase())) {
          return res.status(400).json({
            code: "EMPLOYER_ADULT_ATTESTATION_REQUIRED",
            message: "You must confirm that you are 18 years old or older.",
          });
        }
        user = await createGoogleAccount(req, { email, googleId, displayName, signupRole, dob: null });
        isNewUser = true;
      } else {
        // First-time jobseeker: nothing is created until a date of birth passes
        // the age check. The verified Google identity is carried in a short-lived
        // signed token (no DOB, no stored state) that /auth/google/complete
        // exchanges for the account.
        const pendingToken = jwt.sign(
          { purpose: GOOGLE_PENDING_PURPOSE, email, googleId, name: displayName },
          process.env.JWT_SECRET,
          { expiresIn: GOOGLE_PENDING_TTL }
        );
        return res.status(202).json({
          code: "DOB_REQUIRED",
          message: "Enter your date of birth to finish creating your account.",
          pendingToken,
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
      if (needsSave) await user.save({ validateModifiedOnly: true });
    }

    return finishGoogleLogin(req, res, user, isNewUser);
  } catch (error) {
    return googleRaceError(res, error);
  }
};

const GOOGLE_PENDING_PURPOSE = "google_signup";
const GOOGLE_PENDING_TTL = "10m";
const GOOGLE_RETRY_MESSAGE = "An account with this email was just created. Please try signing in again.";

const googleRaceError = (res, error) => {
  // Same email-uniqueness race as register/registerEmployer: two concurrent
  // first-time Google sign-ins (or a Google sign-in racing a plain
  // register) can both pass the find-or-create check before either
  // commits. The loser hits the unique index instead of creating a
  // duplicate — tell the user to just try signing in again.
  if (error.code === 11000) {
    return res.status(409).json({ message: GOOGLE_RETRY_MESSAGE });
  }
  return sendError(res, error, "Google sign-in failed");
};

// A self-service password account whose email was never verified. register()
// and registerEmployer() are the only writers of a literal `false` (legacy
// accounts leave it unset and are real), and login() refuses `false`, so such
// an account has never had a session. Anyone can create one for any address,
// which is why Google sign-in must not adopt it: linking used to keep the
// creator's password on an account the mailbox owner then started using.
const isUnverifiedStub = (user, email) =>
  Boolean(user) &&
  user.isEmailVerified === false &&
  !user.googleId &&
  normalizeEmail(user.email) === email &&
  (user.role === "jobseeker" || user.role === "employer");

// Deletes the stub (and its empty profile) so the normal first-time Google
// sign-up runs for the verified mailbox owner. The delete repeats the stub
// conditions, so an account verified or linked since it was read is left
// alone. Returns whether it was deleted.
async function purgeUnverifiedStub(req, user) {
  const { deletedCount } = await User.deleteOne({ _id: user._id, isEmailVerified: false, googleId: null });
  if (deletedCount !== 1) return false;

  await Promise.all([
    JobseekerProfile.deleteOne({ userId: user._id }),
    EmployerProfile.deleteOne({ userId: user._id }),
  ]);
  await logAuditEvent({
    req,
    actorRole: user.role,
    action: "auth.user.unverified_stub_replaced",
    targetType: "user",
    targetId: String(user._id),
    severity: "warning",
    metadata: { role: user.role },
  });
  return true;
}

// Creates the account for a first-time Google sign-in and drops the user
// into onboarding. `dob` is the validated date (jobseekers) or null (employers).
async function createGoogleAccount(req, { email, googleId, displayName, signupRole, dob }) {
  const user = await User.create({
    name: displayName,
    email,
    googleId,
    authProvider: "google",
    role: signupRole,
    ...(dob ? { dateOfBirth: dob, dobLockedAt: new Date(), dobSource: "google_pending" } : {}),
    // Google already verified this address before issuing the ID token
    // (checked by the caller via payload.email_verified) — no confirmation link
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
  await assignSuggestedUsername(user);

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
  return user;
}

// Reactivation, suspension check, JWT, audit and the login response shared by
// googleAuth (existing account / employer) and googleComplete (new jobseeker).
async function finishGoogleLogin(req, res, user, isNewUser) {
    // Soft-deleted: block before the self-deactivation auto-reactivation below.
    if (user.deletedAt) {
      return res.status(403).json({
        code: "ACCOUNT_DELETED",
        message: "This account no longer exists.",
      });
    }
    // Self-deactivated — a successful Google sign-in already proves identity
    // ownership the same way a correct password would, so it reactivates the
    // account here too (see the matching comment in login()).
    let reactivated = false;
    if (user.isActive === false && user.accountStatus === "deactivated") {
      user.isActive = true;
      user.accountStatus = "active";
      user.deactivatedAt = null;
      await user.save({ validateModifiedOnly: true });
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
        username: user.username || null,
        role: user.role,
        verificationStatus: user.verificationStatus,
        isEmailVerified: user.isEmailVerified === true,
        hasVerifiedEmail: hasVerifiedEmail(user),
        hasCompletedOnboarding: user.hasCompletedOnboarding,
        onboardingComplete: user.onboardingComplete,
        acceptedTermsAt: user.acceptedTermsAt,
        termsVersion: user.termsVersion,
      },
      termsVersion: CURRENT_TERMS_VERSION,
      ...(reactivated ? { reactivated: true } : {}),
    });
}

// ---------- Google sign-in, step 2: date of birth for a first-time jobseeker ----------
// Exchanges the pendingToken from googleAuth plus a date of birth for the
// account. Under the minimum age nothing is created or stored.
exports.googleComplete = async (req, res) => {
  try {
    const pendingToken = String(req.body.pendingToken || "").trim();
    let pending;
    try {
      pending = jwt.verify(pendingToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({
        code: "GOOGLE_PENDING_EXPIRED",
        message: "Your Google sign-up expired. Please start again.",
      });
    }
    if (!pending || pending.purpose !== GOOGLE_PENDING_PURPOSE || !pending.email || !pending.googleId) {
      return res.status(401).json({
        code: "GOOGLE_PENDING_EXPIRED",
        message: "Your Google sign-up expired. Please start again.",
      });
    }

    const dob = validateDobInput(req.body.dateOfBirth);
    if (!dob.ok) {
      return res.status(400).json({ code: dob.code, message: DOB_ERROR_MESSAGES[dob.code] });
    }

    // Someone may have registered the same email since the first step.
    let existing = await User.findOne({ $or: [{ googleId: pending.googleId }, { email: pending.email }] });
    // A password stub registered during the pending window must not block
    // (or later hijack) this sign-up — same rule as googleAuth.
    if (isUnverifiedStub(existing, pending.email) && (await purgeUnverifiedStub(req, existing))) {
      existing = null;
    }
    if (existing) {
      return res.status(409).json({
        message: "An account with this email already exists. Please sign in instead.",
      });
    }

    const user = await createGoogleAccount(req, {
      email: pending.email,
      googleId: pending.googleId,
      displayName: pending.name,
      signupRole: "jobseeker",
      dob: dob.date,
    });
    return finishGoogleLogin(req, res, user, true);
  } catch (error) {
    return googleRaceError(res, error);
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
    return sendError(res, error, "Could not process the request");
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
    await user.save({ validateModifiedOnly: true });

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
    return sendError(res, error, "Could not verify the email");
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
    return sendError(res, error);
  }
};

exports.CURRENT_TERMS_VERSION = CURRENT_TERMS_VERSION;

// Fields that must never reach the client as part of a serialized User
// object. `password` was the original (and only) entry; `backupCodes` and
// `recoveryEmailToken` joined it with the account-recovery feature —
// `backupCodes` especially, since those are bcrypt hashes of a short,
// human-typable secret (8 chars from a 32-char alphabet) rather than a
// hash of a 32-byte random token, so an exposed hash array is far more
// exposed to realistic offline brute-forcing than the other hashed-token
// fields already on this model.
const CLIENT_UNSAFE_FIELDS = "-password -backupCodes -recoveryEmailToken -governmentIdOcr.rawText";

// ---------- Get current user (basic) ----------
// True when this account has a usable local password (Google-only accounts
// have none until they add one via setPassword, below). A separate
// existence check rather than loading `user.password` itself, so the hash
// never has to pass through a JS object that then gets serialized to the
// client — one less place a future change to this function could leak it.
const checkHasPassword = async (userId) =>
  Boolean(await User.exists({ _id: userId, password: { $exists: true, $ne: null } }));

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(CLIENT_UNSAFE_FIELDS);
    if (!user) return res.status(404).json({ message: "User not found" });
    const hasPassword = await checkHasPassword(user._id);
    // ageTier is computed per request on the server (never stored or put in the JWT).
    res.json({
      ...user.toObject(),
      cover: await resolveCover(user.cover),
      avatarPreset: await resolveAvatarPreset(user.avatar),
      hasPassword,
      ageTier: getAgeTier(user.dateOfBirth),
      hasVerifiedEmail: hasVerifiedEmail(user),
      hasPendingEmail: Boolean(user.pendingEmail),
    });
  } catch (error) {
    sendError(res, error);
  }
};

// ---------- Get full profile (user + role-specific profile) ----------
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select(CLIENT_UNSAFE_FIELDS);
    if (!user) return res.status(404).json({ message: "User not found" });

    let profile = null;
    if (user.role === "jobseeker") {
      profile = await JobseekerProfile.findOne({ userId: user._id });
    } else if (user.role === "employer") {
      profile = await EmployerProfile.findOne({ userId: user._id });
    }

    const profileCompleteness =
      user.role === "jobseeker" ? computeProfileCompleteness(user, profile) : null;
    const hasPassword = await checkHasPassword(user._id);

    res.json({
      user: {
        ...user.toObject(),
        cover: await resolveCover(user.cover),
        avatarPreset: await resolveAvatarPreset(user.avatar),
        hasPassword,
        ageTier: getAgeTier(user.dateOfBirth),
        hasVerifiedEmail: hasVerifiedEmail(user),
        hasPendingEmail: Boolean(user.pendingEmail),
      },
      profile,
      profileCompleteness,
    });
  } catch (error) {
    sendError(res, error);
  }
};

// ---------- Unified updateProfile ----------
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const currentUser = await User.findById(userId).select("role password verificationStatus dateOfBirth phone username email name");
    if (!currentUser) return res.status(404).json({ message: "User not found" });

    // ---- 1. Email is immutable through this endpoint ----
    // Changing the sign-in email now goes through the verified flow
    // (POST /auth/email-change/request + /confirm), so any `email` in this
    // payload is ignored here.
    delete req.body.email;

    // ---- 2. Staff (admin / superadmin) password change ----
    // Same rules as changePassword: the shared policy, no reuse of the current
    // password, and (in step 8) every existing session is revoked.
    const isStaff = currentUser.role === "admin" || currentUser.role === "superadmin";
    const staffNewPassword = isStaff && req.body.newPassword ? String(req.body.newPassword) : "";
    if (staffNewPassword) {
      const isCurrentValid = await bcrypt.compare(String(req.body.currentPassword || ""), currentUser.password || "");
      if (!isCurrentValid) return res.status(400).json({ message: "Current password is incorrect" });
      if (staffNewPassword.length < 8) return res.status(400).json({ message: "New password must be at least 8 characters" });
      if (rejectWeakPassword(res, currentUser, staffNewPassword)) return;
      if (await bcrypt.compare(staffNewPassword, currentUser.password)) {
        return res.status(400).json({ message: "The new password must be different from the current one." });
      }
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
    // Phone: validated here (this route has no validator middleware). New values
    // are stored as E.164. A phone that did not change is never re-validated, so a
    // legacy value cannot block an unrelated save; if it parses it is upgraded.
    if (commonUpdates.phone !== undefined && commonUpdates.phone !== null) {
      const submittedPhone = String(commonUpdates.phone).trim();
      const phoneOptions = { allowLandline: allowLandlineForRole(currentUser.role) };
      if (submittedPhone === "") {
        commonUpdates.phone = "";
      } else if (submittedPhone === String(currentUser.phone ?? "").trim()) {
        commonUpdates.phone = canonicalPhone(submittedPhone, phoneOptions);
      } else {
        const parsedPhone = parsePhone(submittedPhone, phoneOptions);
        if (!parsedPhone.ok) {
          return res.status(400).json({ code: parsedPhone.code, message: phoneMessage(parsedPhone.code), field: "phone", params: parsedPhone.params });
        }
        commonUpdates.phone = parsedPhone.e164;
      }
    }
    // The date of birth is locked once set: only an admin with documentary
    // proof can change it. An unchanged value echoed back by a full-form save
    // is ignored; a different value is refused. Employers never store one.
    if (req.body.dateOfBirth !== undefined && currentUser.role !== "employer") {
      const submittedDob = parseDateOnly(req.body.dateOfBirth);
      if (currentUser.dateOfBirth) {
        const sameDay = submittedDob && submittedDob.getTime() === parseDateOnly(currentUser.dateOfBirth).getTime();
        if (!sameDay) {
          return res.status(403).json({ code: "DOB_LOCKED", message: DOB_ERROR_MESSAGES.DOB_LOCKED });
        }
      } else {
        const dob = validateDobInput(req.body.dateOfBirth);
        if (!dob.ok) {
          return res.status(400).json({ code: dob.code, message: DOB_ERROR_MESSAGES[dob.code] });
        }
        commonUpdates.dateOfBirth = dob.date;
        commonUpdates.dobLockedAt = new Date();
        commonUpdates.dobSource = "legacy_prompt";
      }
    }
    if (req.body.gender !== undefined) commonUpdates.gender = req.body.gender || null;
    // Government ID type/number — verification status is explicitly out of
    // scope (data-entry only). Reject silently (ignore) rather than 400 on
    // an unrecognized type, consistent with how industryPreferenceLevel
    // below is handled — the client dropdown already constrains the choice,
    // this is defense-in-depth, not the primary gate.
    if (req.body.governmentIdType !== undefined) {
      const submittedType = req.body.governmentIdType || null;
      if (submittedType === null) {
        commonUpdates.governmentIdType = null;
        // No type at all means "please specify" has nothing to describe.
        commonUpdates.governmentIdTypeOther = null;
      } else {
        const activeGovIdTypes = await getActiveValues("governmentIdType");
        if (activeGovIdTypes.size === 0 || activeGovIdTypes.has(submittedType)) {
          commonUpdates.governmentIdType = submittedType;
          // Stale "please specify" text from a previous "Other" selection
          // shouldn't linger once the type is no longer "Other".
          if (submittedType !== GOVERNMENT_ID_TYPE_OTHER) {
            commonUpdates.governmentIdTypeOther = null;
          }
        }
      }
    }
    if (req.body.governmentIdNumber !== undefined) commonUpdates.governmentIdNumber = req.body.governmentIdNumber || null;
    if (req.body.governmentIdTypeOther !== undefined && commonUpdates.governmentIdTypeOther === undefined) {
      commonUpdates.governmentIdTypeOther = req.body.governmentIdTypeOther || null;
    }

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
          const activeIndustries = await getActiveValues("industry");
          const validSelectedIndustries =
            activeIndustries.size === 0
              ? industries
              : industries.filter((ind) => activeIndustries.has(ind));
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
    if (storedValueOf("validIdFile")) {
      commonUpdates.validIdFile = storedValueOf("validIdFile");
      commonUpdates.governmentIdSubmittedAt = new Date();
    }
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
    if (storedValueOf("supportingDocument")) {
      commonUpdates.validIdFile = storedValueOf("supportingDocument");
      commonUpdates.governmentIdSubmittedAt = new Date();
    }

    const fieldRemovals = getDocumentFieldRemovals(req.body || {});
    if (documentsLocked) {
      delete fieldRemovals.businessPermitUrl;
      delete fieldRemovals.registrationDocUrl;
    }
    // Clearing the ID file also clears what it described — a type/number
    // left behind with no file would be stale, orphaned metadata.
    if (fieldRemovals.validIdFile === null) {
      fieldRemovals.governmentIdOcr = { status: "none" };
      fieldRemovals.governmentIdType = null;
      fieldRemovals.governmentIdNumber = null;
      fieldRemovals.governmentIdTypeOther = null;
      fieldRemovals.governmentIdSubmittedAt = null;
    }
    Object.assign(commonUpdates, fieldRemovals);

    const idFile = req.files?.supportingDocument?.[0] || req.files?.validIdFile?.[0];
    const ocrRunId = currentUser.role === "jobseeker" && idFile?.storedValue && commonUpdates.validIdFile ? crypto.randomUUID() : null;
    if (ocrRunId) commonUpdates.governmentIdOcr = { status: "queued", runId: ocrRunId };

    // Onboarding completion flag
    if (req.body.onboardingComplete === true || req.body.onboardingComplete === "true") {
      // With the username sign-up feature on, a jobseeker must have a plausible
      // phone number to finish onboarding (the browser already asks for it; this
      // is the server enforcing it). Format check only. The phone being saved in
      // this same request counts.
      if (isUsernameSignupEnabled() && currentUser.role === "jobseeker") {
        const effectivePhone = commonUpdates.phone !== undefined ? commonUpdates.phone : currentUser.phone;
        const problem = phoneProblem(effectivePhone);
        if (problem) {
          return res.status(400).json({
            code: problem,
            message: problem === "PHONE_REQUIRED" ? "Add your phone number to finish setting up." : "Enter a valid phone number.",
            field: "phone",
          });
        }
      }
      commonUpdates.hasCompletedOnboarding = true;
      commonUpdates.onboardingComplete = true;
    }

    // ---- 5. Apply common updates ----
    const cleanCommon = Object.fromEntries(
      Object.entries(commonUpdates).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(cleanCommon).length > 0) {
      // runValidators: enum-constrained fields here (workExperience,
      // educationalAttainment, availabilityStatus, gender, ...) are taken
      // straight from req.body above with no allowlist check of their own —
      // this is the only thing stopping an arbitrary string from being
      // written. findByIdAndUpdate skips schema validation entirely by
      // default, which is almost certainly how a handful of pre-existing
      // accounts ended up with values no longer in workExperience's enum
      // (see scripts/migrateWorkExperienceLegacyValues.js) — those writes
      // went straight through, unchecked. context:"query" is the companion
      // Mongoose expects so a custom validator's `this` refers to the query
      // being run, not an empty object (none of the validators on these
      // specific fields use `this` today, but every other update-validated
      // call in this file sets it too — see the ones below).
      //
      // Update validators (unlike a document's own .save()) only check the
      // fields actually being set here, not the whole document — so this
      // can't be blocked by some OTHER, unrelated field already holding a
      // legacy value, the way a narrow .save() elsewhere in this file could
      // be (see validateModifiedOnly on those).
      await User.findByIdAndUpdate(userId, cleanCommon, { runValidators: true, context: "query" });
      // The user row now references any newly uploaded files (ID, resume,
      // permit, ...). A failure in a later step must not let the upload
      // cleanup delete files the saved record points at.
      req.uploadsCommitted = true;
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
      if (allFields.civilStatus !== undefined) {
        profileData.civilStatus = allFields.civilStatus || null;
        // Stale "please specify" text shouldn't linger once "Other" is no
        // longer selected — mirrors governmentIdTypeOther's clearing above.
        if (allFields.civilStatus !== "Other") {
          profileData.civilStatusOther = null;
        }
      }
      if (allFields.civilStatusOther !== undefined && profileData.civilStatusOther === undefined) {
        profileData.civilStatusOther = allFields.civilStatusOther || null;
      }
      if (allFields.placeOfBirth !== undefined) profileData.placeOfBirth = allFields.placeOfBirth || null;
      if (allFields.citizenship !== undefined) profileData.citizenship = tidyCitizenship(allFields.citizenship) || null;
      if (allFields.height !== undefined) profileData.height = allFields.height ? parseFloat(allFields.height) : null;
      if (allFields.heightUnit !== undefined) profileData.heightUnit = normalizeHeightUnit(allFields.heightUnit);
      if (allFields.weight !== undefined) profileData.weight = allFields.weight ? parseFloat(allFields.weight) : null;
      if (allFields.weightUnit !== undefined) profileData.weightUnit = normalizeWeightUnit(allFields.weightUnit);
      if (allFields.landline !== undefined) profileData.landline = allFields.landline || null;
      // The stored profile is read only when a submitted value fails a check, to
      // let an unchanged legacy value through (it must not block an unrelated save).
      let existingProfileForCompare;
      const unchangedOnProfile = async (field, value) => {
        if (existingProfileForCompare === undefined) {
          existingProfileForCompare = await JobseekerProfile.findOne({ userId }).select(`${field} mobileSecondary employmentStatus employmentType unemploymentReason`).lean();
        }
        return String(existingProfileForCompare?.[field] ?? "") === String(value ?? "");
      };
      if (allFields.mobileSecondary !== undefined) {
        const secondary = String(allFields.mobileSecondary || "").trim();
        if (!secondary || !secondary.replace(/\D/g, "")) {
          profileData.mobileSecondary = null;
        } else {
          const parsedSecondary = parsePhone(secondary, { allowLandline: false });
          if (parsedSecondary.ok) {
            profileData.mobileSecondary = parsedSecondary.e164;
          } else if (await unchangedOnProfile("mobileSecondary", secondary)) {
            profileData.mobileSecondary = secondary;
          } else {
            return res.status(400).json({ code: parsedSecondary.code, message: phoneMessage(parsedSecondary.code), field: "mobileSecondary", params: parsedSecondary.params });
          }
        }
      }
      for (const [field, allowed] of [
        ["employmentStatus", EMPLOYMENT_STATUS_VALUES],
        ["employmentType", EMPLOYMENT_TYPE_VALUES],
        ["unemploymentReason", UNEMPLOYMENT_REASON_VALUES],
      ]) {
        const submitted = allFields[field];
        if (submitted === undefined || submitted === null || submitted === "") continue;
        if (!allowed.includes(submitted) && !(await unchangedOnProfile(field, submitted))) {
          return res.status(400).json({ code: "ENUM_INVALID", message: "That choice is not allowed.", field });
        }
      }
      if (allFields.presentAddress !== undefined) {
        profileData.presentAddress = parseJSON(allFields.presentAddress, { street: "", barangay: "", municipality: "", province: "", region: "" });
      }
      if (allFields.permanentAddress !== undefined) {
        profileData.permanentAddress = parseJSON(allFields.permanentAddress, { street: "", barangay: "", municipality: "", province: "", region: "" });
      }
      if (allFields.disability !== undefined) {
        const parsedDisability = parseJSON(allFields.disability, []);
        profileData.disability = parsedDisability;
        // Stale "please specify" text shouldn't linger once "Others" is no
        // longer checked — items 14/15's "Other, please specify" fallback.
        if (!Array.isArray(parsedDisability) || !parsedDisability.includes("Others")) {
          profileData.disabilityOther = null;
        }
      }
      if (allFields.disabilityOther !== undefined && profileData.disabilityOther === undefined) {
        profileData.disabilityOther = allFields.disabilityOther || null;
      }
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
      // Preferred work arrangement (job type / work nature) — these feed
      // semanticService.employmentTypeScore.
      if (allFields.preferredJobTypes !== undefined) profileData.preferredJobTypes = parseJSON(allFields.preferredJobTypes, []);
      if (allFields.preferredWorkNature !== undefined) profileData.preferredWorkNature = parseJSON(allFields.preferredWorkNature, []);

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
      if (allFields.eligibilities !== undefined) profileData.eligibilities = tidyNamedList(parseJSON(allFields.eligibilities, []));
      if (allFields.professionalLicenses !== undefined) profileData.professionalLicenses = tidyNamedList(parseJSON(allFields.professionalLicenses, []));
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
    // Bumping tokenVersion signs out every other session (a leaked token is
    // the usual reason to change a password); the caller gets a fresh token
    // in the response so this session stays signed in.
    let refreshedToken = null;
    if (staffNewPassword) {
      const hashedPassword = await bcrypt.hash(staffNewPassword, 10);
      const rotated = await User.findByIdAndUpdate(
        userId,
        { $set: { password: hashedPassword, mustChangePassword: false }, $inc: { tokenVersion: 1 } },
        { new: true }
      );
      if (rotated) {
        refreshedToken = jwt.sign(
          { id: rotated._id, role: rotated.role, tokenVersion: rotated.tokenVersion },
          process.env.JWT_SECRET,
          { expiresIn: "30d" }
        );
      }

      if (currentUser.email) {
        sendPasswordChangedEmail({ to: currentUser.email, name: currentUser.name }).catch((err) =>
          logger.error("Failed to send password-changed notification email", { userId: String(userId), error: err.message })
        );
      }
      void accountAlerts.notifyPasswordChanged(userId, req);

      await runPostCommit("profile_update.password_audit", { req, resourceType: "user", resourceId: userId }, () => logAuditEvent({
        req,
        actorId: userId,
        actorRole: currentUser.role,
        action: "user.password.changed",
        targetType: "user",
        targetId: String(userId),
        severity: "warning",
      }));
    }

    // ---- 9. Fetch updated user ----
    const updatedUser = await User.findById(userId).select(CLIENT_UNSAFE_FIELDS);

    // Profile is saved; the audit write is best-effort so a failure cannot
    // turn this into an error response (or skip scheduling OCR below).
    await runPostCommit("profile_update.audit", { req, resourceType: "user", resourceId: userId }, () => logAuditEvent({
      req,
      actorId: userId,
      actorRole: currentUser.role,
      action: "user.profile.updated",
      targetType: "user",
      targetId: String(userId),
      severity: "info",
    }));

    if (ocrRunId && !req.ocrCancelled) {
      req.ocrScheduled = true;
      scheduleIdOcr({ userId, file: idFile, runId: ocrRunId, io: req.app.get("io"), release: req.releaseOcrSlot });
    }
    res.json({
      message: "Profile updated successfully",
      user: updatedUser,
      profile: updatedProfile,
      profileCompleteness:
        currentUser.role === "jobseeker" ? computeProfileCompleteness(updatedUser, updatedProfile) : null,
      ...(refreshedToken ? { token: refreshedToken } : {}),
    });
  } catch (error) {
    console.error("Update profile error:", error);
    // A schema validation failure here (e.g. an enum field like
    // workExperience) means the client sent a value the server won't
    // accept — not an internal failure, and not sensitive. Surface the
    // specific field message as a 400 instead of the generic 500 fallback,
    // so "this value isn't valid" doesn't read to the user as "something
    // broke" with no way to tell what to fix.
    if (error.name === "ValidationError") {
      const firstError = Object.values(error.errors || {})[0];
      return sendError(res, error, firstError?.message || "Please check the values you entered and try again.", 400);
    }
    sendError(res, error);
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

    const user = await User.findById(userId).select("profileImage avatar");
    if (!user) return res.status(404).json({ message: "User not found" });

    const previous = user.profileImage;
    user.profileImage = storedValue;
    // A newly uploaded photo replaces a chosen preset avatar (the preset is shown instead of the photo).
    user.avatar = undefined;
    await user.save({ validateModifiedOnly: true });

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
    sendError(res, error);
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
  "notifyAccountRecovery",
];
// Same categories as above, plus the "emailAll" master switch — see
// User.emailNotificationPreferences and notificationService.queueNotificationEmail.
const EMAIL_NOTIFICATION_PREFERENCE_KEYS = [...NOTIFICATION_PREFERENCE_KEYS, "emailAll"];
const PROFILE_VISIBILITY_VALUES = ["public", "employers", "hidden"];
const ALLOW_MESSAGES_FROM_VALUES = ["anyone", "employers"];

exports.getSettings = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select(
      "notificationPreferences emailNotificationPreferences privacy"
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      notificationPreferences: user.notificationPreferences,
      emailNotificationPreferences: user.emailNotificationPreferences,
      privacy: user.privacy,
    });
  } catch (error) {
    sendError(res, error, "Could not load settings");
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { notificationPreferences, emailNotificationPreferences, privacy } = req.body || {};

    const $set = {};

    if (notificationPreferences && typeof notificationPreferences === "object") {
      for (const key of NOTIFICATION_PREFERENCE_KEYS) {
        if (typeof notificationPreferences[key] === "boolean") {
          $set[`notificationPreferences.${key}`] = notificationPreferences[key];
        }
      }
    }

    if (emailNotificationPreferences && typeof emailNotificationPreferences === "object") {
      for (const key of EMAIL_NOTIFICATION_PREFERENCE_KEYS) {
        if (typeof emailNotificationPreferences[key] === "boolean") {
          $set[`emailNotificationPreferences.${key}`] = emailNotificationPreferences[key];
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
      // "Show my active status": strictly a boolean; anything else is ignored
      // (and rejected with 400 below if it was the only field sent).
      if (typeof privacy.showActiveStatus === "boolean") {
        $set["privacy.showActiveStatus"] = privacy.showActiveStatus;
      }
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ message: "No valid settings fields were provided." });
    }

    const user = await User.findByIdAndUpdate(userId, { $set }, { new: true }).select(
      "notificationPreferences emailNotificationPreferences privacy"
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    // Takes effect immediately over the existing sockets (no reconnect): peers
    // are told hidden / the current state, and this user gets a fresh
    // snapshot or a reset. Best-effort: the service never throws.
    if (Object.prototype.hasOwnProperty.call($set, "privacy.showActiveStatus")) {
      const activeStatus = req.app && req.app.get("activeStatus");
      if (activeStatus) activeStatus.onVisibilityChanged(userId);
    }

    res.json({
      message: "Settings saved.",
      notificationPreferences: user.notificationPreferences,
      emailNotificationPreferences: user.emailNotificationPreferences,
      privacy: user.privacy,
    });
  } catch (error) {
    sendError(res, error, "Could not save settings");
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
    const passwordOk = await loginLock.checkPasswordWithLock(user, password, { req });
    if (!passwordOk) {
      return res.status(400).json({ message: "Your password is incorrect." });
    }

    if (user.isActive === false) {
      return res.status(400).json({ message: "This account is already deactivated." });
    }

    user.isActive = false;
    user.accountStatus = "deactivated";
    user.deactivatedAt = new Date();
    await user.save({ validateModifiedOnly: true });

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
    return sendError(res, error, "Could not deactivate the account");
  }
};
