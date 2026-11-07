const Notification = require("../models/Notification");
const User = require("../models/User");
const { enqueueEmail } = require("./emailOutboxService");
const { clientBaseUrl } = require("../utils/clientUrl");
const { buildUnsubscribeUrl } = require("../utils/emailUnsubscribe");
const logger = require("../utils/logger");

const toSafeString = (value, fallback = "") => {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
};

// How long to hold a "new message" digest email before sending it, so a
// reply sent soon after the first message folds into the same email instead
// of triggering a second one.
const EMAIL_MESSAGE_DIGEST_MINUTES = Number(process.env.EMAIL_MESSAGE_DIGEST_MINUTES) || 10;

const MESSAGE_TOGGLE_ROLES = new Set(["jobseeker", "employee", "resident"]);

// Every notification gets an email counterpart. Most call sites pass an
// explicit `preferenceKey` naming the exact Settings toggle it's governed by
// (e.g. "notifyJobMatch"). For the handful of Notification `type`s that have
// no caller-supplied preferenceKey — system, admin_action, follow, news,
// like, per the enum in models/Notification.js — this map supplies one, so
// every type still resolves to a real, opt-out-able category instead of
// silently going un-emailed. Each key here has a matching boolean in
// User.emailNotificationPreferences (default true) and a matching label in
// controllers/notificationController.js's EMAIL_PREFERENCE_CATEGORY_LABELS,
// both of which must stay in sync with this map — see that file's unsubscribe
// link, which 400s for any category missing from its label map.
const TYPE_TO_EMAIL_CATEGORY = {
  system: "notifySystem",
  admin_action: "notifyAdminAction",
  follow: "notifyFollow",
  news: "notifyNews",
  like: "notifyLikes",
};

// Every category a notification email can legitimately be filed under —
// the explicit preferenceKeys callers pass directly, plus TYPE_TO_EMAIL_CATEGORY's
// values. queueNotificationEmail checks a resolved category against this set
// before using it: an unrecognized preferenceKey (a typo, or a future
// in-app-only toggle with no email counterpart) must not reach enqueueEmail,
// because its unsubscribe link would be signed for a category with no entry
// in notificationController.js's EMAIL_PREFERENCE_CATEGORY_LABELS and would
// 400 when clicked. Keep in sync with that label map.
const KNOWN_EMAIL_CATEGORIES = new Set([
  "notifyMessages",
  "notifyJobMatch",
  "notifyApplicationUpdate",
  "notifyNewApplicant",
  "notifyJobExpiring",
  "notifyVerificationRequest",
  "notifyUserReport",
  "notifySpesSubmission",
  "notifyAccountRecovery",
  ...Object.values(TYPE_TO_EMAIL_CATEGORY),
]);

// True when this recipient has explicitly opted out of `preferenceKey`.
// Missing/undefined (legacy documents, or a role with no matching Settings
// toggle) is treated as opted in — only a literal `false` suppresses the
// notification. Never throws: a lookup failure must not block a real event
// from notifying its recipient.
const isOptedOut = async (recipientId, preferenceKey) => {
  if (!preferenceKey || !recipientId) return false;
  try {
    const recipient = await User.findById(recipientId).select(
      `notificationPreferences.${preferenceKey}`
    );
    return recipient?.notificationPreferences?.[preferenceKey] === false;
  } catch {
    return false;
  }
};

