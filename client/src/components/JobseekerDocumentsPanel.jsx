import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PropTypes from "prop-types";
import { FaFileAlt, FaEnvelopeOpenText, FaLock, FaMagic, FaLightbulb } from "react-icons/fa";
import { jobseekerDocumentAPI } from "../services/api";
import DocumentDropzone from "./DocumentDropzone";
import DocumentActionMenu from "./DocumentActionMenu";
import { useToast, useConfirm } from "./feedback/context";

const SECTIONS = [
  { kind: "resume", label: "Resumes", singular: "resume", icon: <FaFileAlt />, showNsrpTip: true },
  { kind: "coverLetter", label: "Cover Letters", singular: "cover letter", icon: <FaEnvelopeOpenText />, showNsrpTip: false },
];

const formatDate = (value) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const formatSize = (bytes) => {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatBadge = (mimeType) => {
  const value = String(mimeType || "");
  if (value.includes("pdf")) return "PDF";
  if (value.includes("wordprocessingml")) return "DOCX";
  if (value.includes("msword")) return "DOC";
  return "FILE";
};

function DocumentCard({ item, onSetPrimary, onDelete, busy = false }) {
  return (
    <article className={`jsd-card ${item.isPrimary ? "jsd-card--primary" : ""}`}>
      <div className="jsd-card-head">
        <span className="jsd-card-title" title={item.title}>{item.title}</span>
        {item.isPrimary && <span className="jsd-primary-badge">Primary</span>}
      </div>

      <div className="jsd-card-meta">
        <span className="jsd-format-badge">{formatBadge(item.mimeType)}</span>
        <span className="jsd-meta-dot" aria-hidden="true">•</span>
        <span>{formatSize(item.sizeBytes)}</span>
        <span className="jsd-meta-dot" aria-hidden="true">•</span>
        <span className={`jsd-source-badge jsd-source-badge--${item.source}`}>
          {item.source === "builder" ? "Built with Studio" : "Uploaded"}
        </span>
      </div>

      <p className="jsd-card-date">Last updated {formatDate(item.updatedAt)}</p>

      <div className="jsd-card-footer">
        <DocumentActionMenu
          storedValue={item.storedValue}
          title={item.title}
          isPrimary={item.isPrimary}
          onSetPrimary={() => onSetPrimary(item)}
          onDelete={() => onDelete(item)}
          disabled={busy}
        />
      </div>
    </article>
  );
}

DocumentCard.propTypes = {
  item: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    storedValue: PropTypes.string.isRequired,
    mimeType: PropTypes.string,
    sizeBytes: PropTypes.number,
    source: PropTypes.oneOf(["upload", "builder"]),
    isPrimary: PropTypes.bool,
    updatedAt: PropTypes.string,
  }).isRequired,
  onSetPrimary: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  busy: PropTypes.bool,
};

function EmptySection({ section, onUpload }) {
  return (
    <div className="jsd-empty-card">
      <div className="jsd-empty-icon">{section.icon}</div>
      <h4 className="jsd-empty-title">No {section.label.toLowerCase()} saved yet</h4>
      <p className="jsd-empty-subtitle">
        Build a job-ready document using our builder or upload an existing PDF/DOCX.
      </p>

      <Link
        to={`/profile/resume?mode=${section.kind}`}
        className="jsd-empty-cta-primary"
      >
        <FaMagic /> Create with Builder
      </Link>

      <div className="jsd-empty-cta-secondary">
        <DocumentDropzone
          variant="empty"
          label="Browse Files"
          onUpload={onUpload}
        />
      </div>

      {section.showNsrpTip && (
        <p className="jsd-nsrp-tip">
          <FaLightbulb /> Pro-Tip: Resumes created using our builder are automatically formatted for DOLE NSRP Form 1 applications.
        </p>
      )}
    </div>
  );
}

EmptySection.propTypes = {
  section: PropTypes.shape({
    kind: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    icon: PropTypes.node.isRequired,
    showNsrpTip: PropTypes.bool.isRequired,
  }).isRequired,
  onUpload: PropTypes.func.isRequired,
};

export default function JobseekerDocumentsPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const loadDocuments = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const { data } = await jobseekerDocumentAPI.list();
      setDocuments(Array.isArray(data) ? data : []);
    } catch (err) {
      setLoadError(err.response?.data?.message || "Failed to load your documents.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  const handleUpload = async (kind, file, onProgress) => {
    await jobseekerDocumentAPI.upload({ file, kind, title: file.name, onProgress });
    toast.success("Document saved.");
    await loadDocuments();
  };

  const handleSetPrimary = async (item) => {
    setBusyId(item._id);
    try {
      await jobseekerDocumentAPI.setPrimary(item._id);
      toast.success(`"${item.title}" set as primary.`);
      await loadDocuments();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update primary document.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item) => {
    const ok = await confirm({
      title: "Delete this document?",
      message: `"${item.title}" will be removed from your library. Applications you already submitted with it are not affected.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;

    setBusyId(item._id);
    try {
      await jobseekerDocumentAPI.remove(item._id);
      await loadDocuments();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete document.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rd-card jsd-panel">
      <div className="jsd-panel-header">
        <h2><FaFileAlt /> Resumes &amp; Cover Letters</h2>
      </div>

      <p className="jsd-privacy-badge">
        <FaLock /> Private — Only visible to employers after you submit an application to their job vacancy.
      </p>

      {loadError && <p className="jsd-load-error">{loadError}</p>}

      {loading ? (
        <p className="rd2-empty">Loading your documents...</p>
      ) : (
        SECTIONS.map((section) => {
          const items = documents.filter((d) => d.kind === section.kind);
          return (
            <div key={section.kind} className="jsd-section">
              <div className="jsd-section-header">
                <h3>{section.icon} {section.label}</h3>
                {items.length > 0 && (
                  <div className="jsd-section-actions">
                    <DocumentDropzone
                      variant="compact"
                      label="Upload New"
                      onUpload={(file, onProgress) => handleUpload(section.kind, file, onProgress)}
                    />
                    <Link
                      to={`/profile/resume?mode=${section.kind}`}
                      className="jsd-new-builder-link"
                    >
                      <FaMagic /> New with Builder
                    </Link>
                  </div>
                )}
              </div>

              {items.length === 0 ? (
                <EmptySection
                  section={section}
                  onUpload={(file, onProgress) => handleUpload(section.kind, file, onProgress)}
                />
              ) : (
                <div className="jsd-grid">
                  {items.map((item) => (
                    <DocumentCard
                      key={item._id}
                      item={item}
                      onSetPrimary={handleSetPrimary}
                      onDelete={handleDelete}
                      busy={busyId === item._id}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
