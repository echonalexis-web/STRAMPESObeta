// In-app security alerts. They work for accounts with no email (an in-app
// notification needs no mailbox). Every function here NEVER throws: an alert
// failure must not change the outcome of the action that triggered it.
//
// Title and message are English fallbacks; `metadata.alertKey` lets the client
// translate (i18n namespace `alerts.*`).

const crypto = require("crypto");
const User = require("../models/User");
const { createNotificationForUser } = require("./notificationService");
const logger = require("../utils/logger");

const MAX_KNOWN_DEVICES = 10;

const ALERTS = {
  emailAdded: {
    title: "Email added to your account",
    message: "An email address was added and verified on your account. If this was not you, change your password now.",
  },
  passwordChanged: {
    title: "Your password was changed",
    message: "The password on your account was changed. If this was not you, reset it now and contact the PESO office.",
  },
  newSignIn: {
    title: "New sign-in",
    message: "Your account was signed in from a browser or device we have not seen before. If this was not you, change your password.",
  },
  failedAttempts: {
    title: "Failed sign-in attempts",
    message: "There were several incorrect password attempts on your account before you signed in.",
  },
  passwordResetByStaff: {
    title: "Your password was reset by PESO staff",
    message: "A PESO staff member reset your password after checking your ID. You will be asked to choose a new one when you sign in. If this was not you, contact the PESO office.",
  },
  recoveryRequested: {
    title: "A recovery request was filed for your account",
    message: "Someone asked PESO to help recover this account. Nothing changes unless staff check an ID in person. If this was not you, tell the PESO office.",
  },
  accountLocked: {
    title: "Your account is temporarily locked",
    message: "Too many incorrect password attempts. Sign-in is paused for a while. You can reset your password, use a backup code, or ask the PESO office.",
  },
};

const notify = async (userId, key, req) => {
  try {
    const alert = ALERTS[key];
    await createNotificationForUser({
      recipientId: userId,
      type: "system",
      title: alert.title,
      message: alert.message,
      actionUrl: "/settings",
      metadata: { alertKey: key },
      io: req && req.app && typeof req.app.get === "function" ? req.app.get("io") : null,
    });
  } catch (error) {
    logger.error("Failed to create account alert", { alert: key, userId: String(userId), error: error.message });
  }
};

// Coarse browser family + operating system only. No version, no IP.
const deviceLabel = (userAgent) => {
  const ua = String(userAgent || "");
  const browser = /Edg\//.test(ua)
    ? "edge"
    : /OPR\/|Opera/.test(ua)
      ? "opera"
      : /Firefox\//.test(ua)
        ? "firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "chrome"
          : /Safari\//.test(ua)
            ? "safari"
            : "other";
  const os = /Windows/.test(ua)
    ? "windows"
    : /Android/.test(ua)
      ? "android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "ios"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macos"
          : /Linux/.test(ua)
            ? "linux"
            : "other";
  return `${browser}|${os}`;
};

const deviceHash = (userAgent) => crypto.createHash("sha256").update(deviceLabel(userAgent)).digest("hex").slice(0, 32);

// Records this browser+OS for the account (capped at MAX_KNOWN_DEVICES, oldest
// dropped) and alerts when it is new. The very first sign-in only records.
// Returns true when an alert was raised.
const checkNewDevice = async (userId, userAgent, req) => {
  try {
    const hash = deviceHash(userAgent);
    const before = await User.findOneAndUpdate(
      { _id: userId, knownDevices: { $ne: hash } },
      { $push: { knownDevices: { $each: [hash], $slice: -MAX_KNOWN_DEVICES } } },
      { new: false, projection: { knownDevices: 1 } }
    );
    if (!before) return false; // already a known device
    const hadDevices = Array.isArray(before.knownDevices) && before.knownDevices.length > 0;
    if (!hadDevices) return false; // first sign-in ever
    await notify(userId, "newSignIn", req);
    return true;
  } catch (error) {
    logger.error("New-device check failed", { userId: String(userId), error: error.message });
    return false;
  }
};

module.exports = {
  MAX_KNOWN_DEVICES,
  ALERTS,
  deviceLabel,
  deviceHash,
  checkNewDevice,
  notifyEmailAdded: (userId, req) => notify(userId, "emailAdded", req),
  notifyPasswordChanged: (userId, req) => notify(userId, "passwordChanged", req),
  notifyFailedAttempts: (userId, req) => notify(userId, "failedAttempts", req),
  notifyAccountLocked: (userId, req) => notify(userId, "accountLocked", req),
  notifyPasswordResetByStaff: (userId, req) => notify(userId, "passwordResetByStaff", req),
  notifyRecoveryRequested: (userId, req) => notify(userId, "recoveryRequested", req),
};
