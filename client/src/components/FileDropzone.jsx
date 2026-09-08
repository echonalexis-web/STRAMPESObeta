import { useRef, useState } from "react";
import { FaCloudUploadAlt, FaFileAlt, FaTimes, FaSyncAlt } from "react-icons/fa";
import SecureFileLink from "./SecureFileLink";

const formatSize = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const existingFileName = (url) => (url ? url.split("/").pop().split("?")[0] : "");

export default function FileDropzone({
  id,
  label,
  hint,
  accept = ".pdf,.doc,.docx,.jpg,.jpeg,.png",
  file,
  existingUrl,
  onFileSelect,
  onRemove,
  disabled,
}) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);

  const hasFile = Boolean(file || existingUrl);

  const handleDrag = (e, active) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setDragActive(active);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (disabled) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFileSelect(dropped);
  };

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div className="profile-field">
      {label && <label htmlFor={id}>{label}</label>}
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        className="profile-file-input"
        disabled={disabled}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onFileSelect(picked);
          e.target.value = "";
        }}
      />

      {!hasFile ? (
        <div
          className={`dropzone ${dragActive ? "dropzone--active" : ""}`}
          onClick={openPicker}
          onDragEnter={(e) => handleDrag(e, true)}
          onDragOver={(e) => handleDrag(e, true)}
          onDragLeave={(e) => handleDrag(e, false)}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          aria-disabled={disabled}
        >
          <FaCloudUploadAlt className="dropzone-icon" />
          <span className="dropzone-title">Drag &amp; drop a file, or click to browse</span>
          {hint && <span className="dropzone-hint">{hint}</span>}
        </div>
      ) : (
        <div className="dropzone-file-card">
          <FaFileAlt className="dropzone-file-icon" />
          <div className="dropzone-file-info">
            <span className="dropzone-file-name">{file ? file.name : existingFileName(existingUrl)}</span>
            <span className="dropzone-file-meta">
              {file ? formatSize(file.size) : "Uploaded"}
              {!file && existingUrl && (
                <>
                  {" · "}
                  <SecureFileLink value={existingUrl} className="dropzone-file-view">View</SecureFileLink>
                </>
              )}
            </span>
          </div>
          <div className="dropzone-file-actions">
            <button type="button" className="dropzone-action-btn" onClick={openPicker} disabled={disabled} title="Replace file">
              <FaSyncAlt /> Replace
            </button>
            {file && (
              <button type="button" className="dropzone-action-btn dropzone-action-btn--remove" onClick={onRemove} disabled={disabled} title="Remove selected file">
                <FaTimes />
              </button>
            )}
          </div>
        </div>
      )}
      {hasFile && hint && <p className="dropzone-hint dropzone-hint--below">{hint}</p>}
    </div>
  );
}
