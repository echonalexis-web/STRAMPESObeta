// Phase 3 — username as a second sign-in identifier (see
// markdowns/NOTIF_EMAIL_ID_OCR_AND_ACCOUNT_RECOVERY_PLAN.md §3).
// Unit tests for utils/username.js. Models are mocked at the boundary
// (User.findOne / ReservedUsername.findOne) rather than mocking isAvailable
// itself, so suggestFromEmailLocalPart below exercises the REAL isAvailable
// — these two functions live in the same module and can't be mocked from
// each other the way a separate module's export can.

jest.mock("../models/User", () => ({ findOne: jest.fn() }));
jest.mock("../models/ReservedUsername", () => ({ findOne: jest.fn() }));

const User = require("../models/User");
const ReservedUsername = require("../models/ReservedUsername");
const usernameUtil = require("../utils/username");

const chain = (resolvedValue) => ({
  collation: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(resolvedValue) }),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("validateFormat", () => {
  test.each([
    ["ab", false, "too short"],
    ["abc", true, "minimum valid length"],
    ["a".repeat(30), true, "maximum valid length"],
    ["a".repeat(31), false, "too long"],
    [".abc", false, "leading dot"],
    ["abc.", false, "trailing dot"],
    ["_abc", false, "leading underscore"],
    ["abc_", false, "trailing underscore"],
    ["ab..cd", false, "doubled dot"],
    ["ab__cd", false, "doubled underscore"],
    ["ab.cd_ef", true, "single dot and underscore allowed"],
    ["123", false, "all digits"],
    ["12a", true, "digits mixed with a letter"],
    ["admin", false, "reserved word"],
    ["ADMIN", false, "reserved word, case-insensitive"],
    ["me@example.com", false, "contains @"],
    ["Jo_hn.Doe99", true, "mixed case normalizes and passes"],
    ["а_b_c", false, "Cyrillic а look-alike — outside the ASCII charset"],
  ])("%s -> ok=%s (%s)", (input, expectedOk) => {
    expect(usernameUtil.validateFormat(input).ok).toBe(expectedOk);
  });

  test("normalizes to lowercase", () => {
    const result = usernameUtil.validateFormat("Jo_hn.Doe99");
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe("jo_hn.doe99");
  });
});

describe("isAvailable", () => {
  test("unavailable when another user already holds it", async () => {
    User.findOne.mockReturnValue(chain({ _id: "someone-else" }));
    ReservedUsername.findOne.mockReturnValue(chain(null));

    expect(await usernameUtil.isAvailable("taken")).toBe(false);
  });

  test("unavailable while tombstoned, even though no User holds it", async () => {
    User.findOne.mockReturnValue(chain(null));
    ReservedUsername.findOne.mockReturnValue(chain({ _id: "tombstone1" }));

    expect(await usernameUtil.isAvailable("recently-released")).toBe(false);
  });

  test("available when neither a User nor a tombstone holds it", async () => {
    User.findOne.mockReturnValue(chain(null));
    ReservedUsername.findOne.mockReturnValue(chain(null));

    expect(await usernameUtil.isAvailable("free-name")).toBe(true);
  });

  test("excludes the account's own current username from the User check", async () => {
    User.findOne.mockReturnValue(chain(null));
    ReservedUsername.findOne.mockReturnValue(chain(null));

    await usernameUtil.isAvailable("mine", "user1");

    expect(User.findOne).toHaveBeenCalledWith({ username: "mine", _id: { $ne: "user1" } });
  });

  test("uses a case-insensitive collation for both checks", async () => {
    const userChain = chain(null);
    const reservedChain = chain(null);
    User.findOne.mockReturnValue(userChain);
    ReservedUsername.findOne.mockReturnValue(reservedChain);

    await usernameUtil.isAvailable("mixedcase");

    expect(userChain.collation).toHaveBeenCalledWith({ locale: "en", strength: 2 });
    expect(reservedChain.collation).toHaveBeenCalledWith({ locale: "en", strength: 2 });
  });
});

describe("getChangeCooldown", () => {
  test("allows a first-time set (usernameChangedAt never set)", () => {
    expect(usernameUtil.getChangeCooldown({ usernameChangedAt: null }).ok).toBe(true);
  });

  test("blocks a change made 5 days ago (cooldown is 30 days)", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const result = usernameUtil.getChangeCooldown({ usernameChangedAt: fiveDaysAgo });
    expect(result.ok).toBe(false);
    expect(result.nextAllowedAt.getTime()).toBeGreaterThan(Date.now());
  });

  test("allows a change made 31 days ago", () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect(usernameUtil.getChangeCooldown({ usernameChangedAt: thirtyOneDaysAgo }).ok).toBe(true);
  });
});

describe("suggestFromEmailLocalPart", () => {
  test("returns null when the cleaned-up local part is too short to be worth guessing", async () => {
    expect(await usernameUtil.suggestFromEmailLocalPart("a")).toBeNull();
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test("returns the base candidate when it's immediately available", async () => {
    User.findOne.mockReturnValue(chain(null));
    ReservedUsername.findOne.mockReturnValue(chain(null));

    const result = await usernameUtil.suggestFromEmailLocalPart("jane.doe");
    expect(result).toBe("jane.doe");
  });

  test("strips characters outside the allowed charset before trying", async () => {
    User.findOne.mockReturnValue(chain(null));
    ReservedUsername.findOne.mockReturnValue(chain(null));

    const result = await usernameUtil.suggestFromEmailLocalPart("jane+doe!!");
    expect(result).toBe("janedoe");
  });

  test("falls back to a suffixed candidate when the base is already taken", async () => {
    User.findOne
      .mockReturnValueOnce(chain({ _id: "taken-by-someone" })) // base taken
      .mockReturnValue(chain(null)); // every later candidate free
    ReservedUsername.findOne.mockReturnValue(chain(null));

    const result = await usernameUtil.suggestFromEmailLocalPart("jane");
    expect(result).toMatch(/^jane\d{3}$/);
  });

  test("gives up and returns null rather than loop forever when nothing is ever available", async () => {
    User.findOne.mockReturnValue(chain({ _id: "always-taken" }));
    ReservedUsername.findOne.mockReturnValue(chain(null));

    expect(await usernameUtil.suggestFromEmailLocalPart("popular")).toBeNull();
  });

  test("a base that collapses to a reserved/all-digits word is skipped, not returned", async () => {
    User.findOne.mockReturnValue(chain(null));
    ReservedUsername.findOne.mockReturnValue(chain(null));

    // "admin" is reserved — the function must move on to a suffixed
    // candidate rather than returning the reserved word itself.
    const result = await usernameUtil.suggestFromEmailLocalPart("admin");
    expect(result).not.toBe("admin");
    expect(result).toMatch(/^admin\d{3}$/);
  });
});
