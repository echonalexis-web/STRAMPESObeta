import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AppModal from "./AppModal";
import BannerPreview from "./BannerPreview";
import { avatarPresetAPI, bannerTemplateAPI, resolveAssetUrl } from "../services/api";
import { translateErrorCode } from "../utils/apiErrors";
import {
  SNIFF_BYTES,
  checkTemplateDimensions,
  checkTemplateFile,
  errorField,
  formatBytes,
  limitsFor,
  sniffImageType,
  svgDimensions,
} from "../utils/bannerTemplateFile";
import "../styles/profile-templates.css";

// Create or edit one banner template or avatar. It is an uploaded image (SVG or PNG)
// with a name in English and Filipino and an active flag; nothing here designs a
// banner. `kind` is "banner" or "avatar" (different size, ratio, preview and API). The checks mirror the server's (utils/bannerTemplateFile.js) and the
// server answers the same error codes, which are shown next to the field they
// belong to. Mount it only while open: its state starts from `template`.

const readHead = async (file) => new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());

const loadDimensions = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });

// What a template card, the crop previews and the mockup show when no new file is chosen.
function PreviewSurface({ previewSrc, template, emptyLabel }) {
  if (previewSrc) return <img className="btm__img" src={previewSrc} alt="" draggable={false} />;
  if (template?.image?.url) {
    return <img className="btm__img" src={resolveAssetUrl(template.image.url)} alt="" draggable={false} />;
  }
  if (template?.definition) return <BannerPreview template={template} definition={template.definition} height="100%" className="btm__legacy" />;
  return <span className="btm__empty">{emptyLabel}</span>;
}

