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
const {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendEmailChangeVerification,
  sendEmailChangeAlert,
} = require("../services/mailService");
const { OAuth2Client } = require("google-auth-library");
const { isAdultAge, MIN_ACCOUNT_AGE } = require("../utils/age");

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
// SHA-256 of any link token, so a DB leak can't be replayed against the flow.
const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");
const hashResetToken = hashToken; // kept for existing call sites

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  let Model = role === "resident" ? JobseekerProfile : EmployerProfile;
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

// ---------- Registration ----------
exports.register = async (req, res) => {
  const { name, email, password, surname, firstName, middleName, suffix, dateOfBirth } = req.body;
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
      role: "resident",
    });

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: "resident",
      action: "auth.user.registered",
      targetUserId: user._id,
      targetType: "user",
      targetId: String(user._id),
      severity: "info",
    });

    await JobseekerProfile.create({ userId: user._id });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      message: "User registered successfully",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        hasCompletedOnboarding: false,
        onboardingComplete: false,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.registerEmployer = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashed,
      role: "employer",
      verificationStatus: "pending",
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

    const token = jwt.sign(
      { id: user._id, role: user.role },
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

    const admins = await User.find({ role: "admin" }).select("_id");
    await notifyManyUsers({
      recipientIds: admins.map((admin) => admin._id),
      actorId: user._id,
      type: "admin_action",
      title: "New employer pending verification",
      message: `${user.name} registered as an employer and is awaiting verification.`,
      relatedEntityType: "user",
      relatedEntityId: user._id,
      actionUrl: "/admin/users",
      io: req.app.get("io"),
    });

    res.status(201).json({
      message: "Employer registered. Please complete your profile.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        verificationStatus: user.verificationStatus,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Login ----------
exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid password" });

    if (user.isActive === false) {
      // Credentials are valid but the account is suspended/banned. Issue a
      // narrow "appeal-only" token so the client can render the suspension
      // wall and let the user file an appeal to LMD Admin — nothing else.
      const appealToken = jwt.sign(
        { id: user._id, scope: "appeal" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
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
      { id: user._id, role: user.role },
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
        hasCompletedOnboarding: user.hasCompletedOnboarding,
        onboardingComplete: user.onboardingComplete,
        acceptedTermsAt: user.acceptedTermsAt,
        termsVersion: user.termsVersion,
      },
      termsVersion: CURRENT_TERMS_VERSION,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------- Forgot password: issue a reset link ----------
exports.forgotPassword = async (req, res) => {
  // Always answer the same way so this endpoint can't be used to probe which
  // emails have accounts.
  const generic = { message: "If that email is registered, a password reset link has been sent." };
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
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
      action: "auth.password_reset_requested",
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
    const email = String(req.body.email || "").trim().toLowerCase();
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
    await user.save();

    // Security notice to the account's own address (fire-and-forget — a mail
    // hiccup must not fail a completed reset).
    sendPasswordChangedEmail({ to: user.email, name: user.name }).catch(() => {});

    await logAuditEvent({
      req,
      actorId: user._id,
      actorRole: user.role,
      action: "auth.password_reset_completed",
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
    const newEmail = String(req.body.newEmail || "").trim().toLowerCase();
    const currentPassword = String(req.body.currentPassword || "");

    if (!newEmail) return res.status(400).json({ message: "Enter the new email address." });
    if (!EMAIL_RE.test(newEmail)) {
      return res.status(400).json({ message: "That doesn't look like a valid email address." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (newEmail === String(user.email).toLowerCase()) {
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
    const email = String(req.body.email || "").trim().toLowerCase(); // the NEW address

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

    const email = String(payload.email).trim().toLowerCase();
    const googleId = String(payload.sub);
    const displayName = (payload.name || "").trim() || email.split("@")[0];

    let user = await User.findOne({ $or: [{ googleId }, { email }] });
    let isNewUser = false;

    if (!user) {
      // First sign-in with no existing account → create one and drop the user
      // into onboarding to pick a role and finish their profile.
      user = await User.create({
        name: displayName,
        email,
        googleId,
        authProvider: "google",
        role: "resident",
      });
      await JobseekerProfile.create({ userId: user._id });
      isNewUser = true;

      await logAuditEvent({
        req,
        actorId: user._id,
        actorRole: "resident",
        action: "auth.user.registered",
        targetUserId: user._id,
        targetType: "user",
        targetId: String(user._id),
        severity: "info",
      });
    } else if (!user.googleId) {
      // Existing password account with the same (Google-verified) email — link it.
      user.googleId = googleId;
      await user.save();
    }

    if (user.isActive === false) {
      const appealToken = jwt.sign(
        { id: user._id, scope: "appeal" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
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
      { id: user._id, role: user.role },
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
        hasCompletedOnboarding: user.hasCompletedOnboarding,
        onboardingComplete: user.onboardingComplete,
        acceptedTermsAt: user.acceptedTermsAt,
        termsVersion: user.termsVersion,
      },
      termsVersion: CURRENT_TERMS_VERSION,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Google sign-in failed" });
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
    if (user.role === "resident") {
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
    const currentUser = await User.findById(userId).select("role password");
    if (!currentUser) return res.status(404).json({ message: "User not found" });

    // ---- 1. Email is immutable through this endpoint ----
    // Changing the sign-in email now goes through the verified flow
    // (POST /auth/email-change/request + /confirm), so any `email` in this
    // payload is ignored here.
    delete req.body.email;

    // ---- 2. Admin password change ----
    if (currentUser.role === "admin" && req.body.newPassword) {
      const isCurrentValid = await bcrypt.compare(req.body.currentPassword || "", currentUser.password);
      if (!isCurrentValid) return res.status(400).json({ message: "Current password is incorrect" });
      if (req.body.newPassword.length < 8) return res.status(400).json({ message: "New password must be at least 8 characters" });
    }

    // ---- 3. Prepare common user updates ----
    const commonUpdates = {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      about: req.body.about,
      address: req.body.address,
      dateOfBirth: req.body.dateOfBirth || null,
      gender: req.body.gender || null,
    };

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

    // For residents, also update career fields (but NOT skills – moved to profile)
    if (currentUser.role === "resident") {
      commonUpdates.desiredJobTitle = req.body.desiredJobTitle || null;
      commonUpdates.workExperience = req.body.workExperience || null;
      commonUpdates.educationalAttainment = req.body.educationalAttainment || null;
      commonUpdates.availabilityStatus = req.body.availabilityStatus || null;
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
      const employerCommonFields = ["companyName", "industry", "companySize", "website", "companyDescription", "businessAddress"];
      employerCommonFields.forEach(field => {
        if (req.body[field] !== undefined) commonUpdates[field] = req.body[field];
      });
    }

    // ---- 4. File uploads (persisted to storage backend by persistFields middleware) ----
    const storedValueOf = (field) => req.files?.[field]?.[0]?.storedValue;
    if (storedValueOf("resumeFile")) commonUpdates.resumeFile = storedValueOf("resumeFile");
    if (storedValueOf("validIdFile")) commonUpdates.validIdFile = storedValueOf("validIdFile");
    if (storedValueOf("businessPermit")) commonUpdates.businessPermitUrl = storedValueOf("businessPermit");
    if (storedValueOf("registrationDoc")) commonUpdates.registrationDocUrl = storedValueOf("registrationDoc");
    if (storedValueOf("resume")) commonUpdates.resumeFile = storedValueOf("resume");
    if (storedValueOf("supportingDocument")) commonUpdates.validIdFile = storedValueOf("supportingDocument");

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

    if (currentUser.role === "resident") {
      profileData = {
        civilStatus: allFields.civilStatus || null,
        placeOfBirth: allFields.placeOfBirth || null,
        citizenship: allFields.citizenship || null,
        height: allFields.height ? parseFloat(allFields.height) : null,
        weight: allFields.weight ? parseFloat(allFields.weight) : null,
        landline: allFields.landline || null,
        mobileSecondary: allFields.mobileSecondary || null,
        presentAddress: parseJSON(allFields.presentAddress, { street: "", barangay: "", municipality: "", province: "", region: "" }),
        permanentAddress: parseJSON(allFields.permanentAddress, { street: "", barangay: "", municipality: "", province: "", region: "" }),
        disability: parseJSON(allFields.disability, []),
        is4psBeneficiary: allFields.is4psBeneficiary === "true",
        _4psHouseholdId: allFields._4psHouseholdId || null,
        isOfw: allFields.isOfw === "true",
        isRepatriated: allFields.isRepatriated === "true",
        repatriationIntent: allFields.repatriationIntent || null,
        employmentStatus: allFields.employmentStatus || null,
        employmentType: allFields.employmentType || null,
        unemploymentReason: allFields.unemploymentReason || null,
        laidoffCountry: allFields.laidoffCountry || null,
        passportNo: allFields.passportNo || null,
        passportExpiryDate: allFields.passportExpiryDate || null,
        // ==== FIX: skills saved to jobseeker profile ====
        skills: parseJSON(allFields.skills, []),
        // Industry preferences
        preferredIndustries: parseJSON(allFields.preferredIndustries, []),

        // Religion & government IDs (optional)
        religion: allFields.religion || null,
        tin: allFields.tin || null,
        sssGsisNo: allFields.sssGsisNo || null,
        pagibigNo: allFields.pagibigNo || null,
        philhealthNo: allFields.philhealthNo || null,

        // Job preference
        preferredOccupations: parseJSON(allFields.preferredOccupations, []),
        preferredWorkLocationLocal: parseJSON(allFields.preferredWorkLocationLocal, []),
        preferredWorkLocationOverseas: parseJSON(allFields.preferredWorkLocationOverseas, []),
        expectedSalaryMin: allFields.expectedSalaryMin ? parseFloat(allFields.expectedSalaryMin) : null,
        expectedSalaryMax: allFields.expectedSalaryMax ? parseFloat(allFields.expectedSalaryMax) : null,

        // Educational background detail
        schoolAttended: allFields.schoolAttended || null,
        schoolAttendedOther: allFields.schoolAttendedOther || null,
        course: allFields.course || null,
        yearGraduated: allFields.yearGraduated || null,

        // Language proficiency
        languageProficiency: parseJSON(allFields.languageProficiency, undefined),
        languageOthersLabel: allFields.languageOthersLabel || null,

        // Work history / training / eligibility / licenses
        workHistory: parseJSON(allFields.workHistory, []),
        vocationalTrainings: parseJSON(allFields.vocationalTrainings, []),
        eligibilities: parseJSON(allFields.eligibilities, []),
        professionalLicenses: parseJSON(allFields.professionalLicenses, []),
      };

      if (profileData.languageProficiency === undefined) delete profileData.languageProficiency;
    } else if (currentUser.role === "employer") {
      profileData = {
        tradeName: allFields.tradeName || null,
        acronym: allFields.acronym || null,
        tin: allFields.tin || null,
        officeType: allFields.officeType || null,
        employerClassification: parseJSON(allFields.employerClassification, { type: null, subtype: null }),
        totalWorkforceSize: allFields.totalWorkforceSize || null,
        businessAddress: parseJSON(allFields.businessAddressStructured, { street: "", barangay: "", municipality: "", province: "", region: "" }),
        ownerName: allFields.ownerName || null,
        contactPersonName: allFields.contactPersonName || null,
        contactPersonPosition: allFields.contactPersonPosition || null,
        fax: allFields.fax || null,
      };
    }

    // ---- 7. Upsert profile ----
    let updatedProfile = null;
    if (Object.keys(profileData).length > 0) {
      updatedProfile = await upsertProfile(userId, currentUser.role, profileData);
    }

    // ---- 8. Admin password update ----
    if (currentUser.role === "admin" && req.body.newPassword) {
      const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
      await User.findByIdAndUpdate(userId, { password: hashedPassword });
    }

    // ---- 9. Fetch updated user ----
    const updatedUser = await User.findById(userId).select("-password");

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

    res.json({ message: "Profile picture updated", profileImage: storedValue });
  } catch (error) {
    console.error("Update avatar error:", error);
    res.status(500).json({ message: error.message });
  }
};