/**
 * emailOutboxService — background drain of the EmailOutbox queue.
 *
 * notificationService (and anything else that wants a notification mirrored
 * by email) calls `enqueueEmail()` to add a row; `drainEmailOutbox()` — run
 * on an interval by `startEmailOutboxWorker()` from server.js — sends due
 * rows a few at a time, respecting a daily send cap (Gmail SMTP's ~500/day
 * limit) and retrying transient failures with backoff.
 *
 * Deliberately NOT inline with notification creation: a single bulk event
 * can fan out to far more recipients than can be mailed in one run, and a
 * burst of "new message" notifications needs somewhere to collapse into one
 * digest row before it's actually sent (see `dedupeKey` on the model).
 */
const EmailOutbox = require("../models/EmailOutbox");
const Notification = require("../models/Notification");
const mailService = require("./mailService");
const logger = require("../utils/logger");

const DEFAULT_BATCH_SIZE = Number(process.env.EMAIL_BATCH_SIZE) || 25;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MINUTES = 5;

// Read inside drainEmailOutbox (not cached at module load like the
// constants above) so it reflects the current env on every call.
const getDailyCap = () => Number(process.env.EMAIL_DAILY_CAP) || 450;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Queue one email. Returns the created/updated row, or null if the minimum
 * required fields aren't present (never throws for that — a caller that
 * forgot to supply a subject shouldn't be able to crash its own request).
 *
 * `dedupeKey`, when given, collapses repeated calls sharing the same key
 * into a single row while that row is still "queued" — e.g. a burst of chat
 * messages in the same conversation/hour updates one pending digest email
 * instead of creating one row per message.
 */
const enqueueEmail = async ({
  recipientId,
  toEmail,
  notificationId = null,
  category = "",
  subject,
  heading,
  paragraphs = [],
  button = null,
  footnote = "",
  scheduledAt = new Date(),
  dedupeKey = null,
}) => {
  if (!toEmail || !subject || !heading) return null;

  // Content fields only — deliberately WITHOUT scheduledAt. For a deduped
  // digest (dedupeKey set), a second call within the same window must only
  // refresh what the email will say (e.g. "3 new messages" replacing "1 new
  // message"), never push scheduledAt forward again — a conversation that
  // stays active for longer than the digest window would otherwise never
  // actually get emailed, since every new message would keep rescheduling
  // it another `scheduledAt` into the future.
  const contentFields = {
    recipient: recipientId,
    toEmail,
    notification: notificationId,
    category,
    subject,
    heading,
    paragraphs,
    buttonUrl: button?.url || "",
    buttonLabel: button?.label || "",
    footnote,
  };

  if (!dedupeKey) {
    return EmailOutbox.create({ ...contentFields, scheduledAt });
  }

  try {
    // Only folds into a row that's still waiting to send — once a digest for
    // this bucket has moved past "queued" (sending/sent/failed/suppressed),
    // a new event for the same key starts a fresh row instead of mutating
    // one already in flight. $setOnInsert only takes effect on the FIRST
    // call for a given key (the actual insert); every later call matches
    // that existing row and only $set's the content above, leaving its
    // original scheduledAt alone.
    return await EmailOutbox.findOneAndUpdate(
      { dedupeKey, status: "queued" },
      { $set: contentFields, $setOnInsert: { dedupeKey, scheduledAt } },
      { upsert: true, new: true }
    );
  } catch (err) {
    // Duplicate-key race: another request's upsert won between our query and
    // insert, and that row is no longer "queued" by the time we'd retry —
    // fall back to a plain, non-deduped row rather than lose the email.
    // Deliberately omit dedupeKey entirely here (not `dedupeKey: null`) —
    // see the field's comment in models/EmailOutbox.js: the sparse unique
    // index only exempts a row where the field is genuinely absent, and an
    // explicit null would collide with every other non-deduped row ever
    // created this way.
    if (err?.code === 11000) {
      return EmailOutbox.create({ ...contentFields, scheduledAt });
    }
    throw err;
  }
};

const buildPlainText = (doc) => {
  const lines = [doc.heading, "", ...doc.paragraphs];
  if (doc.buttonUrl) lines.push("", doc.buttonLabel || "Open link", doc.buttonUrl);
  if (doc.footnote) lines.push("", doc.footnote);
  return lines.join("\n");
};

// `heading`/`paragraphs` on a queued row can carry another user's free text
// (a chat message preview, an actor's display name, a job title someone
// typed) — unlike every hand-authored template in mailService.js, which only
// ever interpolates server-known strings. Escaped ONLY for the HTML build
// below, never for buildPlainText above: the stored value must stay raw or
// the plain-text part of the email would literally show "&amp;" etc.
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

const scheduleRetry = (doc, errorMessage) => {
  doc.lastError = errorMessage;
  if (doc.attempts >= MAX_ATTEMPTS) {
    doc.status = "failed";
    doc.resolvedAt = new Date();
  } else {
    doc.status = "queued";
    doc.scheduledAt = new Date(Date.now() + RETRY_BASE_MINUTES * 60 * 1000 * 2 ** (doc.attempts - 1));
  }
};

