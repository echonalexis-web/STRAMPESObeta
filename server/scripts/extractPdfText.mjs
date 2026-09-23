/**
 * Dumps every text item on a PDF page with its exact position, in PDF point
 * space (origin bottom-left, matching pdf-lib) — used to precisely locate
 * NSRP template field labels instead of visually estimating from a render.
 *
 * Usage: node scripts/extractPdfText.mjs <input.pdf> <pageNum>
 */
import fs from "fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [, , inputPath, pageNumArg] = process.argv;
const pageNum = Number(pageNumArg || 1);

(async () => {
  const data = new Uint8Array(fs.readFileSync(inputPath));
  const doc = await getDocument({ data }).promise;
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const pageHeight = viewport.height;
  const content = await page.getTextContent();

  const items = content.items
    .filter((item) => item.str && item.str.trim())
    .map((item) => {
      // item.transform = [a, b, c, d, e, f] — e,f are the x,y of the text
      // origin in PDF space with y measured from the BOTTOM already (pdfjs
      // text transform is already in PDF user space, bottom-left origin).
      const [, , , , x, y] = item.transform;
      return { text: item.str, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, width: Math.round(item.width * 10) / 10 };
    })
    .sort((a, b) => b.y - a.y || a.x - b.x);

  console.log(`Page height: ${pageHeight}`);
  items.forEach((item) => {
    console.log(`x=${item.x}\ty=${item.y}\tw=${item.width}\t"${item.text}"`);
  });
})();