// Mirrors a just-created Notification into the EmailOutbox queue, gated
// behind its own preference (independent of the in-app one checked by
// isOptedOut above — a recipient may want one channel but not the other).
// Called fire-and-forget by every notify* helper below: a failure here must
// never fail or delay the request that triggered the notification itself.
//
// Every notification gets an email: `preferenceKey`, when the caller passes
// one, names the exact category; otherwise TYPE_TO_EMAIL_CATEGORY supplies
// one from the notification's own `type`. Either way the resolved category
// must be in KNOWN_EMAIL_CATEGORIES or this intentionally does NOT send —
// see that set's comment for why a category must never be guessed.
const queueNotificationEmail = async ({ recipientId, notification, preferenceKey = null, dedupeKey = null, scheduledAt = null }) => {
  if (!recipientId || !notification) return;
  const category = preferenceKey || TYPE_TO_EMAIL_CATEGORY[notification.type];
  if (!category || !KNOWN_EMAIL_CATEGORIES.has(category)) return;

  let recipient;
  try {
    recipient = await User.findById(recipientId).select("email isEmailVerified emailNotificationPreferences");
  } catch (err) {
    logger.error("notificationService: email recipient lookup failed", {
      recipientId: String(recipientId),
      error: err.message,
    });
    return;
  }
  if (!recipient?.email || recipient.isEmailVerified === false) return;

  const emailPrefs = recipient.emailNotificationPreferences || {};
  if (emailPrefs.emailAll === false) return;
  if (emailPrefs[category] === false) return;

  const actionUrl = notification.actionUrl ? `${clientBaseUrl()}${notification.actionUrl}` : null;
  const unsubscribeUrl = buildUnsubscribeUrl({
    baseUrl: clientBaseUrl(),
    userId: recipientId,
    category,
  });

  try {
    await enqueueEmail({
      recipientId,
      toEmail: recipient.email,
      notificationId: notification._id,
      category,
      // Kept RAW here (not HTML-escaped) — these also back the plain-text
      // version of the email. emailOutboxService escapes them only at the
      // point it builds the HTML body, since `message`/`title` can carry
      // another user's free text (a chat preview, a job title, …).
      subject: notification.title,
      heading: notification.title,
      paragraphs: [notification.message],
      button: actionUrl ? { url: actionUrl, label: "View in STRAM PESO" } : null,
      footnote: `You're receiving this because of your STRAM PESO notification settings. To stop, open this link: ${unsubscribeUrl}`,
      scheduledAt: scheduledAt || new Date(),
      dedupeKey,
    });
  } catch (err) {
    logger.error("notificationService: failed to queue notification email", {
      recipientId: String(recipientId),
      error: err.message,
    });
  }
};

const buildRealtimePayload = (notificationDoc) => ({
  _id: notificationDoc._id,
  recipient: notificationDoc.recipient,
  actor: notificationDoc.actor,
  type: notificationDoc.type,
  title: notificationDoc.title,
  message: notificationDoc.message,
  relatedEntityType: notificationDoc.relatedEntityType,
  relatedEntityId: notificationDoc.relatedEntityId,
  actionUrl: notificationDoc.actionUrl,
  metadata: notificationDoc.metadata,
  isRead: notificationDoc.isRead,
  readAt: notificationDoc.readAt,
  createdAt: notificationDoc.createdAt,
  updatedAt: notificationDoc.updatedAt,
});

const createNotificationForUser = async ({
  recipientId,
  actorId = null,
  type = "system",
  title,
  message,
  relatedEntityType = "system",
  relatedEntityId = null,
  actionUrl = "",
  metadata = {},
  io = null,
  // Optional key into User.notificationPreferences (e.g. "notifyUserReport").
  // When given, the recipient's saved preference is consulted first; a
  // literal `false` skips creating the notification entirely. Omit for
  // notification types that have no matching Settings toggle.
  preferenceKey = null,
}) => {
  if (!recipientId) {
    return null;
  }

  if (await isOptedOut(recipientId, preferenceKey)) {
    return null;
  }

  const notification = await Notification.create({
    recipient: recipientId,
    actor: actorId || null,
    type,
    title: toSafeString(title, "Notification"),
    message: toSafeString(message, "You have a new notification."),
    relatedEntityType,
    relatedEntityId,
    actionUrl: toSafeString(actionUrl, ""),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  });

  if (io) {
    io.to(`user:${String(recipientId)}`).emit("notification:new", buildRealtimePayload(notification));
  }

  // Fire-and-forget — see queueNotificationEmail's own comment for why a
  // mail failure must never affect the caller of this function.
  queueNotificationEmail({ recipientId, notification, preferenceKey });

  return notification;
};

