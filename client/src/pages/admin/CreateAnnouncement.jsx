import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FaArrowLeft, FaImage, FaHeart, FaUpload, FaCrop } from "react-icons/fa";
import { newsAPI, resolveAssetUrl } from "../../services/api";
import { useToast } from "../../components/feedback/context";
import ImageEditorModal from "../../components/ImageEditorModal";
import "../../styles/admin.css";
import "../../styles/newsAdmin.css";
import AdminHeader from "./AdminHeader";

const emptySpes = {
  applicationDeadline: "",
  slots: "",
  requirements: "",
  resultsUrl: "",
  resultsSummary: "",
  publishAcceptedList: false,
  exposeScores: false,
};

const emptyForm = {
  title: "",
  content: "",
  category: "general",
  imageUrl: "",
  commentsEnabled: true,
  spes: { ...emptySpes },
};

const CATEGORY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "hiring", label: "Hiring" },
  { value: "training", label: "Training" },
  { value: "event", label: "Event" },
  { value: "advisory", label: "Advisory" },
  { value: "spes", label: "SPES Program" },
];

// Build the `spesConfig` JSON string sent to the API from the form's SPES fields.
const buildSpesConfig = (spes) =>
  JSON.stringify({
    applicationDeadline: spes.applicationDeadline || null,
    slots: spes.slots === "" ? null : Number(spes.slots),
    requirements: String(spes.requirements || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    resultsUrl: spes.resultsUrl || "",
    resultsSummary: spes.resultsSummary || "",
    publishAcceptedList: Boolean(spes.publishAcceptedList),
    exposeScores: Boolean(spes.exposeScores),
  });

const TITLE_MAX = 180;
const CONTENT_MAX = 4000;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/jpg,image/webp,image/gif";

export default function CreateAnnouncement() {
  const navigate = useNavigate();
  const toast = useToast();
  const { id } = useParams();
  const isEditing = Boolean(id);
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [editorSrc, setEditorSrc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(isEditing);
  const [error, setError] = useState("");
  const editorUrlRef = useRef("");

  useEffect(() => {
    if (!isEditing) return undefined;

    let active = true;
    const loadExisting = async () => {
      try {
        setLoading(true);
        const { data } = await newsAPI.getById(id);
        if (!active || !data) return;
        const spesData = data.spes || {};
        setForm({
          title: data.title || "",
          content: data.content || "",
          category: data.category || "general",
          imageUrl: data.imageUrl || "",
          commentsEnabled: data.commentsEnabled !== false,
          spes: {
            applicationDeadline: spesData.applicationDeadline
              ? String(spesData.applicationDeadline).slice(0, 10)
              : "",
            slots: spesData.slots ?? "",
            requirements: Array.isArray(spesData.requirements) ? spesData.requirements.join("\n") : "",
            resultsUrl: spesData.resultsUrl || "",
            resultsSummary: spesData.resultsSummary || "",
            publishAcceptedList: Boolean(spesData.publishAcceptedList),
            exposeScores: Boolean(spesData.exposeScores),
          },
        });
      } catch (err) {
        if (active) setError(err.response?.data?.message || "Failed to load announcement");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadExisting();
    return () => {
      active = false;
    };
  }, [id, isEditing]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview("");
      return undefined;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSpesChange = (field, value) => {
    setForm((prev) => ({ ...prev, spes: { ...prev.spes, [field]: value } }));
  };

  const openEditor = (file) => {
    if (editorUrlRef.current) URL.revokeObjectURL(editorUrlRef.current);
    const url = URL.createObjectURL(file);
    editorUrlRef.current = url;
    setEditorSrc(url);
  };

  const closeEditor = () => {
    if (editorUrlRef.current) {
      URL.revokeObjectURL(editorUrlRef.current);
      editorUrlRef.current = "";
    }
    setEditorSrc("");
  };

  useEffect(() => () => {
    if (editorUrlRef.current) URL.revokeObjectURL(editorUrlRef.current);
  }, []);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!IMAGE_ACCEPT.split(",").includes(file.type)) {
      setError("Unsupported image type. Use PNG, JPG, WEBP or GIF.");
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setError("Image is larger than 5MB. Please choose a smaller file.");
      return;
    }

    setError("");
    setForm((prev) => ({ ...prev, imageUrl: "" }));
    // Animated GIFs can't be redrawn to a canvas without losing the animation.
    if (file.type === "image/gif") {
      setImageFile(file);
      return;
    }
    openEditor(file);
  };

  const handleCropped = (file) => {
    setImageFile(file);
    closeEditor();
  };

  const reCropImage = () => {
    if (imageFile && imageFile.type !== "image/gif") openEditor(imageFile);
  };

  const clearImageFile = () => setImageFile(null);

  const titleLen = form.title.trim().length;
  const contentLen = form.content.trim().length;
  const canSubmit = titleLen >= 5 && contentLen >= 20 && !submitting;
  const previewImageSrc = imagePreview || resolveAssetUrl(form.imageUrl.trim()) || form.imageUrl.trim();

  const previewDate = useMemo(
    () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    [],
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedTitle = form.title.trim();
    const trimmedContent = form.content.trim();

    if (trimmedTitle.length < 5 || trimmedContent.length < 20) {
      setError("Title must be at least 5 characters and content at least 20 characters.");
      return;
    }

    try {
      setSubmitting(true);

      const spesConfig = form.category === "spes" ? buildSpesConfig(form.spes) : null;

      let payload;
      if (imageFile) {
        payload = new FormData();
        payload.append("title", trimmedTitle);
        payload.append("content", trimmedContent);
        payload.append("category", form.category);
        payload.append("commentsEnabled", String(form.commentsEnabled));
        payload.append("image", imageFile);
        if (spesConfig) payload.append("spesConfig", spesConfig);
      } else {
        payload = {
          title: trimmedTitle,
          content: trimmedContent,
          category: form.category,
          imageUrl: form.imageUrl.trim(),
          commentsEnabled: form.commentsEnabled,
          ...(isEditing ? {} : { isActive: true }),
          ...(spesConfig ? { spesConfig } : {}),
        };
      }

      if (isEditing) {
        await newsAPI.update(id, payload);
        toast.success("Announcement updated.");
      } else {
        await newsAPI.create(payload);
        toast.success("Announcement published to the news feed.");
      }
      navigate("/admin/news");
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.errors?.[0] || "Failed to create announcement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-page-container na-scope">
      <AdminHeader
        title={isEditing ? "Edit Announcement" : "Post Announcement"}
        description={
          isEditing
            ? "Update this announcement. Changes are visible immediately to employers and jobseekers."
            : "Publish an official update to the platform news feed. Employers and jobseekers can read and like it."
        }
      />

      <div className="na-create">
        <div className="na-card na-create__main">
          <button type="button" className="na-backlink" onClick={() => navigate("/admin/news")}>
            <FaArrowLeft aria-hidden="true" /> Back to News Feed
          </button>

          <h2 className="na-card__title">{isEditing ? "Edit Announcement" : "New Announcement"}</h2>
          <p className="na-card__subtitle">Fields marked with a minimum length must be met before publishing.</p>

          {error ? <div className="na-alert">{error}</div> : null}

          {loading ? (
            <p className="na-state">Loading announcement…</p>
          ) : (
          <form className="na-form" onSubmit={handleSubmit}>
            <div className="na-field na-field--full">
              <label className="na-field__label" htmlFor="title">
                Title
                <span className={`na-field__counter${titleLen > 0 && titleLen < 5 ? " is-short" : ""}`}>
                  {titleLen < 5 ? `${5 - titleLen} more character${5 - titleLen === 1 ? "" : "s"}` : `${titleLen}/${TITLE_MAX}`}
                </span>
              </label>
              <input
                id="title"
                name="title"
                value={form.title}
                onChange={handleChange}
                placeholder="e.g. PESO Job Fair — March 2026 at Boac Civic Center"
                maxLength={TITLE_MAX}
                required
              />
            </div>

            <div className="na-field">
              <label className="na-field__label" htmlFor="category">Category</label>
              <select id="category" name="category" value={form.category} onChange={handleChange}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {form.category === "spes" && (
              <div className="na-field na-field--full na-spes-config">
                <span className="na-field__label">SPES program details</span>
                <div className="na-spes-grid">
                  <label>
                    Application deadline
                    <input
                      type="date"
                      value={form.spes.applicationDeadline}
                      onChange={(e) => handleSpesChange("applicationDeadline", e.target.value)}
                    />
                  </label>
                  <label>
                    Slots <span className="na-field__hint">optional</span>
                    <input
                      type="number"
                      min="0"
                      value={form.spes.slots}
                      onChange={(e) => handleSpesChange("slots", e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  Document requirements <span className="na-field__hint">one per line</span>
                  <textarea
                    rows={4}
                    value={form.spes.requirements}
                    onChange={(e) => handleSpesChange("requirements", e.target.value)}
                    placeholder={"Barangay clearance\nCertificate of indigency\nSchool ID / enrolment proof"}
                  />
                </label>
                <label>
                  Results summary <span className="na-field__hint">shown to applicants once results are released</span>
                  <textarea
                    rows={3}
                    value={form.spes.resultsSummary}
                    onChange={(e) => handleSpesChange("resultsSummary", e.target.value)}
                  />
                </label>
                <label>
                  External results link (Facebook) <span className="na-field__hint">optional mirror</span>
                  <input
                    type="url"
                    value={form.spes.resultsUrl}
                    onChange={(e) => handleSpesChange("resultsUrl", e.target.value)}
                    placeholder="https://facebook.com/LMDPESOMarinduqueOfficial/…"
                  />
                </label>
                <label className="na-checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.spes.publishAcceptedList}
                    onChange={(e) => handleSpesChange("publishAcceptedList", e.target.checked)}
                  />
                  Publish an accepted-applicants list when results are released
                </label>
                <label className="na-checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.spes.exposeScores}
                    onChange={(e) => handleSpesChange("exposeScores", e.target.checked)}
                  />
                  Let applicants see their own exam / interview scores
                </label>
              </div>
            )}

            <div className="na-field na-field--full">
              <span className="na-field__label">
                Announcement image <span className="na-field__hint">optional</span>
              </span>
              <div className="na-upload">
                {imageFile ? (
                  <div className="na-upload__file">
                    <span className="na-upload__thumb">
                      {imagePreview ? <img src={imagePreview} alt="" /> : <FaImage aria-hidden="true" />}
                    </span>
                    <div className="na-upload__meta">
                      <strong>{imageFile.name}</strong>
                      <span>{(imageFile.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                    {imageFile.type !== "image/gif" ? (
                      <button type="button" className="na-upload__adjust" onClick={reCropImage}>
                        <FaCrop aria-hidden="true" /> Adjust
                      </button>
                    ) : null}
                    <button type="button" className="na-upload__remove" onClick={clearImageFile}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="na-upload__drop">
                      <FaUpload aria-hidden="true" />
                      <span className="na-upload__drop-main">Attach a photo from your device</span>
                      <span className="na-upload__drop-sub">PNG, JPG, WEBP or GIF · up to 5MB</span>
                      <input type="file" accept={IMAGE_ACCEPT} onChange={handleFileChange} hidden />
                    </label>
                    <div className="na-upload__divider"><span>or</span></div>
                    <input
                      id="imageUrl"
                      name="imageUrl"
                      type="url"
                      value={form.imageUrl}
                      onChange={handleChange}
                      placeholder="Paste an image URL (https://…)"
                    />
                  </>
                )}
              </div>
            </div>

            <div className="na-field na-field--full">
              <label className="na-field__label" htmlFor="content">
                Content
                <span className={`na-field__counter${contentLen > 0 && contentLen < 20 ? " is-short" : ""}`}>
                  {contentLen < 20 ? `${20 - contentLen} more character${20 - contentLen === 1 ? "" : "s"}` : `${contentLen}/${CONTENT_MAX}`}
                </span>
              </label>
              <textarea
                id="content"
                name="content"
                value={form.content}
                onChange={handleChange}
                rows={8}
                maxLength={CONTENT_MAX}
                placeholder="Write the full announcement. Use blank lines to separate paragraphs."
                required
              />
            </div>

            <div className="na-field na-field--full na-field--checkbox">
              <label className="na-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.commentsEnabled}
                  onChange={(event) => setForm((prev) => ({ ...prev, commentsEnabled: event.target.checked }))}
                />
                Allow comments on this announcement
              </label>
            </div>

            <div className="na-form__footer">
              <button type="button" className="na-btn na-btn--ghost" onClick={() => navigate("/admin/news")}>
                Cancel
              </button>
              <button type="submit" className="na-btn na-btn--primary" disabled={!canSubmit}>
                {submitting ? "Saving…" : isEditing ? "Save Changes" : "Publish Announcement"}
              </button>
            </div>
          </form>
          )}
        </div>

        <aside className="na-card na-preview">
          <span className="na-preview__eyebrow">Live preview</span>
          <article className="na-preview-card">
            {previewImageSrc ? (
              <div className="na-preview-card__media">
                <img src={previewImageSrc} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              </div>
            ) : (
              <div className="na-preview-card__media na-preview-card__media--empty">
                <FaImage aria-hidden="true" />
              </div>
            )}
            <div className="na-preview-card__body">
              <span className={`na-tag na-tag--${form.category}`}>{form.category}</span>
              <h3 className={`na-preview-card__title${form.title.trim() ? "" : " is-placeholder"}`}>
                {form.title.trim() || "Announcement title appears here"}
              </h3>
              <p className={`na-preview-card__text${form.content.trim() ? "" : " is-placeholder"}`}>
                {form.content.trim() || "The announcement body will show here as jobseekers and employers will see it in the feed."}
              </p>
              <div className="na-preview-card__meta">
                <span>{previewDate} · PESO Admin</span>
                <span className="na-preview-card__like"><FaHeart aria-hidden="true" /> 0</span>
              </div>
            </div>
          </article>
        </aside>
      </div>

      <ImageEditorModal
        open={Boolean(editorSrc)}
        src={editorSrc}
        cropShape="rect"
        aspect={16 / 9}
        allowAspectPresets
        title="Crop announcement image"
        fileName="announcement.jpg"
        onCancel={closeEditor}
        onConfirm={handleCropped}
      />
    </div>
  );
}
