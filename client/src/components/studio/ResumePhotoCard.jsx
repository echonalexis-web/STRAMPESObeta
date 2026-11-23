import { useId, useRef, useState } from "react";
import PropTypes from "prop-types";
import { FaCamera } from "react-icons/fa";

// The "Resume photo" card: upload (button or drag and drop), replace, remove, and a switch for
// whether THIS resume shows it. The photo is the applicant's own upload for resumes; it is not the
// profile photo. ATS resumes never carry a photo, so every control is off there and says why.
export default function ResumePhotoCard({ t, hasPhoto, name, dataUrl, show, onShow, locked, busy, error, onFile, onRemove }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const noteId = useId();
  const errorId = useId();
  const switchLabelId = useId();
  const off = locked || busy;

  const pick = () => inputRef.current?.click();
  const takeFile = (file) => {
    if (file && !off) onFile(file);
  };

  return (
    <div className="stu-photo">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        tabIndex={-1}
        aria-hidden="true"
        data-testid="resume-photo-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          takeFile(file);
        }}
      />

      {hasPhoto ? (
        <>
          <div className="stu-photo__row">
            {dataUrl ? <img className="stu-photo__thumb" src={dataUrl} alt={t("studio.photo.alt")} width="64" height="64" /> : <span className="stu-photo__thumb stu-photo__thumb--empty" aria-hidden="true" />}
            <div className="stu-photo__meta">
              <p className="stu-photo__name">{name}</p>
              <div className="stu-photo__actions">
                <button type="button" className="stu-btn stu-btn--secondary stu-btn--small" onClick={pick} disabled={off} aria-describedby={error ? errorId : noteId}>
                  {busy ? t("studio.photo.uploading") : t("studio.photo.replace")}
                </button>
                <button type="button" className="stu-btn stu-btn--secondary stu-btn--small" onClick={onRemove} disabled={off}>
                  {t("studio.photo.remove")}
                </button>
              </div>
            </div>
          </div>
          <div className="stu-switch-row">
            <span id={switchLabelId}>{t("studio.photo.show")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(show) && !locked}
              aria-labelledby={switchLabelId}
              className={`stu-switch${show && !locked ? " is-on" : ""}`}
              onClick={() => onShow(!show)}
              disabled={locked}
            >
              <span className="stu-switch__text">{show && !locked ? t("studio.photo.on") : t("studio.photo.off")}</span>
              <span className="stu-switch__knob" aria-hidden="true" />
            </button>
          </div>
        </>
      ) : (
        <div
          className={`stu-drop${dragging ? " is-dragging" : ""}${off ? " is-off" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!off) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            takeFile(event.dataTransfer?.files?.[0]);
          }}
        >
          <FaCamera aria-hidden="true" className="stu-drop__icon" />
          <button type="button" className="stu-btn stu-btn--secondary" onClick={pick} disabled={off} aria-describedby={error ? errorId : noteId}>
            {busy ? t("studio.photo.uploading") : t("studio.photo.upload")}
          </button>
          <span className="stu-drop__hint">{t("studio.photo.dropHint")}</span>
        </div>
      )}

      <p className="stu-help" id={noteId}>
        {locked ? t("studio.atsPhoto") : t("studio.photo.note")}
      </p>
      {error ? (
        <p className="stu-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

ResumePhotoCard.propTypes = {
  t: PropTypes.func.isRequired,
  hasPhoto: PropTypes.bool,
  name: PropTypes.string,
  dataUrl: PropTypes.string,
  show: PropTypes.bool,
  onShow: PropTypes.func.isRequired,
  locked: PropTypes.bool,
  busy: PropTypes.bool,
  error: PropTypes.string,
  onFile: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};
