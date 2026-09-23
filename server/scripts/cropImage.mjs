import fs from "fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const [, , inputPath, outputPath, x, y, w, h] = process.argv;
(async () => {
  const image = await loadImage(inputPath);
  const canvas = createCanvas(Number(w), Number(h));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, -Number(x), -Number(y));
  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  console.log(`Wrote ${outputPath}`);
})();
