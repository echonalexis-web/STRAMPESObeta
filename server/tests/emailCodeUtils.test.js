// Pure helpers for the six-digit email code and the startup check.

const code = require("../utils/emailCode");
const { assertUsernameSignupConfig, getEmailCodePepper } = require("../utils/usernameSignup");

const PEPPER = "p".repeat(40);

describe("generateCode / parseCode", () => {
  test("always six digits, zero padded", () => {
    for (let i = 0; i < 300; i += 1) expect(code.generateCode()).toMatch(/^\d{6}$/);
  });

  test("pads small numbers", () => {
    const spy = jest.spyOn(require("crypto"), "randomInt").mockReturnValue(42);
    expect(code.generateCode()).toBe("000042");
    spy.mockRestore();
  });

  test("parseCode strips spaces and dashes and accepts only exactly six digits", () => {
    expect(code.parseCode("123456")).toBe("123456");
    expect(code.parseCode(" 123 456 ")).toBe("123456");
    expect(code.parseCode("123-456")).toBe("123456");
    expect(code.parseCode("12345")).toBeNull();
    expect(code.parseCode("1234567")).toBeNull();
    expect(code.parseCode("12345a")).toBeNull();
    expect(code.parseCode(undefined)).toBeNull();
    expect(code.parseCode({})).toBeNull();
  });
});

describe("hashCode / safeEqualHex", () => {
  const base = { pepper: PEPPER, userId: "u1", target: "a@b.co", code: "123456" };

  test("is an HMAC: deterministic, 64 hex chars, never contains the code", () => {
    const h = code.hashCode(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(code.hashCode(base)).toBe(h);
    expect(h).not.toContain("123456");
  });

  test("depends on pepper, user, target and code", () => {
    const h = code.hashCode(base);
    expect(code.hashCode({ ...base, pepper: "q".repeat(40) })).not.toBe(h);
    expect(code.hashCode({ ...base, userId: "u2" })).not.toBe(h);
    expect(code.hashCode({ ...base, target: "c@d.co" })).not.toBe(h);
    expect(code.hashCode({ ...base, code: "123457" })).not.toBe(h);
  });

  test("safeEqualHex compares in constant time and rejects bad input", () => {
    const h = code.hashCode(base);
    expect(code.safeEqualHex(h, h)).toBe(true);
    expect(code.safeEqualHex(h, code.hashCode({ ...base, code: "000000" }))).toBe(false);
    expect(code.safeEqualHex(h, "")).toBe(false);
    expect(code.safeEqualHex(undefined, undefined)).toBe(false);
    expect(code.safeEqualHex(h, h.slice(0, 10))).toBe(false);
  });
});

describe("planSend (cooldown and hourly cap)", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const ago = (ms) => new Date(now - ms);

  test("first send is allowed and opens a window", () => {
    expect(code.planSend(undefined, now)).toEqual({ ok: true, windowStart: now, sendCount: 1 });
  });

  test("60 second cooldown, with the remaining seconds", () => {
    const r = code.planSend({ lastSentAt: ago(20_000), windowStart: ago(20_000), sendCount: 1 }, now);
    expect(r).toEqual({ ok: false, code: "EMAIL_CODE_COOLDOWN", retryAfter: 40 });
    expect(code.planSend({ lastSentAt: ago(61_000), windowStart: ago(61_000), sendCount: 1 }, now).ok).toBe(true);
  });

  test("5 sends per hour, then EMAIL_CODE_LIMIT with the time left in the window", () => {
    const state = { lastSentAt: ago(120_000), windowStart: ago(10 * 60_000), sendCount: 5 };
    const r = code.planSend(state, now);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("EMAIL_CODE_LIMIT");
    expect(r.retryAfter).toBe(50 * 60);
  });

  test("the count keeps climbing inside the window and resets after it", () => {
    const inside = code.planSend({ lastSentAt: ago(120_000), windowStart: ago(10 * 60_000), sendCount: 3 }, now);
    expect(inside).toEqual({ ok: true, windowStart: now - 10 * 60_000, sendCount: 4 });
    const after = code.planSend({ lastSentAt: ago(2 * 3_600_000), windowStart: ago(2 * 3_600_000), sendCount: 5 }, now);
    expect(after).toEqual({ ok: true, windowStart: now, sendCount: 1 });
  });
});

