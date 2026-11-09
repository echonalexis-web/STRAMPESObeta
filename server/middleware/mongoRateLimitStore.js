const logger = require("../utils/logger");

// express-rate-limit store backed by MongoDB, so counts survive restarts and
// are shared by every server instance. Fixed windows: each key lives in a
// bucket `floor(now / windowMs)`; the bucket id is part of the document _id,
// so no read-modify-write is needed. Fails OPEN (logs and allows) if the
// database call throws: a limiter outage must not take sign-up down, and the
// request itself needs the same database anyway.
class MongoRateLimitStore {
  // `model` is injected so tests can supply a fake; `name` separates limiters.
  constructor({ model, name, now = () => Date.now() }) {
    this.model = model;
    this.name = name;
    this.now = now;
    this.localKeys = false; // shared state: tell express-rate-limit not to double-count-check locally
    this.windowMs = 60 * 1000;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  bucket() {
    return Math.floor(this.now() / this.windowMs);
  }

  docId(key, bucket = this.bucket()) {
    return `${this.name}:${key}:${bucket}`;
  }

  async increment(key) {
    const bucket = this.bucket();
    const resetTime = new Date((bucket + 1) * this.windowMs);
    const run = () =>
      this.model.findOneAndUpdate(
        { _id: this.docId(key, bucket) },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(resetTime.getTime() + this.windowMs) } },
        { upsert: true, new: true }
      );
    try {
      let doc;
      try {
        doc = await run();
      } catch (err) {
        // Two first-hits racing the upsert: the loser gets E11000; retry once.
        if (err && err.code === 11000) doc = await run();
        else throw err;
      }
      return { totalHits: doc.count, resetTime };
    } catch (err) {
      logger.error("Rate limit store increment failed; allowing request", { limiter: this.name, error: err.message });
      return { totalHits: 1, resetTime };
    }
  }

  async decrement(key) {
    try {
      await this.model.updateOne({ _id: this.docId(key), count: { $gt: 0 } }, { $inc: { count: -1 } });
    } catch (err) {
      logger.error("Rate limit store decrement failed", { limiter: this.name, error: err.message });
    }
  }

  async resetKey(key) {
    try {
      await this.model.deleteOne({ _id: this.docId(key) });
    } catch (err) {
      logger.error("Rate limit store reset failed", { limiter: this.name, error: err.message });
    }
  }
}

module.exports = { MongoRateLimitStore };
