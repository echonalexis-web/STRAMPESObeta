import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaCheck, FaPencilAlt } from "react-icons/fa";
import AppModal from "./AppModal";
import BannerPreview from "./BannerPreview";
import ImageEditorModal from "./ImageEditorModal";
import { useToast } from "./feedback/context";
import { authAPI, bannerTemplateAPI, employerCoverAPI, resolveAssetUrl } from "../services/api";
import { apiErrorMessage } from "../utils/apiErrors";
import { CLASSIC_DEFINITION } from "../utils/bannerStyle";
import "../styles/cover.css";

// Limits mirrored from the server (services/coverImageService.js); the server
// stays the real gate.
const COVER_MAX_BYTES = 3 * 1024 * 1024;
const COVER_MIN_WIDTH = 1200;
const COVER_MIN_HEIGHT = 300;
const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"];
const COVER_OUTPUT_WIDTH = 1600;

// The "Edit cover" button that sits on the owner's banner (COVER_PHOTO_PLAN.md 7.2).
// Icon-only below 768px (44px tap target), icon plus label from 768px. The
// accessible name is always the full label.
export function CoverEditButton({ onClick }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="rd2-cover-edit" onClick={onClick} aria-label={t("cover.edit")}>
      <FaPencilAlt aria-hidden="true" />
      <span className="rd2-cover-edit-label">{t("cover.edit")}</span>
    </button>
  );
}

const templateName = (tpl, language) => (language?.startsWith("fil") && tpl.nameFil ? tpl.nameFil : tpl.name);

const readImageSize = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });

