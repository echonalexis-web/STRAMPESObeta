import { useRef, useState } from "react";
import PropTypes from "prop-types";
import { FaCloudUploadAlt } from "react-icons/fa";
import { useToast } from "./feedback/context";

const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const formatSize = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Self-contained drag-and-drop / click-to-browse file picker. Validates type
 * and size client-side, then hands the file to `onUpload` and renders that
 * upload's own progress bar until it resolves or rejects.
 */
export default function DocumentDropzone({
  accept = ".pdf,.doc,.docx",
  maxSizeBytes = 5 * 1024 * 1024,
  onUpload,
  label = "Browse Files",
  variant = "empty",
  disabled = false,
}) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const busy = disabled || uploading;

  const validate = (file) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Invalid file type. Please upload a PDF, DOC, or DOCX file.");
      return false;
    }
    if (file.size > maxSizeBytes) {
      toast.error(`File is too large (${formatSize(file.size)}). Maximum size is ${formatSize(maxSizeBytes)}.`);
      return false;
    }
    return true;
  };

  const handleFile = async (file) => {
    if (!file || busy) return;
    if (!validate(file)) return;

    setUploading(true);
    setProgress(0);
    try {
      await onUpload(file, setProgress);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const openPicker = () => {
    if (!busy) inputRef.current?.click();
  };

  const handleDrag = (event, active) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setDragActive(active);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (busy) return;
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) handleFile(dropped);
  };

  return (
    <div className={`doc-dropzone doc-dropzone--${variant} ${dragActive ? "is-dragging" : ""} ${busy ? "is-busy" : ""}`}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        className="doc-dropzone-file-input"
        disabled={busy}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (picked) handleFile(picked);
        }}
      />

      <div
        className="doc-dropzone-surface"
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragEnter={(event) => handleDrag(event, true)}
        onDragOver={(event) => handleDrag(event, true)}
        onDragLeave={(event) => handleDrag(event, false)}
        onDrop={handleDrop}
      >
        {uploading ? (
          <div className="doc-dropzone-progress">
            <span className="doc-dropzone-progress-label">Uploading… {progress}%</span>
            <div className="doc-dropzone-progress-track">
              <div className="doc-dropzone-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <>
            <FaCloudUploadAlt className="doc-dropzone-icon" />
            <span className="doc-dropzone-label">{label}</span>
            <span className="doc-dropzone-hint">Drag &amp; drop, or click to browse — PDF, DOC, DOCX up to {formatSize(maxSizeBytes)}</span>
          </>
        )}
      </div>
    </div>
  );
}

DocumentDropzone.propTypes = {
  accept: PropTypes.string,
  maxSizeBytes: PropTypes.number,
  onUpload: PropTypes.func.isRequired,
  label: PropTypes.string,
  variant: PropTypes.oneOf(["empty", "compact"]),
  disabled: PropTypes.bool,
};

