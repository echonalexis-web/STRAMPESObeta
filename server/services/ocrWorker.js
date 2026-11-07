const { isMainThread, parentPort, workerData } = require("worker_threads");

async function recognizeImage(buffer, langPath) {
  await require("fs").promises.access(require("path").join(langPath, "eng.traineddata.gz"));
  const image = await require("sharp")(Buffer.from(buffer), { limitInputPixels: 24000000 })
    .rotate().resize({ width: 2200, withoutEnlargement: true }).grayscale().normalize().png().toBuffer();
  const worker = await require("tesseract.js").createWorker("eng", 1, { langPath, cacheMethod: "none", errorHandler: () => {} });
  try {
    const result = await worker.recognize(image);
    return { text: result.data.text, confidence: Math.max(0, Math.min(1, (result.data.confidence || 0) / 100)) };
  } finally { await worker.terminate(); }
}

if (!isMainThread) {
  recognizeImage(workerData.buffer, workerData.langPath)
    .then((result) => parentPort.postMessage(result))
    .catch(() => parentPort.postMessage({ error: true }));
}
module.exports = { recognizeImage };
