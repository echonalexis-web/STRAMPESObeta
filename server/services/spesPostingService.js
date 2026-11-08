const mongoose = require("mongoose");
const SpesPosting = require("../models/SpesPosting");
const Announcement = require("../models/Announcement");
const User = require("../models/User");
const { notifyManyUsers } = require("./notificationService");
const { fromAnnouncement } = require("../utils/spesPosting");

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

// Finds a posting by any id the client may hold:
//   1. a SpesPosting _id
//   2. the id of the announcement a posting was migrated from (old links keep working)
//   3. a legacy announcement (category spes) that has not been migrated yet, wrapped
//      so it behaves like a posting. Its writes go to the announcement's own `spes`
//      subdocument, so a legacy posting is stored in exactly one place.
// Returns null when nothing matches. Never throws for a malformed id.
const resolvePosting = async (id) => {
  if (!id || !isId(id)) return null;

  const direct = await SpesPosting.findById(id);
  if (direct) return direct;

  const migrated = await SpesPosting.findOne({ legacyAnnouncementId: id });
  if (migrated) return migrated;

  const legacy = await Announcement.findOne({ _id: id, category: "spes", spesPostingId: null, spesNotice: { $ne: true } });
  return legacy ? fromAnnouncement(legacy) : null;
};

// Mongo filter for the applications that belong to a posting. A migrated posting also
// matches applications that still carry only the old announcement reference.
const applicationFilterFor = (posting) => {
  if (posting.legacy) return { announcement: posting._id };
  if (posting.legacyAnnouncementId) {
    return { $or: [{ posting: posting._id }, { announcement: posting.legacyAnnouncementId }] };
  }
  return { posting: posting._id };
};

// The reference fields a NEW application stores for this posting.
const applicationRefsFor = (posting) =>
  posting.legacy ? { announcement: posting._id } : { posting: posting._id };

// Native postings that people can see, plus legacy announcements not migrated yet.
// `now` is only used by callers that filter further; archived and draft are excluded.
const listPublishedPostings = async () => {
  const native = await SpesPosting.find({ status: "published" }).sort({ publishedAt: -1, createdAt: -1 });
  const migratedIds = native.map((p) => p.legacyAnnouncementId).filter(Boolean);
  const legacyAnnouncements = await Announcement.find({
    category: "spes",
    isActive: true,
    spesPostingId: null,
    spesNotice: { $ne: true },
    ...(migratedIds.length ? { _id: { $nin: migratedIds } } : {}),
  }).sort({ publishedAt: -1, createdAt: -1 });
  return [...native, ...legacyAnnouncements.map(fromAnnouncement)];
};

// Everything staff manage: native postings (any status) plus unmigrated legacy ones.
const listAllPostings = async () => {
  const native = await SpesPosting.find({}).sort({ createdAt: -1 }).limit(200);
  const migratedIds = native.map((p) => p.legacyAnnouncementId).filter(Boolean);
  const legacyAnnouncements = await Announcement.find({
    category: "spes",
    spesPostingId: null,
    spesNotice: { $ne: true },
    ...(migratedIds.length ? { _id: { $nin: migratedIds } } : {}),
  }).sort({ createdAt: -1 });
  return [...native, ...legacyAnnouncements.map(fromAnnouncement)];
};

// Side effects of publishing a native posting: the optional news-feed card and the
// jobseeker notice. Best-effort and idempotent: the card is created at most once
// (newsAnnouncementId), and the caller wraps this in runPostCommit.
const announcePosting = async ({ posting, authorId, alsoPostToNews, io }) => {
  if (alsoPostToNews && !posting.newsAnnouncementId) {
    const teaser = String(posting.description || "").slice(0, 400) || posting.title;
    const card = await Announcement.create({
      title: posting.title,
      content: teaser,
      category: "spes",
      spesPostingId: posting._id,
      imageUrl: posting.coverImage || "",
      author: authorId,
      isActive: true,
      publishedAt: new Date(),
    });
    posting.newsAnnouncementId = card._id;
    await posting.save();
  }

  const recipients = await User.find({ role: { $in: ["jobseeker", "employee", "resident"] }, _id: { $ne: authorId } }).select("_id");
  if (recipients.length === 0) return;
  await notifyManyUsers({
    recipientIds: recipients.map((u) => u._id),
    actorId: authorId,
    type: "spes",
    title: "New SPES posting",
    message: posting.title,
    relatedEntityType: "spes_posting",
    relatedEntityId: posting._id,
    actionUrl: `/spes/postings/${posting._id}`,
    io,
  });
};

module.exports = {
  resolvePosting,
  applicationFilterFor,
  applicationRefsFor,
  listPublishedPostings,
  listAllPostings,
  announcePosting,
};
