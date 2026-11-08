// The posting service: finding a posting by any id (native, migrated, legacy),
// the application filters, and the publish side effects.

jest.mock("../models/SpesPosting", () => ({ findById: jest.fn(), findOne: jest.fn(), find: jest.fn() }));
jest.mock("../models/Announcement", () => ({ findOne: jest.fn(), find: jest.fn(), create: jest.fn() }));
jest.mock("../models/User", () => ({ find: jest.fn() }));
jest.mock("../services/notificationService", () => ({ notifyManyUsers: jest.fn().mockResolvedValue(null) }));

const SpesPosting = require("../models/SpesPosting");
const Announcement = require("../models/Announcement");
const User = require("../models/User");
const { notifyManyUsers } = require("../services/notificationService");
const service = require("../services/spesPostingService");

const ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const sortable = (value) => ({ sort: jest.fn().mockResolvedValue(value) });

beforeEach(() => {
  jest.clearAllMocks();
  SpesPosting.findById.mockResolvedValue(null);
  SpesPosting.findOne.mockResolvedValue(null);
  Announcement.findOne.mockResolvedValue(null);
});

describe("resolvePosting", () => {
  test("a malformed or empty id resolves to null without touching the database", async () => {
    expect(await service.resolvePosting("nope")).toBeNull();
    expect(await service.resolvePosting("")).toBeNull();
    expect(SpesPosting.findById).not.toHaveBeenCalled();
  });

  test("a native posting id wins", async () => {
    const native = { _id: ID, title: "Native" };
    SpesPosting.findById.mockResolvedValue(native);
    expect(await service.resolvePosting(ID)).toBe(native);
    expect(Announcement.findOne).not.toHaveBeenCalled();
  });

  test("the id of an announcement that was migrated finds its posting (old links keep working)", async () => {
    const migrated = { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", legacyAnnouncementId: ID };
    SpesPosting.findOne.mockResolvedValue(migrated);
    expect(await service.resolvePosting(ID)).toBe(migrated);
    expect(SpesPosting.findOne).toHaveBeenCalledWith({ legacyAnnouncementId: ID });
  });

  test("an unmigrated SPES announcement is wrapped as a legacy posting", async () => {
    Announcement.findOne.mockResolvedValue({ _id: ID, title: "Old", content: "c", isActive: true, spes: { slots: 5 } });
    const p = await service.resolvePosting(ID);
    expect(p).toMatchObject({ _id: ID, legacy: true, title: "Old", slots: 5 });
    // a news card that points at a posting, and a plain SPES-category notice, are not legacy postings
    expect(Announcement.findOne).toHaveBeenCalledWith({ _id: ID, category: "spes", spesPostingId: null, spesNotice: { $ne: true } });
  });

  test("nothing matches -> null", async () => {
    expect(await service.resolvePosting(ID)).toBeNull();
  });
});

describe("application filters and references", () => {
  test("native: by posting only; migrated: also by the old announcement id; legacy: by announcement", () => {
    expect(service.applicationFilterFor({ _id: "p1" })).toEqual({ posting: "p1" });
    expect(service.applicationFilterFor({ _id: "p1", legacyAnnouncementId: "a1" })).toEqual({
      $or: [{ posting: "p1" }, { announcement: "a1" }],
    });
    expect(service.applicationFilterFor({ _id: "a1", legacy: true })).toEqual({ announcement: "a1" });
  });

  test("a new application stores the reference that matches the posting kind", () => {
    expect(service.applicationRefsFor({ _id: "p1" })).toEqual({ posting: "p1" });
    expect(service.applicationRefsFor({ _id: "a1", legacy: true })).toEqual({ announcement: "a1" });
  });
});

describe("lists", () => {
  test("published list: native postings plus legacy announcements that are not migrated or news cards", async () => {
    SpesPosting.find.mockReturnValue(sortable([{ _id: "p1", legacyAnnouncementId: "a1", title: "Migrated" }]));
    Announcement.find.mockReturnValue(sortable([{ _id: "a2", title: "Legacy", content: "", isActive: true, spes: {} }]));
    const list = await service.listPublishedPostings();
    expect(list.map((p) => String(p._id))).toEqual(["p1", "a2"]);
    expect(list[1].legacy).toBe(true);
    const query = Announcement.find.mock.calls[0][0];
    expect(query).toMatchObject({ category: "spes", isActive: true, spesPostingId: null, spesNotice: { $ne: true }, _id: { $nin: ["a1"] } });
  });
});

describe("announcePosting (publish side effects)", () => {
  const draftPosting = (extra = {}) => ({
    _id: "p1",
    title: "SPES 2026",
    description: "Details",
    save: jest.fn().mockResolvedValue(undefined),
    ...extra,
  });

  test("creates the news card once, links it, and notifies jobseekers with the posting link", async () => {
    Announcement.create.mockResolvedValue({ _id: "card1" });
    User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([{ _id: "u1" }, { _id: "u2" }]) });
    const posting = draftPosting();
    await service.announcePosting({ posting, authorId: "admin1", alsoPostToNews: true, io: null });

    expect(Announcement.create.mock.calls[0][0]).toMatchObject({ category: "spes", spesPostingId: "p1", author: "admin1" });
    expect(posting.newsAnnouncementId).toBe("card1");
    expect(notifyManyUsers.mock.calls[0][0]).toMatchObject({ actionUrl: "/spes/postings/p1", relatedEntityType: "spes_posting" });
    expect(notifyManyUsers.mock.calls[0][0].recipientIds).toEqual(["u1", "u2"]);
  });

  test("with the checkbox off there is no card, but jobseekers are still told", async () => {
    User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([{ _id: "u1" }]) });
    await service.announcePosting({ posting: draftPosting(), authorId: "admin1", alsoPostToNews: false });
    expect(Announcement.create).not.toHaveBeenCalled();
    expect(notifyManyUsers).toHaveBeenCalledTimes(1);
  });

  test("an existing card is not duplicated", async () => {
    User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
    await service.announcePosting({ posting: draftPosting({ newsAnnouncementId: "card1" }), authorId: "admin1", alsoPostToNews: true });
    expect(Announcement.create).not.toHaveBeenCalled();
    expect(notifyManyUsers).not.toHaveBeenCalled();
  });
});
