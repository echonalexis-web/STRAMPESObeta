import { useEffect, useId, useRef, useState } from "react";
import PropTypes from "prop-types";
import AppModal from "../AppModal";
import { MAX_ZOOM, MIN_ZOOM, OUTPUT_SIDE, drawCrop } from "../../utils/photoCrop";

const PREVIEW = 280;

// Lets the applicant frame the photo before it is uploaded: zoom and move with sliders (so it also
// works from the keyboard). The result is a square JPEG; the server still re-checks and re-crops it.
// If the browser cannot draw it, the original file is used and the server centre-crops it.
export default function PhotoCropModal({ t, file, onCancel, onConfirm }) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const ids = { zoom: useId(), x: useId(), y: useId() };

  // Load the chosen file into an image once.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setReady(true);
    };
    image.src = url;
    return () => {
      image.onload = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Redraw the preview whenever the framing changes.
  useEffect(() => {
    if (ready && canvasRef.current && imageRef.current) {
      drawCrop(canvasRef.current, imageRef.current, { zoom, offsetX, offsetY }, PREVIEW);
    }
  }, [ready, zoom, offsetX, offsetY]);

  const confirm = () => {
    const image = imageRef.current;
    const output = document.createElement("canvas");
    const drawn = image && drawCrop(output, image, { zoom, offsetX, offsetY }, OUTPUT_SIDE);
    if (!drawn || !output.toBlob) {
      onConfirm(file);
      return;
    }
    output.toBlob(
      (blob) => {
        if (!blob) onConfirm(file);
        else onConfirm(new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
    );
  };

  return (
    <AppModal isOpen onClose={onCancel} title={t("studio.crop.title")} titleId="stu-crop-title" describedBy="stu-crop-help">
      <p id="stu-crop-help" className="stu-help">{t("studio.crop.help")}</p>
      <div className="stu-crop">
        <canvas ref={canvasRef} className="stu-crop__canvas" width={PREVIEW} height={PREVIEW} role="img" aria-label={t("studio.crop.preview")} />
        <label className="stu-field" htmlFor={ids.zoom}>
          <span>{t("studio.crop.zoom")}</span>
        </label>
        <input id={ids.zoom} type="range" min={MIN_ZOOM} max={MAX_ZOOM} step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        <label className="stu-field" htmlFor={ids.x}>
          <span>{t("studio.crop.horizontal")}</span>
        </label>
        <input id={ids.x} type="range" min="-1" max="1" step="0.05" value={offsetX} onChange={(e) => setOffsetX(Number(e.target.value))} />
        <label className="stu-field" htmlFor={ids.y}>
          <span>{t("studio.crop.vertical")}</span>
        </label>
        <input id={ids.y} type="range" min="-1" max="1" step="0.05" value={offsetY} onChange={(e) => setOffsetY(Number(e.target.value))} />
      </div>
      <div className="stu-leave__actions">
        <button type="button" className="stu-btn stu-btn--primary" onClick={confirm} aria-disabled={!ready || undefined}>
          {t("studio.crop.use")}
        </button>
        <button type="button" className="stu-btn stu-btn--secondary" onClick={onCancel}>
          {t("studio.crop.cancel")}
        </button>
      </div>
    </AppModal>
  );
}

PhotoCropModal.propTypes = {
  t: PropTypes.func.isRequired,
  file: PropTypes.instanceOf(File).isRequired,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
};
