const { buildUnsubscribeUrl, verifyUnsubscribeSignature } = require("../utils/emailUnsubscribe");

beforeAll(() => {
  process.env.EMAIL_UNSUB_SECRET = "test-unsub-secret";
});

afterAll(() => {
  delete process.env.EMAIL_UNSUB_SECRET;
});

describe("buildUnsubscribeUrl / verifyUnsubscribeSignature", () => {
  test("a signature built for one userId+category verifies for that exact pair", () => {
    const url = buildUnsubscribeUrl({ baseUrl: "https://app.example.com", userId: "u1", category: "notifyMessages" });
    const parsed = new URL(url);
    const signature = parsed.searchParams.get("s");

    expect(parsed.searchParams.get("u")).toBe("u1");
    expect(parsed.searchParams.get("c")).toBe("notifyMessages");
    expect(verifyUnsubscribeSignature({ userId: "u1", category: "notifyMessages", signature })).toBe(true);
  });

  test("rejects a signature for a different userId", () => {
    const url = buildUnsubscribeUrl({ baseUrl: "https://app.example.com", userId: "u1", category: "notifyMessages" });
    const signature = new URL(url).searchParams.get("s");

    expect(verifyUnsubscribeSignature({ userId: "u2", category: "notifyMessages", signature })).toBe(false);
  });

  test("rejects a signature for a different category", () => {
    const url = buildUnsubscribeUrl({ baseUrl: "https://app.example.com", userId: "u1", category: "notifyMessages" });
    const signature = new URL(url).searchParams.get("s");

    expect(verifyUnsubscribeSignature({ userId: "u1", category: "notifyJobMatch", signature })).toBe(false);
  });

  test("rejects a tampered signature", () => {
    const url = buildUnsubscribeUrl({ baseUrl: "https://app.example.com", userId: "u1", category: "notifyMessages" });
    const signature = new URL(url).searchParams.get("s");
    const tampered = signature.slice(0, -1) + (signature.endsWith("a") ? "b" : "a");

    expect(verifyUnsubscribeSignature({ userId: "u1", category: "notifyMessages", signature: tampered })).toBe(false);
  });

  test("rejects when any part is missing", () => {
    expect(verifyUnsubscribeSignature({ userId: "", category: "notifyMessages", signature: "abc" })).toBe(false);
    expect(verifyUnsubscribeSignature({ userId: "u1", category: "", signature: "abc" })).toBe(false);
    expect(verifyUnsubscribeSignature({ userId: "u1", category: "notifyMessages", signature: "" })).toBe(false);
  });

  test("a different-length signature is rejected without throwing", () => {
    expect(() =>
      verifyUnsubscribeSignature({ userId: "u1", category: "notifyMessages", signature: "short" })
    ).not.toThrow();
    expect(verifyUnsubscribeSignature({ userId: "u1", category: "notifyMessages", signature: "short" })).toBe(false);
  });
});
