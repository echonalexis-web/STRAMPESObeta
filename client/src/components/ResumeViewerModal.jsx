import { useEffect, useRef } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useSecureFileUrl } from "../hooks/useSecureFileUrl";
import { displayFileName } from "../services/api";
import SecureFileLink from "./SecureFileLink";
import "../styles/resume-viewer-modal.css";

const isPdf = (value) => /\.pdf$/i.test(displayFileName(value) || "");

/**
 * Inline resume preview — PDF only, since that's the one format every
 * browser can render natively with no third-party viewer (resumes are
 * sensitive applicant data, so nothing here should ever be sent to an
 * external preview service). .doc/.docx resumes fall back to download-only.
 *
 * Render this only while it should be visible (e.g. `{value && <ResumeViewerModal .../>}`)
 * rather than toggling an `isOpen` prop — a fresh mount per applicant avoids
 * ever showing a previous applicant's already-resolved URL.
 */
export default function ResumeViewerModal({ value, onClose }) {
  const dialogRef = useRef(null);
  useModalA11y(Boolean(value), onClose, dialogRef);
  const { url, loading, error, resolve } = useSecureFileUrl(value);

  useEffect(() => {
    resolve();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!value) return null;

  const canPreview = isPdf(value);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="resume-viewer-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Resume preview"
      >
        <header className="resume-viewer-header">
          <h3>{displayFileName(value) || "Resume"}</h3>
          <button type="button" className="resume-viewer-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="resume-viewer-body">
          {loading && <p className="resume-viewer-status">Loading resume…</p>}
          {!loading && error && (
            <p className="resume-viewer-status">Couldn't load this resume. Try downloading it instead.</p>
          )}
          {!loading && !error && url && canPreview && (
            <iframe title="Resume preview" src={url} className="resume-viewer-frame" />
          )}
          {!loading && !error && url && !canPreview && (
            <p className="resume-viewer-status">
              Preview isn't available for this file type — download it to view.
            </p>
          )}
        </div>

        <footer className="resume-viewer-footer">
          <SecureFileLink className="resume-viewer-download" value={value}>
            <span>↓</span>
            <span>Download Resume</span>
          </SecureFileLink>
        </footer>
      </div>
    </div>
  );
}
