import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PropTypes from "prop-types";
import { FaFileAlt, FaEnvelopeOpenText, FaMagic, FaUpload, FaCheckCircle } from "react-icons/fa";
import AppModal from "./AppModal";
import SecureFileLink from "./SecureFileLink";
import { jobAPI, jobseekerDocumentAPI, displayFileName } from "../services/api";

const NONE = "__none__";

function DocumentPicker({
  label,
  icon,
  required = false,
  documents,
  selection,
  onSelect,
  uploadFile,
  onUploadFile,
  currentFileHint,
}) {
  const inputRef = useRef(null);

  return (
    <div className="apply-modal-picker">
      <div className="apply-modal-picker-label">
        {icon} {label} {required ? <span className="apply-modal-required">(required)</span> : <span className="apply-modal-optional">(optional)</span>}
      </div>

      {documents.length === 0 ? (
        <p className="apply-modal-empty">You haven't saved any {label.toLowerCase()} yet.</p>
      ) : (
        <div className="apply-modal-doc-grid">
          {!required && (
            <button
              type="button"
              className={`apply-modal-doc-card ${selection === NONE ? "is-selected" : ""}`}
              onClick={() => onSelect(NONE)}
            >
              <span className="apply-modal-doc-title">None</span>
            </button>
          )}
          {documents.map((doc) => (
            <button
              key={doc._id}
              type="button"
              className={`apply-modal-doc-card ${selection === doc._id ? "is-selected" : ""}`}
              onClick={() => onSelect(doc._id)}
            >
              {selection === doc._id && <FaCheckCircle className="apply-modal-doc-check" />}
              <span className="apply-modal-doc-title" title={doc.title}>{doc.title}</span>
              <SecureFileLink value={doc.storedValue} className="apply-modal-doc-preview">
                Preview
              </SecureFileLink>
            </button>
          ))}
        </div>
      )}

      <div className="apply-modal-upload-row">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx"
          hidden
          className="apply-modal-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onUploadFile(file);
          }}
        />
        <button type="button" className="apply-modal-upload-btn" onClick={() => inputRef.current?.click()}>
          <FaUpload /> {uploadFile ? `Selected: ${uploadFile.name}` : currentFileHint || "Upload a new file instead"}
        </button>
      </div>
    </div>
  );
}

DocumentPicker.propTypes = {
  label: PropTypes.string.isRequired,
  icon: PropTypes.node.isRequired,
  required: PropTypes.bool,
  documents: PropTypes.arrayOf(
    PropTypes.shape({
      _id: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      storedValue: PropTypes.string.isRequired,
    })
  ).isRequired,
  selection: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  uploadFile: PropTypes.instanceOf(File),
  onUploadFile: PropTypes.func.isRequired,
  currentFileHint: PropTypes.string,
};