export default function ProfileTemplateModal({ kind = "banner", template, onClose, onSaved }) {
  const { t } = useTranslation();
  const editing = Boolean(template);
  const limits = limitsFor(kind);
  const isAvatar = kind === "avatar";
  const group = isAvatar ? "avatars" : "banners";
  const api = isAvatar ? avatarPresetAPI : bannerTemplateAPI;
  // A built-in keeps the artwork it shipped with: it can be renamed, not re-imaged.
  const imageLocked = Boolean(template?.isBuiltIn);
  const ids = useId();
  const id = (name) => `${ids}-${name}`;

  const [name, setName] = useState(template?.name || "");
  const [nameFil, setNameFil] = useState(template?.nameFil || "");
  const [isActive, setIsActive] = useState(template ? template.isActive : true);
  const [file, setFile] = useState(null); // { file, sniffed }
  const [previewUrl, setPreviewUrl] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const nameRef = useRef(null);
  const fileInputRef = useRef(null);
  const activeRef = useRef(null);
  const urlRef = useRef("");
  const formRef = useRef(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  const dirty =
    Boolean(file) || name !== (template?.name || "") || nameFil !== (template?.nameFil || "") || isActive !== (template ? template.isActive : true);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [saving, dirty, onClose]);

  const setError = (field, message) => setErrors((prev) => ({ ...prev, [field]: message }));
  const clearError = (field) => setErrors((prev) => (prev[field] ? { ...prev, [field]: "" } : prev));
  const codeMessage = (code, fallback = "") => translateErrorCode(code, fallback || t("bannerTemplates.actionError"));

  // Checks a chosen file and, when it passes, makes it the pending upload.
  const acceptFile = useCallback(
    async (chosen) => {
      if (!chosen) return;
      clearError("image");
      let sniffed;
      try {
        sniffed = sniffImageType(await readHead(chosen));
      } catch {
        setError("image", translateErrorCode(`${limits.codePrefix}PROCESSING_FAILED`));
        return;
      }
      const fileCode = checkTemplateFile(chosen, sniffed, limits);
      if (fileCode) {
        setError("image", codeMessage(fileCode));
        return;
      }

      const url = URL.createObjectURL(chosen);
      let dims = null;
      try {
        if (sniffed === "png") dims = await loadDimensions(url);
        else dims = svgDimensions(await chosen.text());
      } catch {
        URL.revokeObjectURL(url);
        setError("image", codeMessage(`${limits.codePrefix}PROCESSING_FAILED`));
        return;
      }
      const dimCode = checkTemplateDimensions(sniffed, dims, limits);
      if (dimCode) {
        URL.revokeObjectURL(url);
        setError("image", codeMessage(dimCode));
        return;
      }

      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPreviewUrl(url);
      setFile({ file: chosen, sniffed });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, limits]
  );

  const onPick = (event) => {
    const chosen = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again must still fire
    acceptFile(chosen);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (saving) return;
    acceptFile(event.dataTransfer?.files?.[0]);
  };

  const focusField = (field) => {
    const target = { name: nameRef, image: fileInputRef, active: activeRef }[field];
    target?.current?.focus();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    const next = {};
    if (!name.trim()) next.name = t("bannerTemplates.form.nameRequired");
    if (!editing && !file) next.image = translateErrorCode(`${limits.codePrefix}REQUIRED`);
    if (Object.keys(next).length) {
      setErrors(next);
      focusField(next.name ? "name" : "image");
      return;
    }
    setErrors({});

    const body = new FormData();
    body.append("name", name.trim());
    body.append("nameFil", nameFil.trim());
    body.append("isActive", String(isActive));
    if (file) body.append("image", file.file);

    setSaving(true);
    setProgress(0);
    try {
      const { data } = editing
        ? await api.update(template.id, body, setProgress)
        : await api.create(body, setProgress);
      onSaved(data, editing ? (file ? "imageReplaced" : "updated") : "created");
    } catch (err) {
      const code = err?.response?.data?.code;
      const field = errorField(code);
      const message = translateErrorCode(code, err?.response?.data?.message || t("bannerTemplates.actionError"));
      setErrors({ [field]: message });
      // The user's input stays as it was; only the first error takes focus.
      requestAnimationFrame(() => (field === "form" ? formRef.current?.focus() : focusField(field)));
    } finally {
      setSaving(false);
    }
  };

  const title = editing ? t(`profileTemplates.${group}.editTitle`) : t(`profileTemplates.${group}.createTitle`);
  const lockedActive = Boolean(template?.isDefault);
  const hasImage = Boolean(file) || Boolean(template?.image?.url);
  const uploading = saving && file;

  return (
    <AppModal
      isOpen
      onClose={requestClose}
      title={title}
      titleId={id("title")}
      className="am--full"
      panelClassName="btm"
      closeLabel={t("bannerTemplates.form.close")}
    >
      <form className="btm__form" onSubmit={submit} noValidate>
        <div className="btm__body">
          <p ref={formRef} tabIndex={-1} className="btm__error btm__error--form" role="alert" hidden={!errors.form}>
            {errors.form}
          </p>

          <div className="btm__layout">
            <div className="btm__col">
              {imageLocked ? (
                <p className="btm__note">{t("profileTemplates.builtins.imageLocked")}</p>
              ) : (
              <div className="btm__field" role="group" aria-labelledby={id("image-label")}>
                <span className="btm__label" id={id("image-label")}>
                  {t(`profileTemplates.${group}.imageLabel`)}
                </span>
                <div
                  className={`btm__drop${dragging ? " is-dragging" : ""}${errors.image ? " has-error" : ""}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
                  }}
                  onDrop={onDrop}
                >
                  <p className="btm__drop-title">{dragging ? t("bannerTemplates.form.dropActive") : t("bannerTemplates.form.dropTitle")}</p>
                  <label className="btm__choose">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="btm__file"
                      accept=".svg,.png,image/svg+xml,image/png"
                      disabled={saving}
                      aria-describedby={`${id("hint")}${errors.image ? ` ${id("image-error")}` : ""}`}
                      aria-invalid={errors.image ? "true" : undefined}
                      onChange={onPick}
                    />
                    <span className="btm__choose-ui">{hasImage ? t("bannerTemplates.form.change") : t("bannerTemplates.form.choose")}</span>
                  </label>
                  <p className="btm__hint" id={id("hint")}>
                    {t(`profileTemplates.${group}.dropHint`, {
                      png: limits.maxBytes / (1024 * 1024),
                      svg: limits.maxSvgBytes / 1024,
                      width: limits.recommended.width,
                      height: limits.recommended.height,
                    })}
                  </p>
                  {file ? (
                    <p className="btm__picked" role="status">
                      {t("bannerTemplates.form.selectedFile", { name: file.file.name, size: formatBytes(file.file.size) })}
                    </p>
                  ) : editing && template.image?.url ? (
                    <p className="btm__picked">{t("bannerTemplates.form.currentImage")}</p>
                  ) : null}
                </div>
                <p className="btm__error" id={id("image-error")} role="alert" hidden={!errors.image}>
                  {errors.image}
                </p>
              </div>
              )}

              {editing && template.legacy && !file ? <p className="btm__note">{t("profileTemplates.banners.legacyNote")}</p> : null}

              <div className="btm__field">
                <label className="btm__label" htmlFor={id("name")}>
                  {t("bannerTemplates.form.name")}
                </label>
                <input
                  ref={nameRef}
                  id={id("name")}
                  name="name"
                  className={`btm__input${errors.name ? " has-error" : ""}`}
                  value={name}
                  maxLength={60}
                  required
                  autoComplete="off"
                  disabled={saving}
                  aria-invalid={errors.name ? "true" : undefined}
                  aria-describedby={errors.name ? id("name-error") : undefined}
                  onChange={(event) => {
                    setName(event.target.value);
                    clearError("name");
                  }}
                />
                <p className="btm__error" id={id("name-error")} role="alert" hidden={!errors.name}>
                  {errors.name}
                </p>
              </div>

              <div className="btm__field">
                <label className="btm__label" htmlFor={id("name-fil")}>
                  {t("bannerTemplates.form.nameFil")}
                </label>
                <input
                  id={id("name-fil")}
                  name="nameFil"
                  className="btm__input"
                  value={nameFil}
                  maxLength={60}
                  autoComplete="off"
                  lang="fil"
                  disabled={saving}
                  onChange={(event) => setNameFil(event.target.value)}
                />
              </div>

              <div className="btm__field">
                <label className={`btm__switch${lockedActive ? " is-locked" : ""}`}>
                  <input
                    ref={activeRef}
                    type="checkbox"
                    role="switch"
                    name="isActive"
                    checked={isActive}
                    disabled={saving || lockedActive}
                    aria-describedby={`${id("active-hint")}${errors.active ? ` ${id("active-error")}` : ""}`}
                    onChange={(event) => {
                      setIsActive(event.target.checked);
                      clearError("active");
                    }}
                  />
                  <span className="btm__switch-ui" aria-hidden="true" />
                  <span className="btm__switch-text">{t("bannerTemplates.form.active")}</span>
                </label>
                <p className="btm__hint" id={id("active-hint")}>
                  {lockedActive ? t("bannerTemplates.form.activeLocked") : t("bannerTemplates.form.activeHint")}
                </p>
                <p className="btm__error" id={id("active-error")} role="alert" hidden={!errors.active}>
                  {errors.active}
                </p>
              </div>
            </div>

            <div className="btm__col btm__col--preview">
              <h4 className="btm__label btm__label--heading">{t("bannerTemplates.form.previewTitle")}</h4>
              {isAvatar ? (
                <div className="btm__avatar-preview">
                  <div className="btm__avatar-big">
                    <PreviewSurface previewSrc={previewUrl} template={template} emptyLabel={t("bannerTemplates.form.noImage")} />
                  </div>
                  <div className="btm__avatar-sizes">
                    {[64, 40, 28].map((size) => (
                      <span key={size} className="btm__avatar-small" style={{ width: size, height: size }}>
                        <PreviewSurface previewSrc={previewUrl} template={template} emptyLabel="" />
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="btm__mock">
                  <div className="btm__mock-head">
                    <div className="btm__mock-banner">
                      <PreviewSurface previewSrc={previewUrl} template={template} emptyLabel={t("bannerTemplates.form.noImage")} />
                      <span className="btm__guide" aria-hidden="true" />
                    </div>
                    <span className="btm__avatar" aria-hidden="true" />
                  </div>
                  <div className="btm__mock-body" aria-hidden="true">
                    <span className="btm__mock-line btm__mock-line--name" />
                    <span className="btm__mock-line" />
                  </div>
                </div>
              )}
              <p className="btm__hint">{t(`profileTemplates.${group}.guide`)}</p>

              {isAvatar ? null : (
                <div className="btm__crops">
                  <figure className="btm__crop">
                    <div className="btm__crop-box btm__crop-box--desktop">
                      <PreviewSurface previewSrc={previewUrl} template={template} emptyLabel="" />
                    </div>
                    <figcaption>{t("bannerTemplates.form.desktop")}</figcaption>
                  </figure>
                  <figure className="btm__crop">
                    <div className="btm__crop-box btm__crop-box--phone">
                      <PreviewSurface previewSrc={previewUrl} template={template} emptyLabel="" />
                    </div>
                    <figcaption>{t("bannerTemplates.form.phone")}</figcaption>
                  </figure>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="btm__footer">
          <div className="btm__progress" role="status" aria-live="polite">
            {saving ? (
              <>
                <span>{uploading && progress < 100 ? t("bannerTemplates.form.uploading", { percent: progress }) : t("bannerTemplates.form.processing")}</span>
                {uploading ? <progress max={100} value={progress} aria-hidden="true" /> : null}
              </>
            ) : null}
          </div>
          {confirmDiscard ? (
            <div className="btm__discard" role="alert">
              <strong>{t("bannerTemplates.form.discardTitle")}</strong>
              <div className="btm__footer-actions">
                <button type="button" className="btm__btn" onClick={() => setConfirmDiscard(false)} autoFocus>
                  {t("bannerTemplates.form.keepEditing")}
                </button>
                <button type="button" className="btm__btn btm__btn--danger" onClick={onClose}>
                  {t("bannerTemplates.form.discard")}
                </button>
              </div>
            </div>
          ) : (
            <div className="btm__footer-actions">
              <button type="button" className="btm__btn" onClick={requestClose} disabled={saving}>
                {t("bannerTemplates.form.cancel")}
              </button>
              <button type="submit" className="btm__btn btm__btn--primary" disabled={saving}>
                {saving ? t("bannerTemplates.form.saving") : editing ? t("bannerTemplates.form.saveChanges") : t(`profileTemplates.${group}.upload`)}
              </button>
            </div>
          )}
        </div>
      </form>
    </AppModal>
  );
}
