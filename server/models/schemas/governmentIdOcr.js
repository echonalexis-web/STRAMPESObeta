const mongoose = require("mongoose");

// Plan §2.3: machine-read suggestions only. No raw transcription is stored.
module.exports = new mongoose.Schema({
  status: { type: String, enum: ["none", "queued", "processing", "done", "failed", "unsupported"], default: "none" },
  runId: String,
  engine: String,
  confidence: { type: Number, min: 0, max: 1 },
  extracted: { idNumber: String, fullName: String, dateOfBirth: Date, detectedType: String, address: String, expiryDate: Date },
  checks: { numberFormatValid: Boolean, nameMatchScore: Number, dobMatch: Boolean, typeMatchesDeclared: Boolean, expired: Boolean },
  processedAt: Date,
  confirmedAt: Date,
  failureReason: String,
}, { _id: false });