// Create the same notification for many recipients at once (e.g. a published
// announcement). Uses insertMany for one round-trip, then emits individually
// so each recipient's socket room gets their own copy.
const notifyManyUsers = async ({
  recipientIds = [],
  actorId = null,
  type = "system",
  title,
  message,
  relatedEntityType = "system",
  relatedEntityId = null,
  actionUrl = "",
  metadata = {},
  io = null,
  // See createNotificationForUser — same opt-out semantics, applied per
  // recipient before the fan-out.
  preferenceKey = null,
}) => {
  let uniqueRecipientIds = [...new Set(recipientIds.map(String))].filter(Boolean);
  if (uniqueRecipientIds.length === 0) {
    return [];
  }

  if (preferenceKey) {
    const optedIn = await User.find({
      _id: { $in: uniqueRecipientIds },
      [`notificationPreferences.${preferenceKey}`]: { $ne: false },
    }).select("_id");
    const optedInIds = new Set(optedIn.map((u) => String(u._id)));
    uniqueRecipientIds = uniqueRecipientIds.filter((id) => optedInIds.has(id));
    if (uniqueRecipientIds.length === 0) return [];
  }

  const docs = uniqueRecipientIds.map((recipientId) => ({
    recipient: recipientId,
    actor: actorId || null,
    type,
    title: toSafeString(title, "Notification"),
    message: toSafeString(message, "You have a new notification."),
    relatedEntityType,
    relatedEntityId,
    actionUrl: toSafeString(actionUrl, ""),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  }));

  const created = await Notification.insertMany(docs);

  if (io) {
    created.forEach((notification) => {
      io.to(`user:${String(notification.recipient)}`).emit(
        "notification:new",
        buildRealtimePayload(notification)
      );
    });
  }

  // Fire-and-forget, one per recipient — queueNotificationEmail itself
  // re-checks each recipient's OWN email preference (the in-app opt-out
  // above was already applied to `created`, but email can be off while
  // in-app stays on). There is no separate "is this list too big to email"
  // guard here: the EmailOutbox daily send cap (emailOutboxService) already
  // bounds how many go out per day across the whole system regardless of
  // how many get queued at once, so a large fan-out just trickles out over
  // more days rather than needing its own limit at this call site.
  created.forEach((notification) => {
    queueNotificationEmail({ recipientId: notification.recipient, notification, preferenceKey });
  });

  return created;
};

// Collapses repeated messages in the same conversation into a single unread
// notification (updating its preview and count) instead of stacking one row
// per message, so a burst of messages doesn't flood the notification list.
const notifyNewMessage = async ({
  recipientId,
  actorId = null,
  actorName = "Someone",
  conversationId,
  messagePreview,
  io = null,
}) => {
  if (!recipientId || !conversationId) {
    return null;
  }

  // Only jobseekers have a "new messages" toggle in Settings; employers,
  // admins and superadmins have no matching control, so they're never
  // gated in-app — and, for the same reason (no way for them to turn it
  // off), never emailed about new messages either in this phase.
  let recipientRole = null;
  try {
    const recipient = await User.findById(recipientId).select("role notificationPreferences.notifyMessages");
    recipientRole = recipient?.role || null;
    if (
      recipient &&
      MESSAGE_TOGGLE_ROLES.has(recipient.role) &&
      recipient.notificationPreferences?.notifyMessages === false
    ) {
      return null;
    }
  } catch {
    /* a lookup failure must not block the notification */
  }

  const preview = toSafeString(messagePreview, "").slice(0, 120);

  const existing = await Notification.findOne({
    recipient: recipientId,
    type: "message",
    relatedEntityType: "conversation",
    relatedEntityId: conversationId,
    isRead: false,
  });

  let notification;
  if (existing) {
    const nextCount = Number(existing.metadata?.messageCount || 1) + 1;
    existing.actor = actorId || existing.actor;
    existing.title = `${nextCount} new messages from ${actorName}`;
    existing.message = preview;
    existing.metadata = { ...(existing.metadata || {}), messageCount: nextCount };
    existing.createdAt = new Date();
    // validateModifiedOnly: this only touches the fields above, never the
    // enum-constrained type/relatedEntityType set at creation — a full
    // .save() would otherwise re-validate those too. Precautionary, same
    // pattern as authController.js's user.save() calls (see the comment
    // there for the real incident this guards against).
    await existing.save({ validateModifiedOnly: true });

    if (io) {
      io.to(`user:${String(recipientId)}`).emit("notification:updated", buildRealtimePayload(existing));
    }

    notification = existing;
  } else {
    const created = await Notification.create({
      recipient: recipientId,
      actor: actorId || null,
      type: "message",
      title: `New message from ${actorName}`,
      message: preview,
      relatedEntityType: "conversation",
      relatedEntityId: conversationId,
      actionUrl: "/messages",
      metadata: { messageCount: 1 },
    });

    if (io) {
      io.to(`user:${String(recipientId)}`).emit("notification:new", buildRealtimePayload(created));
    }

    notification = created;
  }

  // One digest email per conversation per hour, not one per message: every
  // message in the same conversation within the same hour shares a
  // dedupeKey, so enqueueEmail (emailOutboxService) folds them into a single
  // still-queued row — refreshing its subject/preview to the latest message
  // each time — instead of creating a new email row per message. Delayed by
  // EMAIL_MESSAGE_DIGEST_MINUTES so a reply sent within that window never
  // generates a separate email at all; and if the recipient reads the
  // conversation before the delay elapses, the send step itself (not here)
  // skips it entirely — see emailOutboxService.sendOne's isRead check.
  if (MESSAGE_TOGGLE_ROLES.has(recipientRole)) {
    const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    queueNotificationEmail({
      recipientId,
      notification,
      preferenceKey: "notifyMessages",
      dedupeKey: `msg:${conversationId}:${recipientId}:${hourBucket}`,
      scheduledAt: new Date(Date.now() + EMAIL_MESSAGE_DIGEST_MINUTES * 60 * 1000),
    });
  }

  return notification;
};