export default function ApplyModal({ isOpen, onClose, jobId, editMode = false, existingApplication = null, onSuccess }) {
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [resumes, setResumes] = useState([]);
  const [coverLetters, setCoverLetters] = useState([]);
  const [resumeSelection, setResumeSelection] = useState("");
  const [coverLetterSelection, setCoverLetterSelection] = useState(NONE);
  const [resumeUploadFile, setResumeUploadFile] = useState(null);
  const [coverLetterUploadFile, setCoverLetterUploadFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    let isCurrent = true;

    setError("");
    setResumeUploadFile(null);
    setCoverLetterUploadFile(null);

    const load = async () => {
      setLoadingDocs(true);
      try {
        const { data } = await jobseekerDocumentAPI.list();
        if (!isCurrent) return;
        const all = Array.isArray(data) ? data : [];
        const resumeDocs = all.filter((d) => d.kind === "resume");
        const coverLetterDocs = all.filter((d) => d.kind === "coverLetter");
        setResumes(resumeDocs);
        setCoverLetters(coverLetterDocs);

        const preselectedResume = existingApplication?.resumeDocumentId
          ? resumeDocs.find((d) => d._id === String(existingApplication.resumeDocumentId))
          : null;
        const preselectedCover = existingApplication?.coverLetterDocumentId
          ? coverLetterDocs.find((d) => d._id === String(existingApplication.coverLetterDocumentId))
          : null;

        // Default to the applicant's designated primary document, falling
        // back to the most recently saved one when none is marked primary.
        const defaultResume = resumeDocs.find((d) => d.isPrimary) || resumeDocs[0];
        const defaultCoverLetter = coverLetterDocs.find((d) => d.isPrimary);

        setResumeSelection(preselectedResume ? preselectedResume._id : defaultResume?._id || "");
        setCoverLetterSelection(preselectedCover ? preselectedCover._id : defaultCoverLetter?._id || NONE);
      } catch {
        if (isCurrent) setError("Failed to load your saved documents.");
      } finally {
        if (isCurrent) setLoadingDocs(false);
      }
    };

    load();
    return () => {
      isCurrent = false;
    };
  }, [isOpen, existingApplication]);

  const handleSubmit = async () => {
    setError("");

    const hasResume = Boolean(resumeUploadFile) || (resumeSelection && resumeSelection !== NONE);
    if (!editMode && !hasResume) {
      setError("Please attach a resume before applying.");
      return;
    }

    const formData = new FormData();
    if (resumeUploadFile) {
      formData.append("resume", resumeUploadFile);
    } else if (resumeSelection && resumeSelection !== NONE) {
      formData.append("resumeDocumentId", resumeSelection);
    }

    if (coverLetterUploadFile) {
      formData.append("coverLetterFile", coverLetterUploadFile);
    } else if (coverLetterSelection && coverLetterSelection !== NONE) {
      formData.append("coverLetterDocumentId", coverLetterSelection);
    }

    setSubmitting(true);
    try {
      const { data } = editMode
        ? await jobAPI.updateApplication(existingApplication._id, formData)
        : await jobAPI.applyToJob(jobId, formData);
      onSuccess?.(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to submit application.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppModal isOpen={isOpen} onClose={onClose} title={editMode ? "Update your application" : "Apply for this position"}>
      {loadingDocs ? (
        <p className="apply-modal-loading">Loading your documents…</p>
      ) : (
        <div className="apply-modal-body">
          <DocumentPicker
            label="Resume"
            icon={<FaFileAlt />}
            required
            documents={resumes}
            selection={resumeUploadFile ? "" : resumeSelection}
            onSelect={(id) => {
              setResumeUploadFile(null);
              setResumeSelection(id);
            }}
            uploadFile={resumeUploadFile}
            onUploadFile={(file) => {
              setResumeUploadFile(file);
              setResumeSelection("");
            }}
            currentFileHint={
              editMode && existingApplication?.resume && !existingApplication?.resumeDocumentId
                ? `Keep current: ${displayFileName(existingApplication.resume)}`
                : undefined
            }
          />

          <DocumentPicker
            label="Cover Letter"
            icon={<FaEnvelopeOpenText />}
            documents={coverLetters}
            selection={coverLetterUploadFile ? "" : coverLetterSelection}
            onSelect={(id) => {
              setCoverLetterUploadFile(null);
              setCoverLetterSelection(id);
            }}
            uploadFile={coverLetterUploadFile}
            onUploadFile={(file) => {
              setCoverLetterUploadFile(file);
              setCoverLetterSelection("");
            }}
            currentFileHint={
              editMode && existingApplication?.coverLetterFile && !existingApplication?.coverLetterDocumentId
                ? `Keep current: ${displayFileName(existingApplication.coverLetterFile)}`
                : undefined
            }
          />

          <Link className="apply-modal-builder-link" to="/profile/resume" onClick={onClose}>
            <FaMagic />{" "}
            {resumes.length === 0 && coverLetters.length === 0
              ? "No saved documents yet — open the Resume & Cover Letter Studio"
              : "Need a different version? Open the Resume & Cover Letter Studio"}
          </Link>

          {error && <p className="apply-modal-error">{error}</p>}

          <div className="apply-modal-actions">
            <button type="button" className="apply-modal-cancel" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="button" className="apply-modal-submit" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting…" : editMode ? "Save changes" : "Submit application"}
            </button>
          </div>
        </div>
      )}
    </AppModal>
  );
}

ApplyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  jobId: PropTypes.string,
  editMode: PropTypes.bool,
  existingApplication: PropTypes.shape({
    _id: PropTypes.string,
    resume: PropTypes.string,
    resumeDocumentId: PropTypes.string,
    coverLetterFile: PropTypes.string,
    coverLetterDocumentId: PropTypes.string,
  }),
  onSuccess: PropTypes.func,
};
