import { useCallback, useEffect, useId, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { FaFilePdf, FaFileImage, FaCloudUploadAlt } from "react-icons/fa";
import { translateErrorCode } from "../utils/apiErrors";
import { formatFileSize, validateUploadFile, SPES_DOC_LIMITS } from "../utils/spesUploadLimits";
import "../styles/file-upload.css";

// Thumbnail for an image file. The object URL is created and revoked by the ref callback
// itself (React 19 runs its cleanup), so it never leaks and never reads the file into memory.
function FileThumb({ file, className }) {
  const attach = useCallback(
    (img) => {
      if (!img) return undefined;
      const url = URL.createObjectURL(file);
      img.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [file]
  );
  return <img ref={attach} className={className} alt="" loading="lazy" decoding="async" />;
}

FileThumb.propTypes = { file: PropTypes.object.isRequired, className: PropTypes.string };

// One file slot: a titled card with a keyboard-operable, drag-and-drop upload area and
// four states. The parent owns the file and any upload; this component validates the pick
// (type, size, one file) and renders what it is told.
//
//   empty      no `file` and no `existing`: the drop area
//   uploading  `uploading` is true: name, progress bar and a Cancel button
//   uploaded   a file is held (picked or already stored): name once, type icon or thumbnail,
//              size, View, Replace, Remove
//   error      `error` (a server code) or a failed pick: translated message, plus Retry when
//              `onRetry` is given
export default function FileUpload({
  label,
  required = false,
  hint,
  limits = SPES_DOC_LIMITS,
  file = null,
  existing = null, // { url, name } for a file that is already stored (e.g. a current cover)
  uploading = false,
  progress = 0,
  error = "",
  disabled = false,
  showBadge = true,
  fileStateLabel,
  onSelect,
  onRemove,
  onCancel,
  onRetry,
}) {
  const { t } = useTranslation();
  const uid = useId();
  const inputRef = useRef(null);
  const replaceRef = useRef(null);
  const focusAfter = useRef("");
  const [dragActive, setDragActive] = useState(false);
  const [pickError, setPickError] = useState("");
  const [live, setLive] = useState("");

  const hasFile = Boolean(file || existing);
  const name = file?.name || existing?.name || "";
  const isImage = file ? file.type.startsWith("image/") : Boolean(existing?.url);
  const message = pickError || error;
  const messageText = message ? translateErrorCode(message, t("spes.docs.uploadFailed")) : "";
  const percent = Math.max(0, Math.min(100, Math.round(progress)));
  const busy = disabled || uploading;

  const ids = { label: `${uid}-label`, hint: `${uid}-hint`, error: `${uid}-error`, input: `${uid}-input` };
  const describedBy = [hint ? ids.hint : "", messageText ? ids.error : ""].filter(Boolean).join(" ") || undefined;

  // Focus survives the swap between the empty and filled layouts.
  useEffect(() => {
    if (focusAfter.current === "drop") inputRef.current?.focus();
    if (focusAfter.current === "replace") (replaceRef.current || inputRef.current)?.focus();
    focusAfter.current = "";
  }, [hasFile]);

  const accept = (picked) => {
    if (!picked || busy) return;
    const code = validateUploadFile(picked, limits);
    if (code) {
      // A rejected pick leaves everything already chosen untouched.
      setPickError(code);
      setLive(translateErrorCode(code, ""));
      return;
    }
    setPickError("");
    setLive(t("upload.live.added", { name: picked.name }));
    focusAfter.current = hasFile ? "replace" : "";
    onSelect?.(picked);
  };

  const handleInput = (event) => {
    accept(event.target.files?.[0]);
    event.target.value = ""; // picking the same file again must still fire change
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    if (busy) return;
    const dropped = event.dataTransfer?.files;
    if (dropped && dropped.length > 1) {
      setPickError("UPLOAD_ONE_FILE");
      setLive(translateErrorCode("UPLOAD_ONE_FILE", ""));
      return;
    }
    accept(dropped?.[0]);
  };

  const handleDrag = (event, active) => {
    event.preventDefault();
    if (!busy) setDragActive(active);
  };

  const openPicker = () => {
    if (!busy) inputRef.current?.click();
  };

  const preview = () => {
    const url = file ? URL.createObjectURL(file) : existing?.url;
    if (!url) return;
    window.open(url, "_blank", "noopener");
    if (file) window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const remove = () => {
    setPickError("");
    setLive(t("upload.live.removed", { name }));
    focusAfter.current = "drop";
    onRemove?.();
  };

  const cancel = () => {
    setLive(t("upload.live.canceled", { name }));
    onCancel?.();
  };

  const retry = () => {
    setPickError("");
    onRetry?.();
  };

  let state = "empty";
  if (uploading) state = "uploading";
  else if (hasFile && messageText) state = "error";
  else if (hasFile) state = "uploaded";
  else if (messageText) state = "error-empty";

  const sub = uploading
    ? t("upload.uploading", { percent })
    : [file ? formatFileSize(file.size) : "", fileStateLabel].filter(Boolean).join(" · ");

  return (
    <div className={`fu fu--${state}${dragActive ? " is-drag" : ""}${disabled ? " is-disabled" : ""}`}>
      <div className="fu__head">
        <span id={ids.label} className="fu__title">
          {label}
        </span>
        {showBadge ? (
          <span className={`fu__badge${required ? " fu__badge--required" : ""}`}>
            {required ? t("upload.required") : t("upload.optional")}
          </span>
        ) : null}
      </div>

      {/* One real input for every state, so focus is never lost on Remove or Replace. */}
      <input
        ref={inputRef}
        id={ids.input}
        className="fu__input"
        type="file"
        accept={limits.accept}
        disabled={busy}
        aria-labelledby={ids.label}
        aria-describedby={describedBy}
        aria-invalid={messageText ? "true" : undefined}
        onChange={handleInput}
      />

      {!hasFile ? (
        <label
          htmlFor={ids.input}
          className="fu__drop"
          onDragEnter={(e) => handleDrag(e, true)}
          onDragOver={(e) => handleDrag(e, true)}
          onDragLeave={(e) => handleDrag(e, false)}
          onDrop={handleDrop}
        >
          <FaCloudUploadAlt className="fu__drop-icon" aria-hidden="true" />
          <span className="fu__drop-text">
            <strong>{t("upload.choose")}</strong> {t("upload.orDrag")}
          </span>
        </label>
      ) : (
        <div
          className="fu__file"
          onDragOver={(e) => handleDrag(e, true)}
          onDragLeave={(e) => handleDrag(e, false)}
          onDrop={handleDrop}
        >
          {isImage ? (
            file ? (
              <FileThumb file={file} className="fu__thumb" />
            ) : (
              <img className="fu__thumb" src={existing.url} alt="" loading="lazy" decoding="async" />
            )
          ) : (
            <span className="fu__type" aria-hidden="true">
              {file?.type === "application/pdf" ? <FaFilePdf /> : <FaFileImage />}
            </span>
          )}
          <div className="fu__meta">
            <span className="fu__name" title={name}>
              {name}
            </span>
            {sub ? <span className="fu__sub">{sub}</span> : null}
            {uploading ? (
              <div
                className="fu__progress"
                role="progressbar"
                aria-label={t("upload.progressLabel", { name })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span className="fu__progress-bar" style={{ width: `${percent}%` }} />
              </div>
            ) : null}
          </div>
          <div className="fu__actions">
            {uploading ? (
              onCancel ? (
                <button type="button" className="fu__btn" onClick={cancel}>
                  {t("upload.cancel")}
                </button>
              ) : null
            ) : (
              <>
                {file || existing?.url ? (
                  <button type="button" className="fu__btn" onClick={preview}>
                    {t("upload.view")}
                  </button>
                ) : null}
                <button type="button" ref={replaceRef} className="fu__btn" onClick={openPicker} disabled={busy}>
                  {t("upload.replace")}
                </button>
                {onRemove ? (
                  <button type="button" className="fu__btn fu__btn--danger" onClick={remove} disabled={busy}>
                    {t("upload.remove")}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}

      {hint ? (
        <p id={ids.hint} className="fu__hint">
          {hint}
        </p>
      ) : null}

      {messageText ? (
        <div id={ids.error} className="fu__error">
          <span>{messageText}</span>
          {onRetry && hasFile && !pickError ? (
            <button type="button" className="fu__btn" onClick={retry}>
              {t("upload.retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      <span className="ds-sr-only" role="status" aria-live="polite">
        {live}
      </span>
    </div>
  );
}

FileUpload.propTypes = {
  label: PropTypes.string.isRequired,
  required: PropTypes.bool,
  hint: PropTypes.string,
  limits: PropTypes.shape({
    maxBytes: PropTypes.number,
    mimes: PropTypes.arrayOf(PropTypes.string),
    accept: PropTypes.string,
    typeError: PropTypes.string,
    sizeError: PropTypes.string,
  }),
  file: PropTypes.object,
  existing: PropTypes.shape({ url: PropTypes.string, name: PropTypes.string }),
  uploading: PropTypes.bool,
  progress: PropTypes.number,
  error: PropTypes.string,
  disabled: PropTypes.bool,
  showBadge: PropTypes.bool,
  fileStateLabel: PropTypes.string,
  onSelect: PropTypes.func,
  onRemove: PropTypes.func,
  onCancel: PropTypes.func,
  onRetry: PropTypes.func,
};
