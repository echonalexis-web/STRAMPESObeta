import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaCheck, FaPencilAlt } from "react-icons/fa";
import AppModal from "./AppModal";
import BannerPreview from "./BannerPreview";
import { useToast } from "./feedback/context";
import { authAPI, bannerTemplateAPI } from "../services/api";
import { apiErrorMessage } from "../utils/apiErrors";
import { CLASSIC_DEFINITION } from "../utils/bannerStyle";
import "../styles/cover.css";

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

// Template picker (COVER_PHOTO_PLAN.md 7.3): a radio group of preset banners, a
// live preview, "Use default" and Save. A bottom sheet on phones and a dialog
// from 768px (AppModal). Jobseekers and employers both use it; the server only
// accepts a template id.
export default function CoverPicker({ isOpen, onClose, cover, onSaved }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const groupName = useId();
  const [state, setState] = useState({ status: "loading", templates: [], defaultId: null });
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
    setSelectedId(cover?.kind === "template" ? cover.template?.id || null : null);
    load();
  }, [isOpen, cover, load]);

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

  return (
    <AppModal isOpen={isOpen} onClose={onClose} title={t("cover.pickerTitle")} closeLabel={t("cover.close")} panelClassName="cover-picker">
      <h2 className="cover-picker__title">{t("cover.pickerTitle")}</h2>
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
    </AppModal>
  );
}
