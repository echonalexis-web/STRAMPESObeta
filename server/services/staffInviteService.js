/**
 * staffInviteService — one-time activation invites for superadmin-provisioned
 * staff accounts.
 *
 * The account is created in "pending_activation" with a random password hash
 * nobody ever sees. The owner receives a link that carries a random token; only
 * the SHA-256 hash of that token is stored. Opening the link lets them choose
 * their own password. No password is ever generated for display, emailed or
 * logged, and the token and the full link are never logged, audited or kept in
 * a response (the email outbox keeps the link only until the email is sent or
 * given up on — see emailOutboxService `sensitive` rows).
 */
const crypto = require("crypto");
const User = require("../models/User");
const EmailOutbox = require("../models/EmailOutbox");
const SystemSettings = require("../models/SystemSettings");
const { enqueueEmail } = require("./emailOutboxService");
const { clientBaseUrl } = require("../utils/clientUrl");

const DEFAULT_EXPIRY_HOURS = 48;
const DEFAULT_COOLDOWN_SECONDS = 60;
const EXPIRY_HOURS_RANGE = [1, 168];
const COOLDOWN_SECONDS_RANGE = [30, 3600];
// Sends allowed after the first one, per account, for the life of one invite.
const MAX_RESENDS = 10;
const OUTBOX_CATEGORY = "staffInvite";
const ACTIVATION_PATH = "/activate-account";

