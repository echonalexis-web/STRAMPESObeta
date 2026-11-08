// Pure pieces of the announcement -> SpesPosting migration, kept apart from the
// script so they can be unit tested without a database.

// The fields of a new SpesPosting for a legacy announcement (category "spes").
const postingFieldsFromAnnouncement = (a) => {
  const s = a.spes || {};
  const released = s.resultsStatus === "published";
  return {
    title: a.title,
    description: a.content || "",
    coverImage: a.imageUrl || "",
    status: a.isActive === false ? "draft" : "published",
    opensAt: s.opensAt || null,
    applicationDeadline: s.applicationDeadline || null,
    closedAt: s.closedAt || null,
    slots: s.slots ?? null,
    requiredSlots: Array.isArray(s.requiredSlots) ? s.requiredSlots : [],
    requirements: Array.isArray(s.requirements) ? s.requirements : [],
    results: {
      status: released ? "released" : "pending",
      releasedAt: s.resultsPublishedAt || null,
      releasedBy: s.resultsPublishedBy || null,
      summary: s.resultsSummary || "",
      url: s.resultsUrl || "",
      publishAcceptedList: Boolean(s.publishAcceptedList),
      exposeScores: Boolean(s.exposeScores),
    },
    guardianRequired: null,
    createdBy: a.author || null,
    publishedAt: a.publishedAt || null,
    legacyAnnouncementId: a._id,
    newsAnnouncementId: a._id,
  };
};

// Index changes the migration makes, as data so a dry run can print them exactly.
// The old plain unique index {applicant, announcement} treats a missing announcement
// as null, so one applicant could not apply to two native postings.
const INDEX_STEPS = [
  { action: "dropIndex", name: "applicant_1_announcement_1", reason: "old plain unique index" },
  {
    action: "createIndex",
    keys: { applicant: 1, announcement: 1 },
    options: { unique: true, partialFilterExpression: { announcement: { $type: "objectId" } } },
  },
  {
    action: "createIndex",
    keys: { applicant: 1, posting: 1 },
    options: { unique: true, partialFilterExpression: { posting: { $type: "objectId" } } },
  },
];

// Given what is already in the database, decides what a run would do. Idempotent:
// an announcement that already has a posting is skipped.
//   announcements: [{ _id, ... }]            legacy announcements (category spes, no spesPostingId)
//   existingLegacyIds: Set<string>           legacyAnnouncementId values already migrated
const planMigration = (announcements, existingLegacyIds = new Set()) => {
  const toCreate = [];
  const skipped = [];
  for (const a of announcements) {
    if (existingLegacyIds.has(String(a._id))) skipped.push(String(a._id));
    else toCreate.push({ announcementId: String(a._id), fields: postingFieldsFromAnnouncement(a) });
  }
  return { toCreate, skipped };
};

module.exports = { postingFieldsFromAnnouncement, planMigration, INDEX_STEPS };
