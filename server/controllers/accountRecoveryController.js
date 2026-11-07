const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");
const User = require("../models/User");
const Request = require("../models/AccountRecoveryRequest");
const JobApplication = require("../models/JobApplication");
const { normalizeEmail } = require("../utils/normalizeEmail");
const { parseDate, parseIdText } = require("../utils/idOcrParser");
const { getActiveValues } = require("../services/systemOptionService");
const { logAuditEvent } = require("../services/auditService");
const { notifyManyUsers } = require("../services/notificationService");
const ocrService = require("../services/ocrService");
const storage = require("../services/storageService");
const mail = require("../services/staffRecoveryMailService");
const logger = require("../utils/logger");
const { sendError } = require("../utils/sendError");
const { forceLogout } = require("../services/sessionService");
const { scheduleOcrTask } = require("../services/idOcrService");
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("hex");
const generic = { message: "If this account exists, your request has been received. The PESO office will contact you." };
const openStatuses = ["pending", "under_review"];
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const sendLater = (promise) => promise.catch(() => logger.error("Staff recovery email failed"));

async function transaction(work) {
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => work(session)); }
  finally { await session.endSession(); }
}

async function processOcr(id, revision, file) {
  let ocr;
  try {
    const request = await Request.findOne({ _id: id, revision });
    if (!request) return;
    const output = await ocrService.extractText(file.buffer, file.mimetype);
    ocr = { status: output.unsupported ? "unsupported" : "done", engine: output.engine, confidence: output.confidence, processedAt: new Date(), ...parseIdText(output.text, { name: request.fullName, dateOfBirth: request.dateOfBirth, governmentIdType: request.idTypeDeclared }, await getActiveValues("governmentIdType")) };
  } catch { ocr = { status: "failed", processedAt: new Date(), failureReason: "processing_failed" }; }
  await Request.updateOne({ _id: id, revision }, { $set: { ocr } });
  await logAuditEvent({ action: "user.id.ocr_processed", targetType: "accountRecovery", targetId: String(id), metadata: { status: ocr.status } });
}

