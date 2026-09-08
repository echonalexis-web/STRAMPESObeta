import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaTimes, FaUndo, FaRedo, FaSyncAlt, FaSearchPlus, FaSearchMinus } from "react-icons/fa";
import "../styles/image-editor.css";

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const toRad = (deg) => (deg * Math.PI) / 180;

const ROUND_SIZE = 320;
const RECT_MAX_W = 452;
const RECT_MAX_H = 372;
const MAX_ZOOM = 4;

const ASPECT_PRESETS = [
  { key: "16:9", value: 16 / 9, label: "16 : 9" },
  { key: "4:3", value: 4 / 3, label: "4 : 3" },
  { key: "1:1", value: 1, label: "1 : 1" },
  { key: "3:1", value: 3, label: "3 : 1" },
];

/**
 * Crop / zoom / rotate an image before it is uploaded.
 * The visible stage IS the crop frame — the image is transformed behind it and
 * the same transform chain is replayed onto an output canvas on "Apply".
 */
export default function ImageEditorModal({
  open,
  src,
  fileName = "image.jpg",
  outputType = "image/jpeg",
  title = "Edit image",
  cropShape = "rect", // "round" | "rect"
  aspect = 16 / 9, // used when cropShape === "rect"
  allowAspectPresets = false,
  onCancel,
  onConfirm,
}) {
  const round = cropShape === "round";

  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [activeAspect, setActiveAspect] = useState(round ? 1 : aspect || 16 / 9);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const imgRef = useRef(null);
  const dragRef = useRef(null);

  const frame = useMemo(() => {
    if (round) return { w: ROUND_SIZE, h: ROUND_SIZE };
    let w = RECT_MAX_W;
    let h = w / activeAspect;
    if (h > RECT_MAX_H) {
      h = RECT_MAX_H;
      w = h * activeAspect;
    }
    return { w: Math.round(w), h: Math.round(h) };
  }, [round, activeAspect]);

  // Reset every time the modal opens with a (possibly new) image.
  useEffect(() => {
    if (!open) return;
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setError("");
    setActiveAspect(round ? 1 : aspect || 16 / 9);
  }, [open, src, round, aspect]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onCancel?.();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onCancel]);

  const rad = toRad(rotation);
  const rotW = natural.w * Math.abs(Math.cos(rad)) + natural.h * Math.abs(Math.sin(rad));
  const rotH = natural.w * Math.abs(Math.sin(rad)) + natural.h * Math.abs(Math.cos(rad));

  const baseScale = useMemo(() => {
    if (!natural.w || !rotW || !rotH) return 1;
    return Math.max(frame.w / rotW, frame.h / rotH);
  }, [natural.w, rotW, rotH, frame.w, frame.h]);

  const effScale = baseScale * zoom;

  const clampOffset = useCallback(
    (o) => {
      const maxX = Math.max(0, (effScale * rotW - frame.w) / 2);
      const maxY = Math.max(0, (effScale * rotH - frame.h) / 2);
      return { x: clamp(o.x, -maxX, maxX), y: clamp(o.y, -maxY, maxY) };
    },
    [effScale, rotW, rotH, frame.w, frame.h],
  );

  useEffect(() => {
    setOffset((o) => clampOffset(o));
  }, [clampOffset]);

  const onImgLoad = (e) => {
    setNatural({ w: e.target.naturalWidth || 1, h: e.target.naturalHeight || 1 });
  };

  const onPointerDown = (e) => {
    dragRef.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.px;
    const dy = e.clientY - dragRef.current.py;
    setOffset(clampOffset({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onWheel = (e) => {
    e.preventDefault();
    setZoom((z) => clamp(Number((z - e.deltaY * 0.0015).toFixed(3)), 1, MAX_ZOOM));
  };

  const rotateBy = (delta) =>
    setRotation((r) => {
      let next = r + delta;
      if (next > 180) next -= 360;
      if (next < -180) next += 360;
      return next;
    });

  const reset = () => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  };

  const handleApply = async () => {
    if (!imgRef.current || !natural.w) return;
    setBusy(true);
    setError("");
    try {
      const out = round
        ? { w: 512, h: 512 }
        : (() => {
            const up = Math.min(3, 1600 / frame.w);
            return { w: Math.round(frame.w * up), h: Math.round(frame.h * up) };
          })();
      const k = out.w / frame.w;

      const canvas = document.createElement("canvas");
      canvas.width = out.w;
      canvas.height = out.h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.w, out.h);

      ctx.translate(out.w / 2, out.h / 2);
      ctx.translate(offset.x * k, offset.y * k);
      ctx.rotate(rad);
      ctx.scale(effScale * k, effScale * k);
      ctx.drawImage(imgRef.current, -natural.w / 2, -natural.h / 2, natural.w, natural.h);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, 0.92));
      if (!blob) throw new Error("Could not process the image. Try a different file.");

      const ext = outputType === "image/png" ? "png" : "jpg";
      const base = String(fileName).replace(/\.[^.]+$/, "") || "image";
      onConfirm?.(new File([blob], `${base}.${ext}`, { type: outputType }));
    } catch (err) {
      setError(err.message || "Could not process the image.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="ie-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ie-modal">
        <header className="ie-head">
          <h2 className="ie-title">{title}</h2>
          <button type="button" className="ie-close" onClick={onCancel} aria-label="Close">
            <FaTimes aria-hidden="true" />
          </button>
        </header>

        <div className="ie-body">
          <div
            className={`ie-stage${round ? " ie-stage--round" : ""}`}
            style={{ width: frame.w, height: frame.h }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
          >
            <img
              ref={imgRef}
              src={src}
              alt=""
              className="ie-img"
              draggable="false"
              onLoad={onImgLoad}
              style={{
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${effScale || 1})`,
              }}
            />
            <div className={`ie-frame${round ? " ie-frame--round" : ""}`} aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>

        <div className="ie-controls">
          {allowAspectPresets && !round ? (
            <div className="ie-aspects">
              {ASPECT_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`ie-chip${Math.abs(activeAspect - p.value) < 0.001 ? " is-active" : ""}`}
                  onClick={() => setActiveAspect(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : null}

          <label className="ie-slider">
            <span className="ie-slider__ico"><FaSearchMinus aria-hidden="true" /></span>
            <input
              type="range"
              min="1"
              max={MAX_ZOOM}
              step="0.01"
              value={zoom}
              aria-label="Zoom"
              onChange={(e) => setZoom(clamp(Number(e.target.value), 1, MAX_ZOOM))}
            />
            <span className="ie-slider__ico"><FaSearchPlus aria-hidden="true" /></span>
          </label>

          <label className="ie-slider">
            <span className="ie-slider__ico"><FaSyncAlt aria-hidden="true" /></span>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={rotation}
              aria-label="Rotation"
              onChange={(e) => setRotation(Number(e.target.value))}
            />
            <span className="ie-slider__val">{rotation}°</span>
          </label>

          <div className="ie-quick">
            <button type="button" className="ie-quickbtn" onClick={() => rotateBy(-90)}>
              <FaUndo aria-hidden="true" /> 90°
            </button>
            <button type="button" className="ie-quickbtn" onClick={() => rotateBy(90)}>
              <FaRedo aria-hidden="true" /> 90°
            </button>
            <button type="button" className="ie-quickbtn" onClick={reset}>
              Reset
            </button>
          </div>
        </div>

        {error ? <p className="ie-error">{error}</p> : null}

        <footer className="ie-foot">
          <button type="button" className="ie-btn ie-btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="ie-btn ie-btn--primary"
            onClick={handleApply}
            disabled={busy || !natural.w}
          >
            {busy ? "Processing…" : "Apply"}
          </button>
        </footer>
      </div>
    </div>
  );
}
