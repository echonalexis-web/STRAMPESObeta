// Phase 5: only this module knows the OCR engine. Images never leave the
// process or become temporary files. Other document types remain manual.
async function extractText(buffer, mimeType) {
  const engine = process.env.OCR_ENGINE || "tesseract";
  if (engine === "off") return { text: "", confidence: 0, engine, unsupported: true };
  if (engine !== "tesseract") throw new Error("OCR engine is not configured");
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"].includes(mimeType)) {
    return { text: "", confidence: 0, engine, unsupported: true };
  }
  const langPath = process.env.OCR_LANG_PATH || require("@tesseract.js-data/eng").langPath;
  // Bound the entire operation, including decoding and Tesseract initialization
  // (the upstream createWorker promise can hang on language-loading failures).
  const { Worker } = require("worker_threads");
  const worker = new Worker(require("path").join(__dirname, "ocrWorker.js"), { workerData: { buffer, langPath } });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      await worker.terminate().catch(() => {});
      if (error) reject(error); else resolve({ ...result, engine });
    };
    const timeout = setTimeout(() => finish(new Error("OCR timed out")), 60000);
    worker.once("message", (message) => message.error ? finish(new Error("OCR processing failed")) : finish(null, message));
    worker.once("error", () => finish(new Error("OCR processing failed")));
    worker.once("exit", () => { if (!settled) finish(new Error("OCR worker stopped")); });
  });
}

module.exports = { extractText };
