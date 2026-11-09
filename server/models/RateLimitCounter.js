const mongoose = require("mongoose");

// One document per (limiter, key, time bucket). `_id` is the composite key, so
// an upsert-increment is a single atomic operation that works across restarts
// and across server instances. Documents expire on their own (TTL index).
const rateLimitCounterSchema = new mongoose.Schema(
  {
    _id: { type: String },
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

rateLimitCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RateLimitCounter", rateLimitCounterSchema);