exports.submit = async (req, res) => {
  try {
    const body = req.body;
    const identifier = String(body.identifier || "").trim().normalize("NFKC").toLowerCase();
    const contactEmail = normalizeEmail(body.contactEmail);
    const fullName = String(body.fullName || "").trim();
    const dateOfBirth = parseDate(body.dateOfBirth);
    const idFile = req.files?.governmentIdFile?.[0];
    const selfie = req.files?.selfieFile?.[0];
    if (!identifier || identifier.length > 254 || !validator.isEmail(contactEmail) || !fullName || fullName.length > 200 || !dateOfBirth || dateOfBirth > new Date() || !idFile?.storedValue || !selfie?.storedValue) {
      return res.status(400).json({ message: "Provide your identifier, name, date of birth, contact email, ID and selfie." });
    }
    const user = await User.findOne(identifier.includes("@") ? { email: normalizeEmail(identifier) } : { username: identifier }).collation({ locale: "en", strength: 2 });
    // Unknown identifiers pay the same rejection-window lookup cost.
    const recentlyRejected = await Request.exists({ resolvedUser: user?._id || new mongoose.Types.ObjectId(), status: "rejected", resolvedAt: { $gt: new Date(Date.now() - 86400000) } });
    if (user && recentlyRejected) {
      await Promise.allSettled([storage.remove(idFile.storedValue), storage.remove(selfie.storedValue)]);
      // Contact-mail presence must not disclose the cooldown/account match.
      // This disposable link receives the same generic confirmation response.
      sendLater(mail.sendContactVerification({ to: contactEmail, token: randomToken() }));
      await logAuditEvent({ req, action: "auth.recovery_request.cooldown", targetType: "user", targetId: String(user._id), severity: "warning" });
      return res.json(generic);
    }
    const token = randomToken();
    const revision = crypto.randomUUID();
    const filter = { openAccountKey: user ? String(user._id) : crypto.randomUUID() };
    const update = { $set: {
      ...filter, claimedIdentifier: identifier, resolvedUser: user?._id || null,
      fullName, dateOfBirth, phone: String(body.phone || "").slice(0, 40), lastKnownAddress: String(body.lastKnownAddress || "").slice(0, 500),
      governmentIdFile: idFile.storedValue, selfieFile: selfie.storedValue,
      idTypeDeclared: String(body.idTypeDeclared || "").slice(0, 150), idNumberDeclared: String(body.idNumberDeclared || "").slice(0, 80),
      contactEmail, contactVerifiedAt: null, contactVerificationHash: hash(token), contactVerificationExpires: new Date(Date.now() + 86400000),
      revision, status: "pending", reviewedBy: null, adminResponse: null, resolvedAt: null, ocr: { status: "queued" },
      expiresAt: new Date(Date.now() + 14 * 86400000), ipAddress: req.ip, userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
    } };
    let previous;
    try { previous = await Request.findOneAndUpdate(filter, update, { upsert: true, new: false, setDefaultsOnInsert: true }); }
    catch (error) {
      if (error.code !== 11000) throw error;
      // Concurrent first submissions race the unique open-account index. Retry
      // against the winning row without leaking account existence as a 500.
      previous = await Request.findOneAndUpdate(filter, update, { upsert: true, new: false, setDefaultsOnInsert: true });
    }
    const saved = await Request.findOne({ ...filter, revision }).select("_id");
    if (previous) await Promise.allSettled([storage.remove(previous.governmentIdFile), storage.remove(previous.selfieFile)]);
    // All syntactically valid submissions get the same contact-possession flow,
    // including unknown accounts. No email discloses whether an account matched.
    sendLater(mail.sendContactVerification({ to: contactEmail, token }));
    await logAuditEvent({ req, action: "auth.recovery_request.submitted", targetType: "accountRecovery", targetId: String(saved?._id || ""), severity: "warning" });
    if (saved && !req.ocrCancelled) {
      req.ocrScheduled = true;
      scheduleOcrTask(() => processOcr(saved._id, revision, idFile), req.releaseOcrSlot);
    }
    res.json(generic);
  } catch (error) { return sendError(res, error, "Could not submit recovery request"); }
};

exports.verifyContact = async (req, res) => {
  try {
    const request = await Request.findOneAndUpdate({ contactVerificationHash: hash(req.body.token), contactVerificationExpires: { $gt: new Date() }, expiresAt: { $gt: new Date() }, status: { $in: openStatuses } }, { $set: { contactVerifiedAt: new Date() }, $unset: { contactVerificationHash: 1, contactVerificationExpires: 1 } }, { new: true });
    if (request) {
      await logAuditEvent({ req, action: "auth.recovery_request.contact_verified", targetType: "accountRecovery", targetId: String(request._id) });
      const staff = await User.find({ role: { $in: ["admin", "superadmin"] }, isActive: { $ne: false } }).select("_id");
      await notifyManyUsers({ recipientIds: staff.map((user) => user._id), type: "account_recovery", title: "Account recovery needs review", message: "A contact-verified identity recovery request is ready for PESO review.", relatedEntityType: "system", relatedEntityId: request._id, actionUrl: "/admin/account-recovery", preferenceKey: "notifyAccountRecovery", io: req.app.get("io") });
    }
    return res.json({ message: "If the link was valid, your contact email is confirmed. PESO staff will review your request." });
  } catch (error) { return sendError(res, error); }
};

exports.list = async (req, res) => {
  try {
    const status = ["pending", "under_review", "approved", "rejected", "expired"].includes(req.query.status) ? req.query.status : "pending";
    const page = Math.max(1, Math.min(10000, Math.floor(Number(req.query.page)) || 1));
    const requests = await Request.find({ status }).select("fullName claimedIdentifier contactEmail contactVerifiedAt status createdAt expiresAt revision").sort({ createdAt: 1 }).skip((page - 1) * 25).limit(25);
    return res.json({ requests, page });
  } catch (error) { return sendError(res, error); }
};

