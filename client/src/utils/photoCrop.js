// Square crop for the resume photo. At zoom 1 the square is the largest one that fits the picture;
// zooming in shrinks it. `offsetX` / `offsetY` run from -1 (as far left / up as the picture allows) to
// 1 (as far right / down), 0 being centred. Everything is clamped, so a crop never leaves the picture.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
export const OUTPUT_SIDE = 800;

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

// The source rectangle {sx, sy, side} to copy from an image of width x height.
export const cropRect = (width, height, zoom = 1, offsetX = 0, offsetY = 0) => {
  const base = Math.min(width, height);
  const side = base / clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const spareX = width - side;
  const spareY = height - side;
  return {
    sx: spareX / 2 + (clamp(offsetX, -1, 1) * spareX) / 2,
    sy: spareY / 2 + (clamp(offsetY, -1, 1) * spareY) / 2,
    side,
  };
};

// Draws the crop into a canvas of `size` pixels (square). Returns false when no 2D context exists.
export const drawCrop = (canvas, image, { zoom, offsetX, offsetY }, size = canvas.width) => {
  const context = canvas.getContext && canvas.getContext("2d");
  if (!context) return false;
  const { sx, sy, side } = cropRect(image.naturalWidth || image.width, image.naturalHeight || image.height, zoom, offsetX, offsetY);
  canvas.width = size;
  canvas.height = size;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  return true;
};
