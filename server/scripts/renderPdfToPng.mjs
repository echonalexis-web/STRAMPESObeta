/**
 * Renders every page of a PDF to a PNG file, entirely in Node (no poppler/
 * pdftoppm dependency) — used to visually calibrate server/services/
 * nsrpFormFieldMaps.js against the real NSRP template artwork.
 *
 * Usage: node scripts/renderPdfToPng.mjs <input.pdf> <output-dir> [scale]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [, , inputPath, outputDir, scaleArg] = process.argv;
if (!inputPath || !outputDir) {
  console.error("Usage: node scripts/renderPdfToPng.mjs <input.pdf> <output-dir> [scale]");
  process.exit(1);
}

const scale = scaleArg ? Number(scaleArg) : 2;

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const standardFontDataUrl = `${path
    .join(__dirname, "..", "node_modules", "pdfjs-dist", "standard_fonts")
    .split(path.sep)
    .join("/")}/`;

  const data = new Uint8Array(fs.readFileSync(inputPath));
  const doc = await getDocument({
    data,
    canvasFactory: new NodeCanvasFactory(),
    standardFontDataUrl,
  }).promise;

  const baseName = path.basename(inputPath, path.extname(inputPath));

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvasFactory = new NodeCanvasFactory();
    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

    await page.render({
      canvasContext: canvasAndContext.context,
      viewport,
      canvasFactory,
    }).promise;

    const outPath = path.join(outputDir, `${baseName}-page${pageNum}.png`);
    fs.writeFileSync(outPath, canvasAndContext.canvas.toBuffer("image/png"));
    console.log(`Wrote ${outPath} (${viewport.width}x${viewport.height}px @ scale ${scale})`);
  }
})().catch((error) => {
  console.error("Failed to render PDF:", error);
  process.exitCode = 1;
});