// Cover picker (COVER_PHOTO_PLAN.md 7.3 and 7.4): a radio group of preset banners
// with a live preview, and for verified employers an "Upload your own" tab that
// crops to 4:1 in the shared image editor, previews at phone and desktop height,
// then uploads. A bottom sheet on phones and a dialog from 768px (AppModal).
// Jobseekers only ever get the templates: the server accepts nothing else.
export default function CoverPicker({ isOpen, onClose, cover, onSaved, isEmployer = false, verified = false, uploadRevoked = false }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const groupName = useId();
  const fileInputRef = useRef(null);
  const [tab, setTab] = useState("templates");
  const [state, setState] = useState({ status: "loading", templates: [], defaultId: null });
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Upload tab
  const [editSrc, setEditSrc] = useState("");
  const editUrlRef = useRef("");
  const [cropped, setCropped] = useState(null); // { file, url }
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: "loading" }));
    bannerTemplateAPI
      .listActive()
      .then((res) => setState({ status: "ready", templates: res.data?.templates || [], defaultId: res.data?.defaultId || null }))
      .catch(() => setState({ status: "error", templates: [], defaultId: null }));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setUploadError("");
    setTab("templates");
    setSelectedId(cover?.kind === "template" ? cover.template?.id || null : null);
    load();
  }, [isOpen, cover, load]);

  const revokeEdit = () => {
    if (editUrlRef.current) URL.revokeObjectURL(editUrlRef.current);
    editUrlRef.current = "";
  };
  const clearCropped = useCallback(() => {
    setCropped((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);
  useEffect(
    () => () => {
      if (editUrlRef.current) URL.revokeObjectURL(editUrlRef.current);
    },
    []
  );
  useEffect(() => {
    if (!isOpen) clearCropped();
  }, [isOpen, clearCropped]);

  const canUpload = isEmployer && verified && !uploadRevoked;
  const { status, templates } = state;

  // null means "the default": the default template if one is configured, else the built-in classic.
  const defaultTemplate = templates.find((tpl) => tpl.id === state.defaultId) || null;
  const selected = templates.find((tpl) => tpl.id === selectedId) || null;
  const previewDefinition = (selected || defaultTemplate)?.definition || CLASSIC_DEFINITION;

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await authAPI.setCover(selectedId);
      toast.success(t("cover.saved"));
      onSaved?.(data.cover);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t("cover.saveError")));
    } finally {
      setSaving(false);
    }
  };

  // ---- upload flow ----
  const chooseFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError("");
    if (!COVER_TYPES.includes(file.type)) return setUploadError(t("errors.codes.COVER_IMAGE_TYPE"));
    if (file.size > COVER_MAX_BYTES) return setUploadError(t("errors.codes.COVER_IMAGE_TOO_LARGE"));
    const url = URL.createObjectURL(file);
    try {
      const { width, height } = await readImageSize(url);
      if (width < COVER_MIN_WIDTH || height < COVER_MIN_HEIGHT) {
        URL.revokeObjectURL(url);
        return setUploadError(t("errors.codes.COVER_IMAGE_DIMENSIONS"));
      }
    } catch {
      URL.revokeObjectURL(url);
      return setUploadError(t("errors.codes.COVER_IMAGE_PROCESSING_FAILED"));
    }
    revokeEdit();
    editUrlRef.current = url;
    setEditSrc(url);
    return undefined;
  };

  const closeEditor = () => {
    revokeEdit();
    setEditSrc("");
  };

  const handleCropped = (file) => {
    closeEditor();
    clearCropped();
    setCropped({ file, url: URL.createObjectURL(file) });
  };

  const upload = async () => {
    if (!cropped) return;
    setUploading(true);
    setProgress(0);
    setUploadError("");
    try {
      const { data } = await employerCoverAPI.uploadImage(cropped.file, { aspect: 4 }, setProgress);
      toast.success(t("cover.saved"));
      clearCropped();
      onSaved?.(data.cover);
      onClose();
    } catch (err) {
      setUploadError(apiErrorMessage(err, t("cover.uploadError")));
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async () => {
    setUploading(true);
    setUploadError("");
    try {
      const { data } = await employerCoverAPI.removeImage();
      toast.success(t("cover.removed"));
      onSaved?.(data.cover);
      onClose();
    } catch (err) {
      setUploadError(apiErrorMessage(err, t("cover.removeError")));
    } finally {
      setUploading(false);
    }
  };

  const hasImage = cover?.kind === "image";
  const showTabs = isEmployer;

  return (
    <>
      <AppModal
        isOpen={isOpen && !editSrc}
        onClose={onClose}
        title={t("cover.pickerTitle")}
        closeLabel={t("cover.close")}
        panelClassName="cover-picker"
      >
        <h2 className="cover-picker__title">{t("cover.pickerTitle")}</h2>

        {showTabs ? (
          <div className="cover-picker__tabs" role="tablist" aria-label={t("cover.pickerTitle")}>
            <button type="button" role="tab" aria-selected={tab === "templates"} className={`cover-picker__tab${tab === "templates" ? " is-active" : ""}`} onClick={() => setTab("templates")}>
              {t("cover.tabTemplates")}
            </button>
            <button type="button" role="tab" aria-selected={tab === "upload"} className={`cover-picker__tab${tab === "upload" ? " is-active" : ""}`} onClick={() => setTab("upload")}>
              {t("cover.tabUpload")}
            </button>
          </div>
        ) : null}

        {tab === "templates" ? (
          <>
            <BannerPreview definition={previewDefinition} height={120} className="cover-picker__preview" />

            {status === "loading" ? (
              <div className="cover-picker__grid" aria-busy="true" aria-label={t("cover.loading")}>
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className="cover-picker__skeleton" />
                ))}
              </div>
            ) : null}

            {status === "error" ? (
              <div className="cover-picker__note" role="alert">
                <p>{t("cover.loadError")}</p>
                <button type="button" className="cover-picker__ghost" onClick={load}>
                  {t("cover.retry")}
                </button>
              </div>
            ) : null}

            {status === "ready" && templates.length === 0 ? <p className="cover-picker__note">{t("cover.empty")}</p> : null}

            {status === "ready" && templates.length > 0 ? (
              <div className="cover-picker__grid" role="radiogroup" aria-label={t("cover.groupLabel")}>
                {templates.map((tpl) => {
                  const checked = tpl.id === selectedId || (selectedId === null && tpl.id === state.defaultId);
                  return (
                    <label key={tpl.id} className={`cover-picker__tile${checked ? " is-selected" : ""}`}>
                      <input
                        type="radio"
                        name={groupName}
                        className="cover-picker__radio"
                        checked={checked}
                        onChange={() => setSelectedId(tpl.id === state.defaultId ? null : tpl.id)}
                      />
                      <BannerPreview definition={tpl.definition} height={56} />
                      <span className="cover-picker__name">
                        {templateName(tpl, i18n.language)}
                        {checked ? <FaCheck className="cover-picker__check" aria-label={t("cover.selected")} /> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}

            {error ? (
              <p className="cover-picker__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="cover-picker__actions">
              <button type="button" className="cover-picker__ghost" onClick={() => setSelectedId(null)} disabled={saving || selectedId === null}>
                {t("cover.useDefault")}
              </button>
              <span className="cover-picker__spacer" />
              <button type="button" className="cover-picker__ghost" onClick={onClose} disabled={saving}>
                {t("cover.cancel")}
              </button>
              <button type="button" className="cover-picker__primary" onClick={save} disabled={saving || status === "loading"}>
                {saving ? t("cover.saving") : t("cover.save")}
              </button>
            </div>
          </>
        ) : (
          <div className="cover-upload">
            {!verified ? <p className="cover-picker__note">{t("cover.notVerified")}</p> : null}
            {verified && uploadRevoked ? <p className="cover-picker__note">{t("cover.revoked")}</p> : null}

            {canUpload ? (
              <>
                {hasImage && !cropped ? (
                  <div className="cover-upload__current">
                    <img className="cover-upload__img" src={resolveAssetUrl(cover.image.thumbUrl || cover.image.url)} alt="" />
                    <p>{t("cover.currentImage")}</p>
                  </div>
                ) : null}

                {cropped ? (
                  <div className="cover-upload__previews" aria-label={t("cover.previewLabel")}>
                    <figure className="cover-upload__figure cover-upload__figure--desktop">
                      <img src={cropped.url} alt="" />
                      <figcaption>{t("cover.previewDesktop")}</figcaption>
                    </figure>
                    <figure className="cover-upload__figure cover-upload__figure--mobile">
                      <img src={cropped.url} alt="" />
                      <figcaption>{t("cover.previewMobile")}</figcaption>
                    </figure>
                  </div>
                ) : (
                  <button type="button" className="cover-upload__drop" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    <span>{t("cover.dropTitle")}</span>
                    <small>{t("cover.dropHint")}</small>
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept={COVER_TYPES.join(",")} hidden onChange={chooseFile} />

                {uploading ? <progress className="cover-upload__progress" value={progress} max={100} aria-label={t("cover.uploading")} /> : null}
                {uploadError ? (
                  <p className="cover-picker__error" role="alert">
                    {uploadError}
                  </p>
                ) : null}
                <p className="cover-picker__note">{t("cover.guidelines")}</p>

                <div className="cover-picker__actions">
                  {hasImage ? (
                    <button type="button" className="cover-picker__ghost" onClick={removeImage} disabled={uploading}>
                      {t("cover.removeImage")}
                    </button>
                  ) : null}
                  <span className="cover-picker__spacer" />
                  {cropped ? (
                    <button type="button" className="cover-picker__ghost" onClick={() => { clearCropped(); fileInputRef.current?.click(); }} disabled={uploading}>
                      {t("cover.chooseAnother")}
                    </button>
                  ) : hasImage ? (
                    <button type="button" className="cover-picker__ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {t("cover.replace")}
                    </button>
                  ) : null}
                  <button type="button" className="cover-picker__ghost" onClick={onClose} disabled={uploading}>
                    {t("cover.cancel")}
                  </button>
                  <button type="button" className="cover-picker__primary" onClick={upload} disabled={!cropped || uploading}>
                    {uploading ? t("cover.uploading") : t("cover.upload")}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </AppModal>

      <ImageEditorModal
        open={Boolean(editSrc)}
        src={editSrc}
        cropShape="rect"
        aspect={4}
        outputWidth={COVER_OUTPUT_WIDTH}
        title={t("cover.editorTitle")}
        fileName="cover.jpg"
        onCancel={closeEditor}
        onConfirm={handleCropped}
      />
    </>
  );
}
