// Soft delete, restore and purge of employer / jobseeker accounts (superadmin).
//
// Soft delete keeps every document and only marks the User (deletedAt,
// deletedBy, deleteReason, deleteNote, purgeAfter), keeps isActive:false so all
// existing gates still block the account, bumps tokenVersion to revoke every
// session, and closes open recovery requests. Restore clears the marker.
// Purge (run by scripts/purgeDeletedUsers.js after purgeAfter) removes personal
// data and anonymizes what must stay for reporting.
//
// The one write that decides the outcome (marking the User) is a single
// conditional findOneAndUpdate, so two concurrent deletes or a delete racing a
// reactivation cannot both win. Everything after it is best-effort and logged.
const User = require("../models/User");
const SystemSettings = require("../models/SystemSettings");
const JobVacancy = require("../models/JobVacancy");
const JobApplication = require("../models/JobApplication");
const AccountRecoveryRequest = require("../models/AccountRecoveryRequest");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const JobseekerDocument = require("../models/JobseekerDocument");

// Required explicitly (not looked up by name) so the purge never depends on
// which models other code happened to load first.
const PERSONAL_MODELS = {
  JobseekerProfile: require("../models/JobseekerProfile"),
  EmployerProfile: require("../models/EmployerProfile"),
  JobLike: require("../models/JobLike"),
  NewsLike: require("../models/NewsLike"),
  NewsComment: require("../models/NewsComment"),
  Follow: require("../models/Follow"),
  Notification: require("../models/Notification"),
  ContactShare: require("../models/ContactShare"),
  EmailOutbox: require("../models/EmailOutbox"),
  QualificationTemplate: require("../models/QualificationTemplate"),
  MatchWeightProfile: require("../models/MatchWeightProfile"),
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETABLE_ROLES = ["employer", "jobseeker"];
const DEFAULT_GRACE_DAYS = 30;
const MIN_GRACE_DAYS = 7;
const MAX_GRACE_DAYS = 365;

// Allowed reasons (the UI shows a select plus an optional note).
const DELETE_REASONS = [
  "policy_violation",
  "fraud_or_fake",
  "duplicate_account",
  "user_request",
  "inactive",
  "other",
];
const NOTE_MAX = 500;

const IN_PROGRESS_APPLICATION_STATUSES = ["pending", "under_review", "shortlisted", "approved", "Applied", "Reviewed", "reviewed"];

const getGraceDays = async () => {
  try {
    const settings = await SystemSettings.getSingleton();
    const days = Number(settings && settings.deletedAccountGraceDays);
    if (Number.isFinite(days) && days >= MIN_GRACE_DAYS && days <= MAX_GRACE_DAYS) return Math.round(days);
  } catch {
    /* fall back to the default */
  }
  return DEFAULT_GRACE_DAYS;
};

// "What this will affect", shown in the confirmation step and written to the
// audit entry. Aggregation counts only, no per-record loops.
const summarizeAccount = async (user) => {
  const id = user._id;
  if (user.role === "employer") {
    const vacancies = await JobVacancy.find({ employer: id }).select("_id status isActive").lean();
    const ids = vacancies.map((v) => v._id);
    const byStatus = ids.length
      ? await JobApplication.aggregate([
          { $match: { vacancy: { $in: ids } } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ])
      : [];
    const count = (statuses) => byStatus.filter((row) => statuses.includes(row._id)).reduce((sum, row) => sum + row.count, 0);
    return {
      role: "employer",
      postings: vacancies.length,
      openPostings: vacancies.filter((v) => v.status !== "closed" && v.isActive !== false).length,
      applicationsReceived: byStatus.reduce((sum, row) => sum + row.count, 0),
      applicationsInProgress: count(IN_PROGRESS_APPLICATION_STATUSES),
      hires: count(["hired"]),
    };
  }
  const byStatus = await JobApplication.aggregate([
    { $match: { applicant: id } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  return {
    role: "jobseeker",
    applications: byStatus.reduce((sum, row) => sum + row.count, 0),
    applicationsInProgress: byStatus.filter((row) => IN_PROGRESS_APPLICATION_STATUSES.includes(row._id)).reduce((sum, row) => sum + row.count, 0),
    hires: byStatus.filter((row) => row._id === "hired").reduce((sum, row) => sum + row.count, 0),
  };
};

class DeletionError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Validates the request and returns the loaded target. Throws DeletionError.
const loadDeletableTarget = async ({ actorId, targetId }) => {
  if (String(actorId) === String(targetId)) {
    throw new DeletionError(400, "You cannot delete your own account.", "DELETE_SELF");
  }
  const user = await User.findById(targetId).select("role isActive accountStatus deletedAt purgedAt username email name");
  if (!user) throw new DeletionError(404, "User not found", "NOT_FOUND");
  if (!DELETABLE_ROLES.includes(user.role)) {
    throw new DeletionError(403, "Staff accounts cannot be deleted from this screen.", "DELETE_STAFF");
  }
  if (user.deletedAt) throw new DeletionError(409, "This account is already deleted.", "ALREADY_DELETED");
  if (user.isActive !== false) {
    throw new DeletionError(409, "Deactivate the account before deleting it.", "NOT_DEACTIVATED");
  }
  return user;
};

// The typed confirmation must equal the account's username or email.
const confirmationMatches = (user, typed) => {
  const given = String(typed || "").trim().toLowerCase();
  if (!given) return false;
  return [user.username, user.email].filter(Boolean).some((v) => String(v).trim().toLowerCase() === given);
};

const softDeleteUser = async ({ actorId, targetId, reason, note, confirm, dryRun = false }) => {
  const user = await loadDeletableTarget({ actorId, targetId });
  const summary = await summarizeAccount(user);
  if (dryRun) return { user, summary };

  if (!DELETE_REASONS.includes(reason)) throw new DeletionError(400, "Choose a reason for deleting this account.", "REASON_REQUIRED");
  if (!confirmationMatches(user, confirm)) {
    throw new DeletionError(400, "The confirmation does not match this account's username or email.", "CONFIRMATION_MISMATCH");
  }
  const cleanNote = String(note || "").trim().slice(0, NOTE_MAX) || null;

  const graceDays = await getGraceDays();
  const now = new Date();
  const purgeAfter = new Date(now.getTime() + graceDays * DAY_MS);

  // Atomic guard: only an inactive, not-yet-deleted employer/jobseeker matches.
  const updated = await User.findOneAndUpdate(
    { _id: user._id, role: { $in: DELETABLE_ROLES }, isActive: false, deletedAt: null },
    {
      $set: { deletedAt: now, deletedBy: actorId, deleteReason: reason, deleteNote: cleanNote, purgeAfter },
      $inc: { tokenVersion: 1 },
    },
    { new: true, projection: "_id role" }
  );
  if (!updated) throw new DeletionError(409, "This account changed while you were deleting it. Reload and try again.", "CONFLICT");

  // Best-effort: an open recovery request for a deleted account is moot.
  let recoveryClosed = 0;
  try {
    const result = await AccountRecoveryRequest.updateMany(
      { resolvedUser: user._id, status: { $in: ["pending", "under_review"] } },
      { $set: { status: "rejected" } }
    );
    recoveryClosed = result && (result.modifiedCount ?? result.nModified) || 0;
  } catch {
    /* the delete itself already committed */
  }

  return { user, summary: { ...summary, recoveryRequestsClosed: recoveryClosed }, deletedAt: now, purgeAfter, graceDays, reason, note: cleanNote };
};

const restoreUser = async ({ targetId }) => {
  const user = await User.findById(targetId).select("role deletedAt purgedAt purgeAfter");
  if (!user) throw new DeletionError(404, "User not found", "NOT_FOUND");
  if (!DELETABLE_ROLES.includes(user.role)) throw new DeletionError(403, "Staff accounts cannot be restored from this screen.", "DELETE_STAFF");
  if (!user.deletedAt) throw new DeletionError(409, "This account is not deleted.", "NOT_DELETED");
  if (user.purgedAt || (user.purgeAfter && user.purgeAfter.getTime() <= Date.now())) {
    throw new DeletionError(410, "The grace period has ended, so this account can no longer be restored.", "GRACE_ENDED");
  }
  // Back to the state it was deleted from: still deactivated (isActive:false).
  // A superadmin then uses Reactivate. tokenVersion is bumped again so any
  // token issued in between stays dead.
  const restored = await User.findOneAndUpdate(
    { _id: user._id, deletedAt: { $ne: null }, purgedAt: null, purgeAfter: { $gt: new Date() } },
    {
      $set: { deletedAt: null, deletedBy: null, deleteReason: null, deleteNote: null, purgeAfter: null },
      $inc: { tokenVersion: 1 },
    },
    { new: true, projection: "_id role" }
  );
  if (!restored) throw new DeletionError(409, "This account changed while you were restoring it. Reload and try again.", "CONFLICT");
  return { user };
};

// ----- purge ---------------------------------------------------------------

const PURGE_FILE_FIELDS = ["profileImage", "businessPermitUrl", "registrationDocUrl", "resumeFile", "validIdFile"];

// Collections whose rows are personal to the user and are removed on purge.
// (model, field) pairs; Conversation/Message are handled separately.
const personalCollections = () => [
  ["JobseekerProfile", "userId"],
  ["EmployerProfile", "userId"],
  ["JobLike", "userId"],
  ["NewsLike", "userId"],
  ["NewsComment", "author"],
  ["Follow", "follower"],
  ["Follow", "following"],
  ["Notification", "recipient"],
  ["ContactShare", "jobseeker"],
  ["ContactShare", "employer"],
  ["EmailOutbox", "recipient"],
  ["QualificationTemplate", "employer"],
  ["MatchWeightProfile", "owner"],
];


// Idempotent: a user already purged is skipped; a half-finished earlier run
// simply repeats steps that delete nothing the second time.
const purgeUser = async (userId, { storage, dryRun = false, log = () => {} } = {}) => {
  const user = await User.findById(userId).select(`role deletedAt purgedAt purgeAfter cover ${PURGE_FILE_FIELDS.join(" ")}`).lean();
  if (!user) return { status: "missing" };
  if (user.purgedAt) return { status: "already_purged" };
  if (!user.deletedAt || !user.purgeAfter || user.purgeAfter.getTime() > Date.now()) return { status: "not_due" };
  if (!DELETABLE_ROLES.includes(user.role)) return { status: "skipped_role" };

  const counts = { files: 0, conversations: 0, messages: 0 };
  if (dryRun) return { status: "would_purge", counts };
  if (!storage || typeof storage.remove !== "function") {
    throw new Error("purgeUser needs a storage service to remove files.");
  }

  // Any failure below leaves the account NOT marked as purged (and its file
  // references intact), so the next run retries the steps that still have work.
  // Every step is safe to repeat: deleting rows that are gone deletes nothing,
  // and removing a file that is already gone is not an error.
  let failures = 0;
  const fail = (message) => {
    failures += 1;
    log(message);
  };

  // Files first: the document rows hold the stored references, so a row is
  // deleted only after its file was removed.
  const removeFile = async (value) => {
    try {
      await storage.remove(value, { strict: true });
      counts.files += 1;
      return true;
    } catch (error) {
      fail(`file removal failed for ${userId}: ${error.message}`);
      return false;
    }
  };

  try {
    const docs = await JobseekerDocument.find({ owner: userId }).select("storedValue").lean();
    const removable = [];
    for (const doc of docs) {
      if (!doc.storedValue || (await removeFile(doc.storedValue))) removable.push(doc._id);
    }
    if (removable.length) await JobseekerDocument.deleteMany({ _id: { $in: removable } });
  } catch (error) {
    fail(`documents for ${userId}: ${error.message}`);
  }

  const storedValues = PURGE_FILE_FIELDS.map((f) => user[f]).filter(Boolean);
  if (user.cover && user.cover.image) storedValues.push(user.cover.image.storedValue, user.cover.image.thumbStoredValue);
  for (const value of storedValues.filter(Boolean)) await removeFile(value);

  // Messages and conversations the user took part in.
  try {
    const conversations = await Conversation.find({ participants: userId }).select("_id").lean();
    const conversationIds = conversations.map((c) => c._id);
    const messageResult = await Message.deleteMany(
      conversationIds.length ? { $or: [{ conversationId: { $in: conversationIds } }, { sender: userId }] } : { sender: userId }
    );
    counts.messages = messageResult.deletedCount || 0;
    const conversationResult = await Conversation.deleteMany({ participants: userId });
    counts.conversations = conversationResult.deletedCount || 0;
  } catch (error) {
    fail(`conversations for ${userId}: ${error.message}`);
  }

  for (const [name, field] of personalCollections()) {
    try {
      const result = await PERSONAL_MODELS[name].deleteMany({ [field]: userId });
      counts[name] = (counts[name] || 0) + (result.deletedCount || 0);
    } catch (error) {
      fail(`${name}.${field} for ${userId}: ${error.message}`);
    }
  }

  if (failures > 0) return { status: "partial", counts, failures };

  // Anonymize the User stub. updateOne skips validators on purpose: required
  // fields (password, email) are being removed.
  await User.updateOne(
    { _id: userId, purgedAt: null },
    {
      $set: {
        name: "Deleted user",
        password: "!purged",
        purgedAt: new Date(),
        isActive: false,
        ...(user.role === "employer" ? { companyName: "Deleted user" } : {}),
      },
      $unset: {
        email: "", username: "", googleId: "", phone: "", address: "", about: "", profileImage: "", cover: "",
        businessPermitUrl: "", registrationDocUrl: "", resumeFile: "", validIdFile: "", governmentIdNumber: "",
        governmentIdType: "", governmentIdOcr: "", pendingEmail: "", recoveryEmail: "", loginLock: "", knownDevices: "",
        emailCode: "", dateOfBirth: "", website: "", businessAddress: "", companyDescription: "",
      },
    }
  );
  return { status: "purged", counts };
};

module.exports = {
  DELETABLE_ROLES,
  DELETE_REASONS,
  DEFAULT_GRACE_DAYS,
  MIN_GRACE_DAYS,
  MAX_GRACE_DAYS,
  DeletionError,
  getGraceDays,
  summarizeAccount,
  confirmationMatches,
  softDeleteUser,
  restoreUser,
  purgeUser,
};
