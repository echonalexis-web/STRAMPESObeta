/**
 * Draws a labeled coordinate grid (in PDF point space, origin bottom-left,
 * matching pdf-lib) on top of a rendered template PNG, so exact field
 * coordinates can be read directly off the image instead of estimated.
 *
 * Usage: node scripts/overlayGrid.mjs <input.png> <output.png> <pageHeightPt> <scale> [stepPt]
 */
import fs from "fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const [, , inputPath, outputPath, pageHeightArg, scaleArg, stepArg] = process.argv;
const pageHeightPt = Number(pageHeightArg);
const scale = Number(scaleArg);
const stepPt = stepArg ? Number(stepArg) : 20;

(async () => {
  const image = await loadImage(inputPath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);

  ctx.strokeStyle = "rgba(255, 0, 0, 0.35)";
  ctx.fillStyle = "red";
  ctx.font = "16px sans-serif";
  ctx.lineWidth = 1;

  // Horizontal lines: constant PDF y -> pixel y = (pageHeightPt - y) * scale
  for (let y = 0; y <= pageHeightPt; y += stepPt) {
    const pixelY = (pageHeightPt - y) * scale;
    ctx.beginPath();
    ctx.moveTo(0, pixelY);
    ctx.lineTo(image.width, pixelY);
    ctx.stroke();
    ctx.fillText(`y=${y}`, 2, pixelY - 2);
  }

  // Vertical lines: constant PDF x -> pixel x = x * scale
  const pageWidthPt = image.width / scale;
  for (let x = 0; x <= pageWidthPt; x += stepPt) {
    const pixelX = x * scale;
    ctx.beginPath();
    ctx.moveTo(pixelX, 0);
    ctx.lineTo(pixelX, image.height);
    ctx.stroke();
    ctx.fillText(`x=${x}`, pixelX + 2, 14);
  }

  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  console.log(`Wrote ${outputPath}`);
})();
