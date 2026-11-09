// "Share my contact details" (COVER_PHOTO_PLAN.md sections 3.6 and 4.2): a jobseeker's
// explicit, revocable decision to share phone and/or email with ONE employer in ONE
// conversation. A reply is never consent; only this does it. The share stores which
// fields, never copies of the values, and the audit events carry field names only.

const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const ContactShare = require("../models/ContactShare");
const User = require("../models/User");
const { getAgeTier, TIERS } = require("../utils/age");
const { isValidPhone } = require("../utils/phone");
const { normalizeRole } = require("../services/profileProjection");
const { logAuditEvent } = require("../services/auditService");
const { createNotificationForUser } = require("../services/notificationService");
const { sendError } = require("../utils/sendError");
const logger = require("../utils/logger");

const FIELDS = ["phone", "email"];
const fail = (res, status, code, message) => res.status(status).json({ code, message });
const NOT_ALLOWED = "Sharing contact details is not available here.";

const hasEmail = (user) => typeof user.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email);
const hasPhone = (user) => Boolean(user.phone) && isValidPhone(user.phone);

// Loads the jobseeker, the conversation and its employer; answers the error itself
// and returns null when sharing is not allowed.
const loadContext = async (req, res) => {
  const { conversationId } = req.params;
  if (!mongoose.isValidObjectId(conversationId)) {
    fail(res, 404, "NOT_FOUND", "Conversation not found.");
    return null;
  }
  const myId = String(req.user._id || req.user.id);
  const [me, conversation] = await Promise.all([
    User.findById(myId).select("role dateOfBirth phone email name isActive"),
    Conversation.findById(conversationId).select("participants"),
  ]);
  const participantIds = (conversation?.participants || []).map((p) => String(p && p._id ? p._id : p));
  if (!me || !conversation || !participantIds.includes(myId)) {
    fail(res, 404, "NOT_FOUND", "Conversation not found.");
    return null;
  }
  // Only an adult jobseeker; never a 15 to 17 year old.
  const tier = getAgeTier(me.dateOfBirth);
  if (normalizeRole(me.role) !== "jobseeker" || (tier !== TIERS.ADULT && tier !== TIERS.SENIOR)) {
    fail(res, 403, "CONTACT_SHARE_NOT_ALLOWED", NOT_ALLOWED);
    return null;
  }
  const otherId = participantIds.find((id) => id !== myId);
  const employer = otherId ? await User.findById(otherId).select("role name companyName isActive") : null;
  if (!employer || normalizeRole(employer.role) !== "employer" || employer.isActive === false || participantIds.length !== 2) {
    fail(res, 403, "CONTACT_SHARE_NOT_ALLOWED", NOT_ALLOWED);
    return null;
  }
  return { me, myId, conversation, employer, employerId: otherId };
};

const stateOf = (share) => ({
  active: Boolean(share && !share.revokedAt),
  fields: { phone: Boolean(share?.fields?.phone), email: Boolean(share?.fields?.email) },
  sharedAt: share && !share.revokedAt ? share.sharedAt : null,
});

const employerName = (employer) => employer.companyName || employer.name || "";

const notify = async (req, employerId, title, message) => {
  try {
    await createNotificationForUser({
      recipientId: employerId,
      actorId: req.user._id || req.user.id,
      type: "message",
      title,
      message,
      relatedEntityType: "conversation",
      relatedEntityId: req.params.conversationId,
      io: req.app && req.app.get ? req.app.get("io") : null,
    });
  } catch (error) {
    logger.warn("Contact share notification failed", { error: error.message });
  }
};

// GET: what would be shared (the real values go to their owner only) and the current state.
exports.getShareState = async (req, res) => {
  try {
    const ctx = await loadContext(req, res);
    if (!ctx) return undefined;
    const share = await ContactShare.findOne({ conversation: ctx.conversation._id }).lean();
    return res.json({
      available: true,
      employerName: employerName(ctx.employer),
      values: { phone: hasPhone(ctx.me) ? ctx.me.phone : null, email: hasEmail(ctx.me) ? ctx.me.email : null },
      share: stateOf(share),
    });
  } catch (error) {
    return sendError(res, error, "Failed to load the contact sharing state");
  }
};

// POST body { fields: ["phone"] | ["email"] | ["phone","email"] }
exports.createShare = async (req, res) => {
  try {
    const ctx = await loadContext(req, res);
    if (!ctx) return undefined;

    const requested = req.body?.fields;
    if (!Array.isArray(requested) || requested.length === 0 || requested.some((f) => !FIELDS.includes(f))) {
      return fail(res, 400, "CONTACT_SHARE_FIELDS_INVALID", "Choose phone, email or both.");
    }
    const fields = { phone: requested.includes("phone"), email: requested.includes("email") };
    if ((fields.phone && !hasPhone(ctx.me)) || (fields.email && !hasEmail(ctx.me))) {
      return fail(res, 409, "CONTACT_SHARE_NO_CONTACT", "Add a valid phone number or email to your profile first.");
    }

    const share = await ContactShare.findOneAndUpdate(
      { conversation: ctx.conversation._id },
      {
        $set: { jobseeker: ctx.myId, employer: ctx.employerId, fields, sharedAt: new Date(), revokedAt: null },
        $setOnInsert: { conversation: ctx.conversation._id },
      },
      { new: true, upsert: true }
    ).lean();

    await logAuditEvent({
      req,
      actorId: ctx.myId,
      actorRole: req.user.role,
      action: "message.contact_shared",
      targetType: "conversation",
      targetId: String(ctx.conversation._id),
      severity: "info",
      // Field names only, never the values.
      metadata: { fields: requested, employerId: ctx.employerId },
    });
    await notify(req, ctx.employerId, "Contact details shared", `${ctx.me.name || "A jobseeker"} shared contact details with you.`);
    return res.json({ share: stateOf(share) });
  } catch (error) {
    return sendError(res, error, "Failed to share contact details");
  }
};

// DELETE: revoke. Idempotent.
exports.revokeShare = async (req, res) => {
  try {
    const ctx = await loadContext(req, res);
    if (!ctx) return undefined;
    const existing = await ContactShare.findOne({ conversation: ctx.conversation._id });
    if (!existing || existing.revokedAt) {
      return res.json({ share: stateOf(existing) });
    }
    const share = await ContactShare.findOneAndUpdate({ _id: existing._id }, { $set: { revokedAt: new Date() } }, { new: true }).lean();
    await logAuditEvent({
      req,
      actorId: ctx.myId,
      actorRole: req.user.role,
      action: "message.contact_revoked",
      targetType: "conversation",
      targetId: String(ctx.conversation._id),
      severity: "info",
      metadata: { fields: FIELDS.filter((f) => existing.fields?.[f]), employerId: ctx.employerId },
    });
    await notify(req, ctx.employerId, "Contact sharing stopped", `${ctx.me.name || "A jobseeker"} stopped sharing contact details with you.`);
    return res.json({ share: stateOf(share) });
  } catch (error) {
    return sendError(res, error, "Failed to stop sharing contact details");
  }
};
