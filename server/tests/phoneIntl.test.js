// International phone parser (profile forms overhaul). Pure functions, no DB.
const {
  parsePhone,
  toE164,
  canonicalPhone,
  nsrpPhone,
  phoneProblemDetailed,
  allowLandlineForRole,
  PHONE_COUNTRIES,
} = require("../utils/phone");

describe("Philippines (+63) mobile", () => {
  test.each([
    ["917 123 4567", "+639171234567"],
    ["0917 123 4567", "+639171234567"],
    ["09171234567", "+639171234567"],
    ["+63 917 123 4567", "+639171234567"],
    ["+639171234567", "+639171234567"],
    ["639171234567", "+639171234567"],
    ["(0917) 123-4567", "+639171234567"],
    ["09125826297", "+639125826297"],
  ])("%s -> %s", (input, e164) => {
    const parsed = parsePhone(input);
    expect(parsed.ok).toBe(true);
    expect(parsed.e164).toBe(e164);
    expect(parsed.iso).toBe("PH");
    expect(parsed.kind).toBe("mobile");
  });

  test.each([
    ["", "PHONE_REQUIRED"],
    ["   ", "PHONE_REQUIRED"],
    ["0917-123-45x7", "PHONE_BAD_CHARS"],
    ["abc", "PHONE_BAD_CHARS"],
    ["917 123 456", "PHONE_TOO_SHORT"],
    ["0917123456", "PHONE_TOO_SHORT"],
    ["091712345678", "PHONE_TOO_LONG"],
    ["+63 9171234567890", "PHONE_TOO_LONG"],
    ["112 345 6789", "PHONE_PH_FORMAT"],
    ["912 345 6789", "PHONE_WEAK"],
    ["09111111111", "PHONE_WEAK"],
    ["+999 123456", "PHONE_COUNTRY_UNKNOWN"],
  ])("%j is rejected with %s", (input, code) => {
    const parsed = parsePhone(input);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe(code);
  });

  test("the example hint number is valid", () => {
    expect(parsePhone("917 123 4567").ok).toBe(true);
  });
});

describe("Philippines landline", () => {
  test("accepted by default (legacy) and when allowLandline is true", () => {
    expect(parsePhone("02 8123 4567").ok).toBe(true);
    expect(parsePhone("042 321 4567", { allowLandline: true }).kind).toBe("landline");
  });
  test("refused for jobseekers (mobile only)", () => {
    const res = parsePhone("02 8123 4567", { allowLandline: allowLandlineForRole("jobseeker") });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("PHONE_PH_FORMAT");
  });
  test("employers and staff may use a landline", () => {
    expect(allowLandlineForRole("employer")).toBe(true);
    expect(allowLandlineForRole("admin")).toBe(true);
  });
});

describe("other countries (generic rule)", () => {
  test.each([
    ["+1 415 555 2671", "+14155552671", "US"],
    ["+44 7911 123456", "+447911123456", "GB"],
    ["+971 50 123 4567", "+971501234567", "AE"],
    ["+44 07911 123456", "+447911123456", "GB"],
  ])("%s", (input, e164, iso) => {
    const parsed = parsePhone(input);
    expect(parsed.ok).toBe(true);
    expect(parsed.e164).toBe(e164);
    expect(parsed.iso).toBe(iso);
  });

  test("too short, too long, all one digit, unknown dial code", () => {
    expect(parsePhone("+44 12345").code).toBe("PHONE_TOO_SHORT");
    expect(parsePhone("+1 4155552671234567").code).toBe("PHONE_TOO_LONG");
    expect(parsePhone("+1 111 111 1111").code).toBe("PHONE_WEAK");
    expect(parsePhone("+999 1234567").code).toBe("PHONE_COUNTRY_UNKNOWN");
  });

  test("total length never passes 15 digits (E.164)", () => {
    const res = parsePhone("+971 12345678901234");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("PHONE_TOO_LONG");
  });

  test("a chosen default country is used for numbers typed without a plus", () => {
    const res = parsePhone("7911 123456", { defaultIso: "GB" });
    expect(res.ok).toBe(true);
    expect(res.e164).toBe("+447911123456");
  });

  test("+1 and +7 prefer US and Russia", () => {
    expect(parsePhone("+1 415 555 2671").iso).toBe("US");
    expect(parsePhone("+7 912 345 6780").iso).toBe("RU");
  });
});

describe("helpers", () => {
  test("toE164 and canonicalPhone", () => {
    expect(toE164("0917 123 4567")).toBe("+639171234567");
    expect(toE164("abc")).toBeNull();
    expect(canonicalPhone("0917 123 4567")).toBe("+639171234567");
    // An unparseable legacy value is returned as given, never blanked.
    expect(canonicalPhone("n/a 123")).toBe("n/a 123");
    expect(canonicalPhone(undefined)).toBeUndefined();
  });

  test("nsrpPhone prints the national form for +63 and E.164 elsewhere", () => {
    expect(nsrpPhone("+639125826297")).toBe("0912 582 6297");
    expect(nsrpPhone("09125826297")).toBe("0912 582 6297");
    expect(nsrpPhone("+14155552671")).toBe("+14155552671");
    expect(nsrpPhone("not a number")).toBe("not a number");
    expect(nsrpPhone("")).toBe("");
  });

  test("phoneProblemDetailed returns code and params", () => {
    expect(phoneProblemDetailed("917 123 4567")).toBeNull();
    expect(phoneProblemDetailed("917 123 456")).toEqual({ code: "PHONE_TOO_SHORT", params: { min: 10 } });
  });
});

describe("country data", () => {
  test("Philippines is first and every entry is well formed and unique by ISO", () => {
    expect(PHONE_COUNTRIES[0]).toEqual({ iso: "PH", name: "Philippines", dial: "63" });
    const isos = new Set();
    for (const c of PHONE_COUNTRIES) {
      expect(c.iso).toMatch(/^[A-Z]{2}$/);
      expect(c.dial).toMatch(/^\d{1,4}$/);
      expect(isos.has(c.iso)).toBe(false);
      isos.add(c.iso);
    }
  });
});
