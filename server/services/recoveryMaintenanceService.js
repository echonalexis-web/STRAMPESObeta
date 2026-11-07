const Request = require("../models/AccountRecoveryRequest");
const storage = require("./storageService");
const logger = require("../utils/logger");
let timer;
let running = false;
async function maintainRecoveryRequests() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    await Request.updateMany({ status: { $in: ["pending", "under_review"] }, expiresAt: { $lte: now } }, { $set: { status: "expired", resolvedAt: now }, $unset: { openAccountKey: 1, contactVerificationHash: 1, contactVerificationExpires: 1 } });
    const stale = await Request.find({ resolvedAt: { $lte: new Date(Date.now() - 90 * 86400000) }, filesDeletedAt: null }).limit(100);
    for (const request of stale) {
      try {
        await Promise.all([storage.remove(request.governmentIdFile, { strict: true }), storage.remove(request.selfieFile, { strict: true })]);
      } catch { logger.error("Recovery proof deletion failed; will retry", { requestId: String(request._id) }); continue; }
      await Request.updateOne({ _id: request._id }, { $set: { filesDeletedAt: now, governmentIdFile: "", selfieFile: "", ocr: { status: "none" } } });
    }
  } finally { running = false; }
}
function startRecoveryMaintenanceWorker() {
  if (timer || process.env.RECOVERY_WORKER_ENABLED === "false") return;
  const tick = () => maintainRecoveryRequests().catch(() => logger.error("Recovery maintenance failed"));
  tick(); timer = setInterval(tick, 3600000); timer.unref();
}
function stopRecoveryMaintenanceWorker() { if (timer) clearInterval(timer); timer = null; }
module.exports = { maintainRecoveryRequests, startRecoveryMaintenanceWorker, stopRecoveryMaintenanceWorker };
