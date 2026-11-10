import { useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaCheck } from "react-icons/fa";
import AppModal from "./AppModal";
import Avatar from "./Avatar";
import { useToast } from "./feedback/context";
import { authAPI, avatarPresetAPI } from "../services/api";
import { apiErrorMessage } from "../utils/apiErrors";
import "../styles/avatar.css";

const presetName = (preset, language) => (language?.startsWith("fil") && preset.nameFil ? preset.nameFil : preset.name);

// A jobseeker picks one of the active preset avatars (a radio group in a modal). Only
// the preset's id is sent; the server accepts nothing else. A chosen preset is shown
// instead of the uploaded photo; "Stop using an avatar" brings the photo (or the
// initial) back. `onSaved(preset | null)` reports the result so the page can update.
export default function AvatarPresetPicker({ isOpen, onClose, current, onSaved }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const groupName = useId();
  const [state, setState] = useState({ status: "loading", presets: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: "loading" }));
    avatarPresetAPI
      .listActive()
      .then((res) => setState({ status: "ready", presets: Array.isArray(res.data?.presets) ? res.data.presets : [] }))
      .catch(() => setState({ status: "error", presets: [] }));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setSelectedId(current?.id || null);
    load();
  }, [isOpen, current, load]);

  const save = async (presetId) => {
    setSaving(true);
    setError("");
    try {
      const { data } = await authAPI.setAvatarPreset(presetId);
      toast.success(t("avatarPreset.saved"));
      onSaved?.(data.avatarPreset || null);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t("avatarPreset.saveError")));
    } finally {
      setSaving(false);
    }
  };

  const { status, presets } = state;

  return (
    <AppModal isOpen={isOpen} onClose={onClose} title={t("avatarPreset.title")} closeLabel={t("avatarPreset.close")}>
      <p className="avp__note">{t("avatarPreset.note")}</p>

      {status === "loading" ? (
        <div className="avp__grid" aria-busy="true" aria-label={t("avatarPreset.loading")}>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <span key={n} className="avp__skeleton" aria-hidden="true" />
          ))}
        </div>
      ) : null}

      {status === "error" ? (
        <div className="avp__state" role="alert">
          <p>{t("avatarPreset.loadError")}</p>
          <button type="button" className="avp__btn" onClick={load}>
            {t("avatarPreset.retry")}
          </button>
        </div>
      ) : null}

      {status === "ready" && presets.length === 0 ? <p className="avp__state">{t("avatarPreset.empty")}</p> : null}

      {status === "ready" && presets.length > 0 ? (
        <div className="avp__grid" role="radiogroup" aria-label={t("avatarPreset.groupLabel")}>
          {presets.map((preset) => {
            const checked = preset.id === selectedId;
            const name = presetName(preset, i18n.language);
            return (
              <label key={preset.id} className={`avp__tile${checked ? " is-selected" : ""}`}>
                <input type="radio" name={groupName} className="avp__radio" checked={checked} onChange={() => setSelectedId(preset.id)} aria-label={name} />
                <Avatar size={64} preset={preset} name={name} />
                <span className="avp__name">
                  {name}
                  {checked ? <FaCheck className="avp__check" aria-label={t("avatarPreset.selected")} /> : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <p className="avp__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="avp__actions">
        {current ? (
          <button type="button" className="avp__btn" disabled={saving} onClick={() => save(null)}>
            {t("avatarPreset.clear")}
          </button>
        ) : null}
        <button type="button" className="avp__btn" disabled={saving} onClick={onClose}>
          {t("avatarPreset.cancel")}
        </button>
        <button type="button" className="avp__btn avp__btn--primary" disabled={saving || !selectedId || selectedId === current?.id} onClick={() => save(selectedId)}>
          {saving ? t("avatarPreset.saving") : t("avatarPreset.save")}
        </button>
      </div>
    </AppModal>
  );
}
