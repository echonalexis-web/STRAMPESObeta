// Small helpers shared by the seed CLIs: argument parsing and output paths.
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "output");
const DEFAULT_URI = "mongodb://127.0.0.1:27017/strampeso_seed_dev";

// --flag, --flag value and --flag=value. A flag with no value is `true`.
const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split(/=(.*)/s);
    if (inline !== undefined) out[key] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
      out[key] = argv[i + 1];
      i += 1;
    } else out[key] = true;
  }
  return out;
};

const intFlag = (value, fallback, { min = 1 } = {}) => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`Expected an integer >= ${min}, got "${value}".`);
  return n;
};

const defaultBatch = (now = new Date()) => now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");

// The batch label becomes part of file names, so keep it to safe characters.
const assertSafeBatch = (batch) => {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(batch) || batch.includes("..")) {
    throw new Error("--batch may only contain letters, digits, dot, dash and underscore (max 64).");
  }
  return batch;
};

const manifestPath = (batch) => path.join(OUTPUT_DIR, `manifest-${batch}.json`);
const credentialsPath = (batch) => path.join(OUTPUT_DIR, `credentials-${batch}.csv`);

module.exports = { OUTPUT_DIR, DEFAULT_URI, parseArgs, intFlag, defaultBatch, assertSafeBatch, manifestPath, credentialsPath };
