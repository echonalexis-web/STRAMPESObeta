const User = require("../models/User");
const ocrService = require("./ocrService");
const { getActiveValues } = require("./systemOptionService");
const { parseIdText } = require("../utils/idOcrParser");
const { logAuditEvent } = require("./auditService");
const logger = require("../utils/logger");

// Bound retained in-memory upload buffers as well as concurrent WASM workers.
const pending = [];
let running = false;
let reserved = 0;
function scheduleIdOcr(job) {
  scheduleOcrTask(() => runIdOcr(job), job.release);
}
function scheduleOcrTask(work, release) {
  pending.push(async () => { try { await work(); } finally { release?.(); } });
  setImmediate(drain);
}

async function runIdOcr({ userId, file, runId, io }) {
  const filter = { _id: userId, "governmentIdOcr.runId": runId, validIdFile: file.storedValue };
  const user = await User.findOneAndUpdate(filter, { $set: { "governmentIdOcr.status": "processing" } }, { new: true });
  if (!user) return; // Upload replaced/removed while this run was waiting.
  let result;
  try {
    const output = await ocrService.extractText(file.buffer, file.mimetype);
    const active = await getActiveValues("governmentIdType");
    const minimum = Number(process.env.OCR_MIN_CONFIDENCE ?? 0.5);
    result = {
      runId, status: output.unsupported ? "unsupported" : "done", engine: output.engine,
      confidence: output.confidence,
      ...parseIdText(output.text, user, active), processedAt: new Date(),
      failureReason: output.unsupported ? "manual_entry_required" : output.confidence < minimum ? "low_confidence" : null,
    };
  } catch {
    // Engine errors can include sensitive text or image contents; persist a code only.
    result = { runId, status: "failed", processedAt: new Date(), failureReason: "processing_failed" };
  }
  const saved = await User.findOneAndUpdate(filter, { $set: { governmentIdOcr: result } }, { new: true });
  await logAuditEvent({ actorId: userId, actorRole: "jobseeker", action: "user.id.ocr_processed", targetType: "user", targetId: String(userId), metadata: { status: result.status, engine: result.engine } });
  if (saved) io?.to(`user:${userId}`).emit("id:ocr:done", { governmentIdOcr: result });
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const work = pending.shift();
      try { await work(); }
      catch { logger.error("Failed to finish ID OCR"); }
    }
  } finally { running = false; }
}

const hasOcrCapacity = () => reserved < 20;
const reserveOcrSlot = (req, res, next) => {
  if (!hasOcrCapacity()) return res.status(503).json({ message: "ID processing is busy. Please try again shortly." });
  reserved++;
  let released = false;
  req.releaseOcrSlot = () => { if (!released) { released = true; reserved--; } };
  res.once("finish", () => { if (!req.ocrScheduled) req.releaseOcrSlot(); });
  res.once("close", () => { if (!req.ocrScheduled) { req.ocrCancelled = true; req.releaseOcrSlot(); } });
  return next();
};
module.exports = { scheduleIdOcr, scheduleOcrTask, runIdOcr, hasOcrCapacity, reserveOcrSlot };