const clamp = (value, [min, max], fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

// Settings are read on every use; a read failure falls back to the defaults.
const getInviteSettings = async () => {
  let doc = null;
  try {
    doc = await SystemSettings.getSingleton();
  } catch {
    /* defaults below */
  }
  return {
    expiryHours: clamp(doc && doc.staffInviteExpiryHours, EXPIRY_HOURS_RANGE, DEFAULT_EXPIRY_HOURS),
    cooldownSeconds: clamp(doc && doc.staffInviteResendCooldownSeconds, COOLDOWN_SECONDS_RANGE, DEFAULT_COOLDOWN_SECONDS),
  };
};

const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");
// 32 random bytes, hex encoded.
const newToken = () => crypto.randomBytes(32).toString("hex");
// A random password hash nobody knows: the account cannot sign in until the owner activates it.
const unusablePasswordValue = () => crypto.randomBytes(48).toString("hex");

// Constant-time comparison of two hex digests of the same length.
const sameHash = (a, b) => {
  const x = Buffer.from(String(a || ""), "hex");
  const y = Buffer.from(String(b || ""), "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

const activationUrl = (rawToken) => `${clientBaseUrl()}${ACTIVATION_PATH}#token=${rawToken}`;

const manilaTime = (date) =>
  new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" }).format(date);

// One message in English and Filipino. Paragraph text is escaped by the outbox
// renderer; the footnote and button label are fixed strings.
const buildInviteEmail = ({ name, email, inviterName, expiresAt, rawToken }) => {
  const when = manilaTime(expiresAt);
  return {
    subject: "Your STRAM PESO staff account / Ang iyong STRAM PESO staff account",
    heading: "Activate your staff account / I-activate ang iyong staff account",
    paragraphs: [
      `Hello ${name},`,
      `${inviterName} created a STRAM PESO staff account for you. Your login ID is: ${email}`,
      `Use the button below to choose your own password. The link works once and expires on ${when} (Asia/Manila time).`,
      `Kumusta, ${name}.`,
      `Gumawa si ${inviterName} ng STRAM PESO staff account para sa iyo. Ang iyong login ID ay: ${email}`,
      `Gamitin ang button sa ibaba para pumili ng sarili mong password. Isang beses lang gagana ang link at mag-e-expire ito sa ${when} (oras sa Maynila).`,
    ],
    button: { url: activationUrl(rawToken), label: "Activate account / I-activate ang account" },
    footnote:
      "PESO will never ask for your password. If you did not expect this email, ignore it and tell your superadmin. / " +
      "Hindi kailanman hihingin ng PESO ang iyong password. Kung hindi mo inaasahan ang email na ito, huwag itong pansinin at sabihin sa iyong superadmin.",
  };
};

// Queues the invite email. Returns { queued, outboxId }. Never throws: a failure to
// queue is reported to the caller, which records it and tells the superadmin.
const queueInviteEmail = async ({ user, rawToken, expiresAt, inviterName, actorId }) => {
  try {
    const mail = buildInviteEmail({
      name: user.name,
      email: user.email,
      inviterName: inviterName || "A superadmin",
      expiresAt,
      rawToken,
    });
    const row = await enqueueEmail({
      recipientId: user._id,
      toEmail: user.email,
      category: OUTBOX_CATEGORY,
      subject: mail.subject,
      heading: mail.heading,
      paragraphs: mail.paragraphs,
      button: mail.button,
      footnote: mail.footnote,
      sensitive: true,
      auditActor: actorId,
    });
    if (!row) return { queued: false, outboxId: null };
    return { queued: true, outboxId: row._id };
  } catch {
    return { queued: false, outboxId: null };
  }
};

// A resend or cancel makes any invite email still waiting in the outbox stale:
// drop it (and its link) so the old link can never be sent after the new one.
const suppressQueuedInvites = (userId) =>
  EmailOutbox.updateMany(
    { recipient: userId, category: OUTBOX_CATEGORY, status: "queued" },
    { $set: { status: "suppressed", resolvedAt: new Date(), buttonUrl: "" } }
  );

// "sent" | "queued" | "failed" for the invite email of each account. One query for
// a whole list. A queue failure, or a missing outbox row, reads as "failed".
const emailStatusFor = async (users) => {
  const ids = users.map((u) => u.staffInvite && u.staffInvite.outboxId).filter(Boolean);
  const rows = ids.length ? await EmailOutbox.find({ _id: { $in: ids } }).select("status").lean() : [];
  const byId = new Map(rows.map((r) => [String(r._id), r.status]));
  const map = new Map();
  for (const u of users) {
    const invite = u.staffInvite || {};
    let status = "failed";
    if (!invite.queueFailed && invite.outboxId) {
      const raw = byId.get(String(invite.outboxId));
      if (raw === "sent") status = "sent";
      else if (raw === "queued" || raw === "sending") status = "queued";
      else status = "failed";
    }
    map.set(String(u._id), status);
  }
  return map;
};

// What the console shows for one staff account's invite. Never the token or hash.
const inviteView = (user, { emailStatus, cooldownSeconds, now = Date.now() } = {}) => {
  const invite = user.staffInvite;
  if (!invite || (!invite.status && !invite.sentAt)) return null;
  const pending = user.accountStatus === "pending_activation" && invite.status === "pending";
  const expiresAt = invite.expiresAt || null;
  const expired = pending && expiresAt ? new Date(expiresAt).getTime() <= now : false;
  const lastSent = invite.lastSentAt ? new Date(invite.lastSentAt).getTime() : null;
  const nextResendAt =
    pending && lastSent && cooldownSeconds ? new Date(lastSent + cooldownSeconds * 1000).toISOString() : null;
  return {
    status: invite.status === "activated" ? "activated" : expired ? "expired" : "pending",
    sentAt: invite.sentAt || null,
    expiresAt,
    resendCount: invite.resendCount || 0,
    resendsLeft: Math.max(0, MAX_RESENDS - (invite.resendCount || 0)),
    activatedAt: invite.activatedAt || null,
    emailStatus: emailStatus || null,
    nextResendAt,
  };
};

module.exports = {
  DEFAULT_EXPIRY_HOURS,
  DEFAULT_COOLDOWN_SECONDS,
  EXPIRY_HOURS_RANGE,
  COOLDOWN_SECONDS_RANGE,
  MAX_RESENDS,
  OUTBOX_CATEGORY,
  getInviteSettings,
  hashToken,
  newToken,
  unusablePasswordValue,
  sameHash,
  activationUrl,
  buildInviteEmail,
  queueInviteEmail,
  suppressQueuedInvites,
  emailStatusFor,
  inviteView,
};