exports.detail = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });
    const user = request.resolvedUser ? await User.findById(request.resolvedUser).select("name dateOfBirth role createdAt lastLoginAt authProvider validIdFile governmentIdType governmentIdNumber governmentIdOcr isActive") : null;
    const totalApplications = user ? await JobApplication.countDocuments({ applicant: user._id }) : 0;
    await logAuditEvent({ req, actorId: req.user.id, actorRole: req.user.role, action: "admin.recovery_request.viewed", targetType: "accountRecovery", targetId: String(request._id) });
    return res.json({ request, user, totalApplications });
  } catch (error) { return sendError(res, error); }
};

exports.review = async (req, res) => {
  try {
    const { decision, revision, currentPassword, reason, identityMatched } = req.body;
    if (!["approve", "reject", "under_review"].includes(decision) || typeof revision !== "string") return res.status(400).json({ message: "Invalid review decision" });
    const actor = await User.findById(req.user.id);
    if (!actor?.password) return res.status(400).json({ message: "Set a password first (Settings → Security → Add a password) before reviewing recovery requests." });
    if (!await bcrypt.compare(String(currentPassword || ""), actor.password)) return res.status(403).json({ message: "Current password is incorrect" });
    if (decision !== "under_review" && (typeof reason !== "string" || reason.trim().length < 10 || reason.length > 2000)) return res.status(400).json({ message: "Record a review reason (10–2000 characters)" });
    const rawToken = randomToken();
    const outcome = await transaction(async (session) => {
      const request = await Request.findOne({ _id: req.params.id, revision, status: { $in: openStatuses }, expiresAt: { $gt: new Date() } }).session(session);
      if (!request) fail(409, "This request changed or expired. Reload before reviewing.");
      let user = null;
      if (decision === "approve") {
        if (!request.contactVerifiedAt || identityMatched !== true) fail(400, "Confirm contact possession and match both identity documents before approval");
        user = request.resolvedUser ? await User.findById(request.resolvedUser).session(session) : null;
        if (!user || user.role !== "jobseeker" || user.isActive === false) fail(403, "Only active jobseeker accounts can recover online. Employer and staff accounts require in-person verification.");
        if (!user.validIdFile || !request.governmentIdFile || !request.selfieFile) fail(400, "An ID already on file, submitted ID and selfie are required for online recovery. Direct this person to the PESO counter.");
        if (await User.exists({ email: request.contactEmail, _id: { $ne: user._id } }).session(session)) fail(409, "This contact address cannot be used. Request another address.");
        await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 }, $set: {
          googleId: null, authProvider: "local", googleSignInDisabled: true, staffRecoveryPending: true,
          pendingEmail: request.contactEmail, emailChangeToken: null, emailChangeExpires: null,
          passwordResetToken: null, passwordResetExpires: null, backupCodes: [], backupCodesGeneratedAt: null,
          recoveryEmail: null, recoveryEmailVerifiedAt: null, recoveryEmailToken: null, recoveryEmailExpires: null,
          staffRecoveryToken: hash(rawToken), staffRecoveryExpires: new Date(Date.now() + 30 * 60000), staffRecoveryRequest: request._id, staffRecoveryVersion: (user.tokenVersion || 0) + 1,
        } }, { session });
      }
      request.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "under_review";
      request.reviewedBy = actor._id;
      request.adminResponse = String(reason || "").trim();
      if (decision !== "under_review") { request.resolvedAt = new Date(); request.openAccountKey = undefined; }
      request.revision = crypto.randomUUID();
      if (decision === "under_review") request.expiresAt = new Date(Date.now() + 14 * 86400000);
      // validateModifiedOnly: only the status-tracking fields above change
      // here — the proof/identity fields (fullName, governmentIdFile, ...)
      // set at submission aren't touched, so there's no reason a review
      // decision should ever be blocked by validation of something it isn't
      // changing. Same reasoning as authController.js's user.save() calls —
      // see the comment there for the incident this pattern guards against.
      await request.save({ session, validateModifiedOnly: true });
      return { request, user };
    });
    const { request, user } = outcome;
    if (decision === "approve") {
      sendLater(mail.sendRecoveryApproved({ to: request.contactEmail, token: rawToken }));
      for (const to of new Set([user.email, user.recoveryEmail].filter(Boolean))) sendLater(mail.sendRecoveryAlert({ to }));
      forceLogout(req.app.get("io"), user._id, { code: "SESSION_EXPIRED", message: "Your account is being recovered by PESO staff." });
    } else if (decision === "reject" && request.contactVerifiedAt) sendLater(mail.sendRecoveryRejected({ to: request.contactEmail, reason: request.adminResponse }));
    await logAuditEvent({ req, actorId: actor._id, actorRole: actor.role, action: decision === "approve" ? "auth.account.recovered" : `admin.recovery_request.${decision}`, targetType: "user", targetId: String(request.resolvedUser || ""), severity: decision === "approve" ? "critical" : "warning", metadata: { requestId: String(request._id), googleUnlinked: Boolean(user?.googleId) } });
    return res.json({ message: "Review recorded", status: request.status });
  } catch (error) { return sendError(res, error, error.status ? error.message : "Could not record recovery decision", error.status || 500); }
};

