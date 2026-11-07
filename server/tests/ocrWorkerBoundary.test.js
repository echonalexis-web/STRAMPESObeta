jest.mock("worker_threads", () => ({ Worker: jest.fn() }));
const { EventEmitter } = require("events");
const { Worker } = require("worker_threads");
const { extractText } = require("../services/ocrService");
let worker;
beforeEach(() => {
  jest.resetAllMocks(); jest.useFakeTimers(); delete process.env.OCR_ENGINE;
  worker = new EventEmitter(); worker.terminate = jest.fn().mockResolvedValue(); Worker.mockReturnValue(worker);
});
afterEach(() => jest.useRealTimers());
test("successful OCR results terminate the isolated worker", async () => {
  const work = extractText(Buffer.from("id"), "image/png");
  worker.emit("message", { text: "fixture", confidence: .9 });
  await expect(work).resolves.toEqual({ text: "fixture", confidence: .9, engine: "tesseract" });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
test.each(["error", "exit"])("worker %s errors are sanitized", async (event) => {
  const work = extractText(Buffer.from("id"), "image/png");
  const failure = expect(work).rejects.toThrow(/^OCR /);
  worker.emit(event, new Error("sensitive contents")); await failure;
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
test("initialization hangs are bounded as well as recognition hangs", async () => {
  const work = extractText(Buffer.from("id"), "image/png");
  const failure = expect(work).rejects.toThrow("OCR timed out");
  await jest.advanceTimersByTimeAsync(60000); await failure;
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