describe("isUsable", () => {
  const now = Date.now();
  const fresh = { hash: "h", expiresAt: new Date(now + 60_000), attempts: 1 };

  test("usable while unexpired and within 5 tries (the 5th is still evaluated)", () => {
    expect(code.isUsable(fresh, now)).toBe(true);
    expect(code.isUsable({ ...fresh, attempts: 5 }, now)).toBe(true);
    expect(code.isUsable({ ...fresh, attempts: 6 }, now)).toBe(false);
  });

  test("not usable when expired or empty", () => {
    expect(code.isUsable({ ...fresh, expiresAt: new Date(now - 1) }, now)).toBe(false);
    expect(code.isUsable({ ...fresh, hash: undefined }, now)).toBe(false);
    expect(code.isUsable(undefined, now)).toBe(false);
  });
});

describe("audit and counter helpers never expose the address", () => {
  test("emailDomain returns the domain only", () => {
    expect(code.emailDomain("Juan@Example.com")).toBe("example.com");
    expect(code.emailDomain("nope")).toBeNull();
  });

  test("addressKey is a hash, case-insensitive, with no address in it", () => {
    const k = code.addressKey("Juan@Example.com");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).toBe(code.addressKey("juan@example.com"));
    expect(k).not.toMatch(/juan|example/);
  });
});

describe("startup check (pepper)", () => {
  test("flag off: nothing is required", () => {
    expect(() => assertUsernameSignupConfig({})).not.toThrow();
    expect(() => assertUsernameSignupConfig({ USERNAME_SIGNUP_ENABLED: "false" })).not.toThrow();
  });

  test("flag on and pepper missing or short: throws, naming the variable", () => {
    for (const env of [
      { USERNAME_SIGNUP_ENABLED: "true" },
      { USERNAME_SIGNUP_ENABLED: "true", EMAIL_CODE_PEPPER: "" },
      { USERNAME_SIGNUP_ENABLED: "true", EMAIL_CODE_PEPPER: "short" },
      { USERNAME_SIGNUP_ENABLED: "true", EMAIL_CODE_PEPPER: "x".repeat(31) },
    ]) {
      expect(() => assertUsernameSignupConfig(env)).toThrow(/EMAIL_CODE_PEPPER/);
    }
  });

  test("the error message never contains the value", () => {
    const secretish = "s3cr3t-but-too-short";
    try {
      assertUsernameSignupConfig({ USERNAME_SIGNUP_ENABLED: "true", EMAIL_CODE_PEPPER: secretish });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error.message).not.toContain(secretish);
    }
  });

  test("flag on with a 32+ character pepper passes", () => {
    expect(() => assertUsernameSignupConfig({ USERNAME_SIGNUP_ENABLED: "true", EMAIL_CODE_PEPPER: PEPPER })).not.toThrow();
  });

  test("getEmailCodePepper refuses a short value and never echoes it", () => {
    const saved = process.env.EMAIL_CODE_PEPPER;
    process.env.EMAIL_CODE_PEPPER = "tiny-secret";
    try {
      getEmailCodePepper();
      throw new Error("should have thrown");
    } catch (error) {
      expect(error.message).not.toContain("tiny-secret");
    }
    process.env.EMAIL_CODE_PEPPER = PEPPER;
    expect(getEmailCodePepper()).toBe(PEPPER);
    if (saved === undefined) delete process.env.EMAIL_CODE_PEPPER;
    else process.env.EMAIL_CODE_PEPPER = saved;
  });
});
