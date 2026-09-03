import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaImage, FaHeart, FaUpload } from "react-icons/fa";
import { newsAPI } from "../../services/api";
import "../../styles/admin.css";
import "../../styles/newsAdmin.css";
import AdminHeader from "./AdminHeader";

const emptyForm = {
  title: "",
  content: "",
  category: "general",
  imageUrl: "",
};

const CATEGORY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "hiring", label: "Hiring" },
  { value: "training", label: "Training" },
  { value: "event", label: "Event" },
  { value: "advisory", label: "Advisory" },
];

const TITLE_MAX = 180;
const CONTENT_MAX = 4000;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/jpg,image/webp,image/gif";

export default function CreateAnnouncement() {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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
    setImageFile(file);
  };

  const clearImageFile = () => setImageFile(null);

  const titleLen = form.title.trim().length;
  const contentLen = form.content.trim().length;
  const canSubmit = titleLen >= 5 && contentLen >= 20 && !submitting;
  const previewImageSrc = imagePreview || form.imageUrl.trim();

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

      let payload;
      if (imageFile) {
        payload = new FormData();
        payload.append("title", trimmedTitle);
        payload.append("content", trimmedContent);
        payload.append("category", form.category);
        payload.append("image", imageFile);
      } else {
        payload = {
          title: trimmedTitle,
          content: trimmedContent,
          category: form.category,
          imageUrl: form.imageUrl.trim(),
          isActive: true,
        };
      }

      await newsAPI.create(payload);
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
        title="Post Announcement"
        description="Publish an official update to the platform news feed. Employers and jobseekers can read and like it."
      />

      <div className="na-create">
        <div className="na-card na-create__main">
          <button type="button" className="na-backlink" onClick={() => navigate("/admin/news")}>
            <FaArrowLeft aria-hidden="true" /> Back to News Feed
          </button>

          <h2 className="na-card__title">New Announcement</h2>
          <p className="na-card__subtitle">Fields marked with a minimum length must be met before publishing.</p>

          {error ? <div className="na-alert">{error}</div> : null}

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

            <div className="na-form__footer">
              <button type="button" className="na-btn na-btn--ghost" onClick={() => navigate("/admin/news")}>
                Cancel
              </button>
              <button type="submit" className="na-btn na-btn--primary" disabled={!canSubmit}>
                {submitting ? "Publishing…" : "Publish Announcement"}
              </button>
            </div>
          </form>
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
    </div>
  );
}