// How long to hold a "N people liked your post" digest email before sending
// it — same purpose as EMAIL_MESSAGE_DIGEST_MINUTES above: a burst of likes
// on one item within this window collapses into one still-queued email
// (refreshing its count/subject each time) instead of one email per like.
const EMAIL_LIKE_DIGEST_MINUTES = Number(process.env.EMAIL_LIKE_DIGEST_MINUTES) || 15;

// Collapses repeated likes on the same item into a single unread
// notification ("5 people liked your post") instead of one row per like,
// same anti-clutter approach as notifyNewMessage.
const notifyLike = async ({
  recipientId,
  actorId = null,
  actorName = "Someone",
  relatedEntityType,
  relatedEntityId,
  itemLabel = "your post",
  actionUrl = "",
  io = null,
}) => {
  if (!recipientId || !relatedEntityId || String(recipientId) === String(actorId)) {
    return null;
  }

  const existing = await Notification.findOne({
    recipient: recipientId,
    type: "like",
    relatedEntityType,
    relatedEntityId,
    isRead: false,
  });

  let notification;
  if (existing) {
    const nextCount = Number(existing.metadata?.likeCount || 1) + 1;
    existing.actor = actorId || existing.actor;
    existing.title = `${nextCount} people liked ${itemLabel}`;
    existing.message = `${actorName} and ${nextCount - 1} other${nextCount - 1 === 1 ? "" : "s"} liked ${itemLabel}.`;
    existing.metadata = { ...(existing.metadata || {}), likeCount: nextCount };
    existing.createdAt = new Date();
    // validateModifiedOnly — see the matching comment in notifyNewMessage above.
    await existing.save({ validateModifiedOnly: true });

    if (io) {
      io.to(`user:${String(recipientId)}`).emit("notification:updated", buildRealtimePayload(existing));
    }

    notification = existing;
  } else {
    const created = await Notification.create({
      recipient: recipientId,
      actor: actorId || null,
      type: "like",
      title: `New like on ${itemLabel}`,
      message: `${actorName} liked ${itemLabel}.`,
      relatedEntityType,
      relatedEntityId,
      actionUrl,
      metadata: { likeCount: 1 },
    });

    if (io) {
      io.to(`user:${String(recipientId)}`).emit("notification:new", buildRealtimePayload(created));
    }

    notification = created;
  }

  // One digest email per item per EMAIL_LIKE_DIGEST_MINUTES window, not one
  // per like — see EMAIL_LIKE_DIGEST_MINUTES above.
  queueNotificationEmail({
    recipientId,
    notification,
    preferenceKey: "notifyLikes",
    dedupeKey: `like:${relatedEntityType}:${relatedEntityId}:${recipientId}`,
    scheduledAt: new Date(Date.now() + EMAIL_LIKE_DIGEST_MINUTES * 60 * 1000),
  });

  return notification;
};

module.exports = {
  createNotificationForUser,
  notifyManyUsers,
  notifyNewMessage,
  notifyLike,
  buildRealtimePayload,
};