const sendOne = async (doc) => {
  // The in-app notification this mirrors was already read before this
  // (deliberately delayed) email went out — nothing left worth emailing.
  if (doc.notification) {
    const notification = await Notification.findById(doc.notification).select("isRead");
    if (notification?.isRead) {
      doc.status = "suppressed";
      doc.resolvedAt = new Date();
      await doc.save();
      return;
    }
  }

  // Suspend/ban notices get a red warning band. Matched on the subject
  // (= notification title set in adminController) to avoid a schema change.
  const accountAction = /^Your account was (suspended|banned)/i.exec(doc.subject || "");
  const alert = accountAction
    ? `Account ${accountAction[1].toLowerCase()} — action required`
    : undefined;

  const html = mailService.renderEmail({
    alert,
    heading: escapeHtml(doc.heading),
    paragraphs: doc.paragraphs.map(escapeHtml),
    // buttonUrl/buttonLabel and footnote are always server-constructed
    // (an absolute /path route + a hardcoded label; the unsubscribe link) —
    // never derived from another user's input — so these are left raw.
    button: doc.buttonUrl ? { url: doc.buttonUrl, label: doc.buttonLabel || "Open" } : null,
    footnote: doc.footnote,
  });

  // sendMail() never throws — it falls back to a console log (no mailer
  // configured, or a transporter that failed to connect) and reports which
  // happened via `channel`. Only "error" (a configured transporter that
  // actually rejected the send) is treated as a failure worth retrying;
  // "console" is this app's normal non-prod behavior, same as every
  // existing transactional email, so it's treated as done.
  const result = await mailService.sendMail({
    to: doc.toEmail,
    subject: doc.subject,
    text: buildPlainText(doc),
    html,
  });

  if (result.channel === "error") {
    scheduleRetry(doc, "SMTP send failed");
    await doc.save();
    return;
  }

  doc.status = "sent";
  doc.sentAt = new Date();
  doc.resolvedAt = new Date();
  await doc.save();
};

/**
 * Send up to `batchSize` due rows, never exceeding the daily send cap for
 * today. Each row is claimed with its own atomic findOneAndUpdate, so
 * running this concurrently (e.g. two server instances) can't double-send
 * the same row — each claim either succeeds once or finds nothing.
 */
const drainEmailOutbox = async ({ batchSize = DEFAULT_BATCH_SIZE } = {}) => {
  const dailyCap = getDailyCap();
  const sentToday = await EmailOutbox.countDocuments({ status: "sent", sentAt: { $gte: startOfToday() } });
  const budget = Math.max(0, Math.min(batchSize, dailyCap - sentToday));
  if (budget <= 0) {
    return { drained: 0, cappedForToday: true };
  }

  let drained = 0;
  for (let i = 0; i < budget; i++) {
    const doc = await EmailOutbox.findOneAndUpdate(
      { status: "queued", scheduledAt: { $lte: new Date() } },
      { $set: { status: "sending" }, $inc: { attempts: 1 } },
      { sort: { scheduledAt: 1 }, new: true }
    );
    if (!doc) break; // nothing due right now

    try {
      await sendOne(doc);
    } catch (err) {
      logger.error("emailOutboxService: send failed unexpectedly", { id: String(doc._id), error: err.message });
      scheduleRetry(doc, err.message);
      await doc.save().catch((saveErr) =>
        logger.error("emailOutboxService: could not persist retry state", {
          id: String(doc._id),
          error: saveErr.message,
        })
      );
    }
    drained++;
  }

  return { drained, cappedForToday: sentToday + drained >= dailyCap };
};

let _timer = null;
let _draining = false;

/**
 * Starts the background drain loop. Safe to call once at server startup;
 * a second call is a no-op. Disable entirely (e.g. for a test run, or a
 * secondary instance that shouldn't send mail) with EMAIL_WORKER_ENABLED=false.
 */
const startEmailOutboxWorker = ({ intervalMs = 30_000 } = {}) => {
  if (process.env.EMAIL_WORKER_ENABLED === "false") {
    logger.info("emailOutboxService: worker disabled via EMAIL_WORKER_ENABLED=false");
    return;
  }
  if (_timer) return;

  _timer = setInterval(() => {
    // Skip a tick rather than overlap if the previous drain is still
    // running (a slow SMTP batch outlasting one 30s interval).
    if (_draining) return;
    _draining = true;
    drainEmailOutbox()
      .catch((err) => logger.error("emailOutboxService: drain cycle failed", { error: err.message }))
      .finally(() => {
        _draining = false;
      });
  }, intervalMs);

  // Don't hold the process open on this timer alone (useful for tests / a
  // clean graceful shutdown).
  _timer.unref?.();
};

const stopEmailOutboxWorker = () => {
  if (_timer) clearInterval(_timer);
  _timer = null;
};

module.exports = {
  enqueueEmail,
  drainEmailOutbox,
  startEmailOutboxWorker,
  stopEmailOutboxWorker,
};
