import test from "node:test";
import assert from "node:assert/strict";
import { createOneShot } from "./oneShot.js";
import { classifyError, createResultStore } from "./resultModalStore.js";
import { hostPathFor } from "./resultModalPaths.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    dump: () => JSON.stringify([...data.entries()]),
  };
}

const httpError = (status) => Object.assign(new Error("x"), { response: { status } });

test("oneShot: concurrent calls for one key run the task once", async () => {
  const once = createOneShot();
  let calls = 0;
  const task = async () => {
    calls += 1;
    return { status: "success" };
  };
  const [a, b] = await Promise.all([once.run("k", task), once.run("k", task)]);
  assert.equal(calls, 1);
  assert.equal(a, b);
});

test("oneShot: a definitive failure stays cached", async () => {
  const once = createOneShot();
  let calls = 0;
  const task = async () => {
    calls += 1;
    return { status: "failure", failureKind: "token", retryable: false };
  };
  await once.run("k", task);
  await once.run("k", task);
  assert.equal(calls, 1);
});

test("oneShot: a retryable failure is forgotten so it can run again", async () => {
  const once = createOneShot();
  let calls = 0;
  const task = async () => {
    calls += 1;
    return { status: "failure", failureKind: "network", retryable: true };
  };
  await once.run("k", task);
  await once.run("k", task);
  assert.equal(calls, 2);
});

test("classifyError: no response, 5xx and 429 are retryable; 4xx is definitive", () => {
  assert.equal(classifyError(new Error("offline")), "network");
  assert.equal(classifyError(httpError(503)), "network");
  assert.equal(classifyError(httpError(429)), "network");
  assert.equal(classifyError(httpError(400)), "token");
  assert.equal(classifyError(httpError(404)), "token");
});

test("store: calling start twice for one link (StrictMode) calls the API once", async () => {
  let calls = 0;
  const store = createResultStore({
    confirmers: { "recovery-email": async () => (calls += 1) },
  });
  const link = { token: "TOKEN-123", email: "a@b.co" };
  const first = store.start("recovery-email", link);
  const second = store.start("recovery-email", link);
  await tick();
  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().status, "success");
});

test("store: a second start after the result arrived does not reset it", async () => {
  const store = createResultStore({ confirmers: { "recovery-email": async () => ({}) } });
  const link = { token: "T", email: "a@b.co" };
  store.start("recovery-email", link);
  await tick();
  store.start("recovery-email", link);
  assert.equal(store.getSnapshot().status, "success");
});

test("store: a 400 is a definitive 'token' failure with no retry and no second call", async () => {
  let calls = 0;
  const store = createResultStore({
    confirmers: {
      "recovery-email": async () => {
        calls += 1;
        throw httpError(400);
      },
    },
  });
  const link = { token: "T", email: "a@b.co" };
  store.start("recovery-email", link);
  await tick();
  store.start("recovery-email", link);
  await tick();
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().failureKind, "token");
  assert.equal(store.canRetry(), false);
});

test("store: a network failure can be retried and the retry calls the API again", async () => {
  let calls = 0;
  const store = createResultStore({
    confirmers: {
      "email-change": async () => {
        calls += 1;
        if (calls === 1) throw httpError(503);
      },
    },
  });
  store.start("email-change", { token: "T", email: "a@b.co" });
  await tick();
  assert.equal(store.getSnapshot().failureKind, "network");
  assert.equal(store.canRetry(), true);
  store.retry();
  assert.equal(store.getSnapshot().status, "loading");
  await tick();
  assert.equal(calls, 2);
  assert.equal(store.getSnapshot().status, "success");
});

test("store: missing token or email goes straight to 'invalid' without an API call", () => {
  let calls = 0;
  const store = createResultStore({
    confirmers: { "recovery-email": async () => (calls += 1) },
  });
  store.start("recovery-email", { token: "", email: "a@b.co" });
  assert.equal(calls, 0);
  assert.equal(store.getSnapshot().failureKind, "invalid");
});

test("store: the token is never written to storage or exposed in state", async () => {
  const storage = memoryStorage();
  const store = createResultStore({
    storage,
    confirmers: { "recovery-email": async () => ({}) },
  });
  store.start("recovery-email", { token: "SECRET-TOKEN-VALUE", email: "a@b.co" });
  await tick();
  assert.ok(!storage.dump().includes("SECRET-TOKEN-VALUE"));
  assert.ok(!JSON.stringify(store.getSnapshot()).includes("SECRET-TOKEN-VALUE"));
});

test("store: a reload while loading or after a network failure falls back to 'token'", () => {
  for (const saved of [
    { id: "1", kind: "recovery-email", email: "a@b.co", status: "loading" },
    { id: "2", kind: "recovery-email", email: "a@b.co", status: "failure", failureKind: "network" },
  ]) {
    const storage = memoryStorage();
    storage.setItem("resultModal.active", JSON.stringify(saved));
    const store = createResultStore({ confirmers: {}, storage });
    assert.equal(store.getSnapshot().status, "failure");
    assert.equal(store.getSnapshot().failureKind, "token");
    assert.equal(store.canRetry(), false);
  }
});

test("store: a saved success survives a reload; dismiss clears it", () => {
  const storage = memoryStorage();
  storage.setItem(
    "resultModal.active",
    JSON.stringify({ id: "1", kind: "email-verification", email: "a@b.co", status: "success" })
  );
  const store = createResultStore({ confirmers: {}, storage });
  assert.equal(store.getSnapshot().status, "success");
  store.dismiss();
  assert.equal(store.getSnapshot(), null);
  assert.equal(storage.getItem("resultModal.active"), null);
});

test("store: corrupt or unknown saved data is ignored", () => {
  for (const raw of ["{not json", JSON.stringify({ id: "1", kind: "nope" }), "null"]) {
    const storage = memoryStorage();
    storage.setItem("resultModal.active", raw);
    assert.equal(createResultStore({ confirmers: {}, storage }).getSnapshot(), null);
  }
});

test("hostPathFor: the page behind the modal per kind and session", () => {
  assert.equal(hostPathFor("recovery-email", "success", true), "/settings");
  assert.equal(hostPathFor("recovery-email", "failure", true), "/settings");
  assert.equal(hostPathFor("recovery-email", "success", false), "/login");
  assert.equal(hostPathFor("email-change", "loading", true), "/profile/edit");
  assert.equal(hostPathFor("email-change", "failure", true), "/profile/edit");
  assert.equal(hostPathFor("email-change", "failure", false), "/login");
  assert.equal(hostPathFor("email-change", "success", true), "/login");
  assert.equal(hostPathFor("email-verification", "success", false), "/login");
  assert.equal(hostPathFor("email-verification", "failure", true), "/login");
});
