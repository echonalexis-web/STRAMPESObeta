// Safety guards shared by the seed writer and the cleanup script. Pure functions: they take
// the environment name and a connection string and say whether a write or delete may go ahead.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// Splits a MongoDB connection string without the URL class, which rejects multi-host lists.
// Returns null when the string is not a mongodb:// or mongodb+srv:// URI.
const parseMongoUri = (uri) => {
  const match = /^(mongodb(?:\+srv)?):\/\/(?:([^@/]*)@)?([^/?]+)(?:\/([^?]*))?(?:\?(.*))?$/.exec(String(uri || "").trim());
  if (!match) return null;
  const [, scheme, credentials, hostList, dbRaw] = match;
  const hosts = hostList.split(",").map((entry) => {
    const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(entry);
    if (bracket) return bracket[1].toLowerCase();
    return entry.replace(/:\d+$/, "").toLowerCase();
  });
  const db = decodeURIComponent(dbRaw || "");
  const masked = `${scheme}://${credentials !== undefined ? "***@" : ""}${hostList}/${db}`;
  return { scheme, hosts, db, masked, hasCredentials: credentials !== undefined };
};

const evaluateGuard = ({ nodeEnv, uri } = {}) => {
  const reasons = [];
  const parsed = parseMongoUri(uri);
  if (String(nodeEnv || "").toLowerCase() === "production") reasons.push("NODE_ENV is production.");
  if (!parsed) {
    reasons.push("No valid MongoDB connection string (set SEED_MONGO_URI or pass --mongo-uri).");
    return { ok: false, reasons, target: null };
  }
  const allLocal = parsed.scheme === "mongodb" && parsed.hosts.every((h) => LOCAL_HOSTS.has(h));
  const devName = /_(dev|test)$/.test(parsed.db);
  if (!allLocal && !devName) {
    reasons.push(`Host "${parsed.hosts.join(",")}" is not localhost/127.0.0.1 and database "${parsed.db || "(none)"}" does not end with _dev or _test.`);
  }
  return { ok: reasons.length === 0, reasons, target: { hosts: parsed.hosts, db: parsed.db, masked: parsed.masked } };
};

// A manifest that already exists for this batch blocks a second write unless forced.
const evaluateManifestGuard = ({ manifestExists, forceNewBatch }) =>
  manifestExists && !forceNewBatch
    ? { ok: false, reasons: ["A manifest for this batch already exists. Use a different --batch, or pass --force-new-batch."] }
    : { ok: true, reasons: [] };

module.exports = { parseMongoUri, evaluateGuard, evaluateManifestGuard, LOCAL_HOSTS };