exports.finish = async (req, res) => {
  try {
    if (typeof req.body.newPassword !== "string" || req.body.newPassword.length < 8 || req.body.newPassword.length > 128 || typeof req.body.token !== "string" || !/^[a-f0-9]{64}$/.test(req.body.token)) return res.status(400).json({ message: "Use a valid recovery link and a password of 8–128 characters" });
    // Pay the same password-hashing cost on valid and unknown tokens.
    const password = await bcrypt.hash(req.body.newPassword, 10);
    const tokenHash = hash(req.body.token);
    const result = await transaction(async (session) => {
      const user = await User.findOne({ staffRecoveryToken: tokenHash, staffRecoveryExpires: { $gt: new Date() }, role: "jobseeker", isActive: { $ne: false } }).select("+staffRecoveryToken +staffRecoveryExpires +staffRecoveryVersion +staffRecoveryRequest").session(session);
      if (!user || user.tokenVersion !== user.staffRecoveryVersion || !user.pendingEmail) fail(400, "This recovery link is invalid or expired");
      const request = await Request.findOne({ _id: user.staffRecoveryRequest, resolvedUser: user._id, status: "approved", contactEmail: user.pendingEmail, redeemedAt: null }).session(session);
      if (!request) fail(400, "This recovery link is invalid or expired");
      const updated = await User.updateOne({ _id: user._id, staffRecoveryToken: tokenHash, tokenVersion: user.staffRecoveryVersion }, { $inc: { tokenVersion: 1 }, $set: { password, email: user.pendingEmail, isEmailVerified: true, pendingEmail: null, staffRecoveryPending: false, staffRecoveryToken: null, staffRecoveryExpires: null, staffRecoveryRequest: null, staffRecoveryVersion: null, passwordResetToken: null, passwordResetExpires: null, emailVerificationToken: null, emailVerificationExpires: null } }, { session });
      if (updated.modifiedCount !== 1) fail(400, "This recovery link is invalid or expired");
      request.redeemedAt = new Date(); await request.save({ session, validateModifiedOnly: true });
      return { userId: user._id, email: user.pendingEmail };
    });
    await logAuditEvent({ req, actorId: result.userId, actorRole: "jobseeker", action: "auth.staff_recovery.completed", targetType: "user", targetId: String(result.userId), severity: "critical" });
    sendLater(mail.sendRecoveryAlert({ to: result.email }));
    return res.json({ message: "Your password and sign-in email are updated. Sign in with your new details." });
  } catch (error) { return sendError(res, error, error.status ? error.message : "Could not finish recovery", error.status || 500); }
};

exports.report = async (req, res) => {
  try {
    const page = Math.max(1, Math.min(10000, Math.floor(Number(req.query.page)) || 1));
    const rows = await Request.find({ resolvedAt: { $gte: new Date(Date.now() - 90 * 86400000) } }).select("resolvedUser reviewedBy status resolvedAt redeemedAt adminResponse").sort({ resolvedAt: -1, _id: -1 }).skip((page - 1) * 100).limit(101);
    return res.json({ requests: rows.slice(0, 100), page, hasMore: rows.length > 100 });
  } catch (error) { return sendError(res, error); }
};
