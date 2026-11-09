import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { bannerTemplateAPI } from "../services/api";
import { apiErrorMessage } from "../utils/apiErrors";
import { CLASSIC_DEFINITION } from "../utils/bannerStyle";
import AppModal from "./AppModal";
import BannerPreview from "./BannerPreview";
import "../styles/cover.css";

// Superadmin screen for the profile banner templates (COVER_PHOTO_PLAN.md 7.5).
// Modeled on SystemOptionsSettings. Templates are gradient and pattern settings
// only: the server validates every definition, so there is no free CSS here.

const TOKENS = [
  "ds-green-deep",
  "ds-green",
  "ds-green-secondary",
  "ds-mint",
  "ds-gold",
  "ds-gold-deep",
  "ds-ink-900",
  "ds-ink-700",
  "ds-ink-500",
  "ds-ink-300",
  "ds-ink-100",
  "ds-ink-50",
  "ds-bg",
  "ds-surface",
];
const PATTERN_TYPES = ["none", "dots", "rings", "grid", "stripes"];
const FADES = ["none", "left", "right", "center"];
const CUSTOM = "custom";

const emptyDraft = () => ({
  id: null,
  name: "",
  nameFil: "",
  kind: "pattern",
  overlay: "dark",
  angle: CLASSIC_DEFINITION.gradient.angle,
  stops: CLASSIC_DEFINITION.gradient.stops.map((s) => ({ ...s, custom: "" })),
  pattern: { ...CLASSIC_DEFINITION.pattern },
});

const draftFromTemplate = (tpl) => {
  const stops = (tpl.definition?.gradient?.stops || []).map((s) =>
    TOKENS.includes(s.color) ? { color: s.color, at: s.at, custom: "" } : { color: CUSTOM, at: s.at, custom: s.color }
  );
  const pattern = tpl.definition?.pattern;
  const patternIsCustom = pattern && pattern.type !== "none" && !TOKENS.includes(pattern.color);
  return {
    id: tpl.id,
    name: tpl.name,
    nameFil: tpl.nameFil || "",
    kind: tpl.kind,
    overlay: tpl.overlay || "dark",
    angle: tpl.definition?.gradient?.angle ?? 160,
    stops,
    pattern: pattern ? { ...pattern, ...(patternIsCustom ? { colorCustom: pattern.color, color: CUSTOM } : {}) } : { type: "none" },
  };
};

const stopColor = (s) => (s.color === CUSTOM ? s.custom : s.color);

// Draft -> the definition the server validates.
const definitionFromDraft = (draft) => {
  const definition = {
    gradient: {
      angle: Number(draft.angle),
      stops: draft.stops.map((s) => ({ color: stopColor(s), at: Number(s.at) })),
    },
  };
  const p = draft.pattern;
  if (draft.kind === "pattern" && p && p.type !== "none") {
    definition.pattern = {
      type: p.type,
      color: p.color === CUSTOM ? p.colorCustom : p.color,
      mixPercent: Number(p.mixPercent),
      size: Number(p.size),
      opacity: Number(p.opacity),
      fade: p.fade || "none",
    };
  } else if (draft.kind === "pattern") {
    definition.pattern = { type: "none" };
  }
  return definition;
};

export default function BannerTemplatesSettings() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: "", error: false });
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind, template }

  const load = useCallback(() => {
    setLoading(true);
    bannerTemplateAPI
      .adminList()
      .then((res) => setTemplates(Array.isArray(res.data?.templates) ? res.data.templates : []))
      .catch((err) => {
        setTemplates([]);
        setMessage({ text: apiErrorMessage(err, t("bannerTemplates.loadError")), error: true });
      })
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const fail = (err, fallbackKey) => setMessage({ text: apiErrorMessage(err, t(fallbackKey)), error: true });
  const ok = (key) => setMessage({ text: t(key), error: false });

  const setField = (field, value) => setDraft((d) => ({ ...d, [field]: value }));
  const setPattern = (field, value) => setDraft((d) => ({ ...d, pattern: { ...d.pattern, [field]: value } }));
  const setStop = (index, field, value) =>
    setDraft((d) => ({ ...d, stops: d.stops.map((s, i) => (i === index ? { ...s, [field]: value } : s)) }));

  const startNew = () => {
    setMessage({ text: "", error: false });
    setDraft(emptyDraft());
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage({ text: "", error: false });
    const payload = {
      name: draft.name.trim(),
      nameFil: draft.nameFil.trim(),
      kind: draft.kind,
      overlay: draft.overlay,
      definition: definitionFromDraft(draft),
    };
    try {
      if (draft.id) await bannerTemplateAPI.update(draft.id, payload);
      else await bannerTemplateAPI.create(payload);
      setDraft(null);
      ok("bannerTemplates.saved");
      load();
    } catch (err) {
      fail(err, "bannerTemplates.saveError");
    } finally {
      setSaving(false);
    }
  };

  const run = async (template, action, successKey) => {
    setBusyId(template.id);
    setMessage({ text: "", error: false });
    try {
      await action();
      ok(successKey);
      load();
    } catch (err) {
      fail(err, "bannerTemplates.actionError");
    } finally {
      setBusyId(null);
    }
  };

  const move = async (index, delta) => {
    const next = [...templates];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setTemplates(next);
    try {
      await bannerTemplateAPI.reorder(next.map((x) => x.id));
    } catch (err) {
      fail(err, "bannerTemplates.actionError");
      load();
    }
  };

  const confirmAction = async () => {
    const { kind, template } = confirm;
    setConfirm(null);
    if (kind === "archive") await run(template, () => bannerTemplateAPI.setActive(template.id, false), "bannerTemplates.archived");
    if (kind === "default") await run(template, () => bannerTemplateAPI.setDefault(template.id), "bannerTemplates.defaultSet");
    if (kind === "delete") await run(template, () => bannerTemplateAPI.remove(template.id), "bannerTemplates.deleted");
  };

  const previewDefinition = draft ? definitionFromDraft(draft) : null;

  return (
    <section className="sac__card bt" aria-labelledby="banner-templates-title">
      <header className="mwb__head">
        <h2 id="banner-templates-title">{t("bannerTemplates.title")}</h2>
        <p className="mwb__subtitle">{t("bannerTemplates.subtitle")}</p>
        <button type="button" className="sac__primary" onClick={startNew} disabled={Boolean(draft)}>
          {t("bannerTemplates.new")}
        </button>
      </header>

      {message.text ? (
        <p className={`mwb__message ${message.error ? "is-error" : "is-ok"}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}

      {draft ? (
        <form className="bt__form" onSubmit={save}>
          <BannerPreview definition={previewDefinition} height={120} guide />
          <p className="bt__usage">{t("bannerTemplates.form.guide")}</p>

          <div className="bt__grid">
            <label className="bt__field">
              {t("bannerTemplates.form.name")}
              <input value={draft.name} maxLength={60} required onChange={(e) => setField("name", e.target.value)} />
            </label>
            <label className="bt__field">
              {t("bannerTemplates.form.nameFil")}
              <input value={draft.nameFil} maxLength={60} onChange={(e) => setField("nameFil", e.target.value)} />
            </label>
            <label className="bt__field">
              {t("bannerTemplates.form.kind")}
              <select value={draft.kind} onChange={(e) => setField("kind", e.target.value)}>
                <option value="gradient">{t("bannerTemplates.form.kindGradient")}</option>
                <option value="pattern">{t("bannerTemplates.form.kindPattern")}</option>
              </select>
            </label>
            <label className="bt__field">
              {t("bannerTemplates.form.overlay")}
              <select value={draft.overlay} onChange={(e) => setField("overlay", e.target.value)}>
                <option value="dark">{t("bannerTemplates.form.overlayDark")}</option>
                <option value="light">{t("bannerTemplates.form.overlayLight")}</option>
              </select>
            </label>
            <label className="bt__field">
              {t("bannerTemplates.form.angle")}
              <input type="number" min={0} max={360} value={draft.angle} onChange={(e) => setField("angle", e.target.value)} />
            </label>
          </div>

          <fieldset className="bt__stops">
            <legend>{t("bannerTemplates.form.stops")}</legend>
            {draft.stops.map((stop, index) => (
              <div className="bt__stop" key={index}>
                <label className="bt__field">
                  {t("bannerTemplates.form.stopColor")}
                  <select value={stop.color} onChange={(e) => setStop(index, "color", e.target.value)}>
                    {TOKENS.map((token) => (
                      <option key={token} value={token}>
                        {token}
                      </option>
                    ))}
                    <option value={CUSTOM}>{t("bannerTemplates.form.customColor")}</option>
                  </select>
                </label>
                <label className="bt__field">
                  {t("bannerTemplates.form.customColorValue")}
                  <input
                    value={stop.custom}
                    placeholder="#0b704b"
                    pattern="#[0-9a-fA-F]{6}"
                    disabled={stop.color !== CUSTOM}
                    onChange={(e) => setStop(index, "custom", e.target.value)}
                  />
                </label>
                <label className="bt__field">
                  {t("bannerTemplates.form.stopAt")}
                  <input type="number" min={0} max={100} value={stop.at} onChange={(e) => setStop(index, "at", e.target.value)} />
                </label>
                <button
                  type="button"
                  className="sac__ghost"
                  disabled={draft.stops.length <= 2}
                  onClick={() => setDraft((d) => ({ ...d, stops: d.stops.filter((_, i) => i !== index) }))}
                >
                  {t("bannerTemplates.form.removeStop")}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="sac__ghost"
              disabled={draft.stops.length >= 4}
              onClick={() => setDraft((d) => ({ ...d, stops: [...d.stops, { color: "ds-green", at: 100, custom: "" }] }))}
            >
              {t("bannerTemplates.form.addStop")}
            </button>
          </fieldset>

          {draft.kind === "pattern" ? (
            <div className="bt__grid">
              <label className="bt__field">
                {t("bannerTemplates.form.patternType")}
                <select
                  value={draft.pattern.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    setDraft((d) => ({ ...d, pattern: { ...CLASSIC_DEFINITION.pattern, ...d.pattern, type } }));
                  }}
                >
                  {PATTERN_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`bannerTemplates.form.types.${type}`)}
                    </option>
                  ))}
                </select>
              </label>
              {draft.pattern.type !== "none" ? (
                <>
                  <label className="bt__field">
                    {t("bannerTemplates.form.patternColor")}
                    <select value={draft.pattern.color} onChange={(e) => setPattern("color", e.target.value)}>
                      {TOKENS.map((token) => (
                        <option key={token} value={token}>
                          {token}
                        </option>
                      ))}
                      <option value={CUSTOM}>{t("bannerTemplates.form.customColor")}</option>
                    </select>
                  </label>
                  <label className="bt__field">
                    {t("bannerTemplates.form.customColorValue")}
                    <input
                      value={draft.pattern.colorCustom || ""}
                      placeholder="#e6b91e"
                      disabled={draft.pattern.color !== CUSTOM}
                      onChange={(e) => setPattern("colorCustom", e.target.value)}
                    />
                  </label>
                  <label className="bt__field">
                    {t("bannerTemplates.form.patternMix")}
                    <input type="number" min={0} max={100} value={draft.pattern.mixPercent} onChange={(e) => setPattern("mixPercent", e.target.value)} />
                  </label>
                  <label className="bt__field">
                    {t("bannerTemplates.form.patternSize")}
                    <input type="number" min={8} max={80} value={draft.pattern.size} onChange={(e) => setPattern("size", e.target.value)} />
                  </label>
                  <label className="bt__field">
                    {t("bannerTemplates.form.patternOpacity")}
                    <input type="number" min={0} max={1} step={0.05} value={draft.pattern.opacity} onChange={(e) => setPattern("opacity", e.target.value)} />
                  </label>
                  <label className="bt__field">
                    {t("bannerTemplates.form.patternFade")}
                    <select value={draft.pattern.fade || "none"} onChange={(e) => setPattern("fade", e.target.value)}>
                      {FADES.map((fade) => (
                        <option key={fade} value={fade}>
                          {t(`bannerTemplates.form.fades.${fade}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="bt__actions">
            <button type="submit" className="sac__primary" disabled={saving || !draft.name.trim()}>
              {saving ? t("bannerTemplates.form.saving") : t("bannerTemplates.form.save")}
            </button>
            <button type="button" className="sac__ghost" disabled={saving} onClick={() => setDraft(null)}>
              {t("bannerTemplates.form.cancel")}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="loading">{t("bannerTemplates.loading")}</p>
      ) : templates.length === 0 ? (
        <p className="so__empty">{t("bannerTemplates.empty")}</p>
      ) : (
        <ul className="bt__list">
          {templates.map((tpl, index) => (
            <li key={tpl.id} className={`bt__item${tpl.isActive ? "" : " is-archived"}`}>
              <BannerPreview definition={tpl.definition} height={64} />
              <div className="bt__meta">
                <span className="bt__name">{tpl.name}</span>
                {tpl.isDefault ? <span className="bt__badge is-default">{t("bannerTemplates.badge.default")}</span> : null}
                <span className="bt__badge">{tpl.isActive ? t("bannerTemplates.badge.active") : t("bannerTemplates.badge.archived")}</span>
                <span className="bt__usage">{t("bannerTemplates.usedBy", { count: tpl.usage })}</span>
              </div>
              <div className="bt__actions">
                <button type="button" className="sac__ghost" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("bannerTemplates.moveUpFor", { name: tpl.name })}>
                  {t("bannerTemplates.moveUp")}
                </button>
                <button type="button" className="sac__ghost" disabled={index === templates.length - 1} onClick={() => move(index, 1)} aria-label={t("bannerTemplates.moveDownFor", { name: tpl.name })}>
                  {t("bannerTemplates.moveDown")}
                </button>
                <button type="button" className="sac__ghost" disabled={busyId === tpl.id || Boolean(draft)} onClick={() => setDraft(draftFromTemplate(tpl))}>
                  {t("bannerTemplates.edit")}
                </button>
                {tpl.isActive ? (
                  <button
                    type="button"
                    className="sac__ghost"
                    disabled={busyId === tpl.id || tpl.isDefault}
                    onClick={() => (tpl.usage > 0 ? setConfirm({ kind: "archive", template: tpl }) : run(tpl, () => bannerTemplateAPI.setActive(tpl.id, false), "bannerTemplates.archived"))}
                  >
                    {t("bannerTemplates.archive")}
                  </button>
                ) : (
                  <button type="button" className="sac__ghost" disabled={busyId === tpl.id} onClick={() => run(tpl, () => bannerTemplateAPI.setActive(tpl.id, true), "bannerTemplates.activated")}>
                    {t("bannerTemplates.activate")}
                  </button>
                )}
                {tpl.isActive && !tpl.isDefault ? (
                  <button type="button" className="sac__ghost" disabled={busyId === tpl.id} onClick={() => setConfirm({ kind: "default", template: tpl })}>
                    {t("bannerTemplates.setDefault")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="sac__ghost so__delete"
                  disabled={busyId === tpl.id || tpl.isDefault || tpl.usage > 0}
                  title={tpl.usage > 0 ? t("bannerTemplates.deleteBlocked") : undefined}
                  onClick={() => setConfirm({ kind: "delete", template: tpl })}
                >
                  {t("bannerTemplates.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AppModal
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm ? t(`bannerTemplates.confirm.${confirm.kind}Title`) : ""}
        closeLabel={t("bannerTemplates.form.cancel")}
      >
        {confirm ? (
          <div className="bt__confirm">
            <p>{t(`bannerTemplates.confirm.${confirm.kind}Body`, { name: confirm.template.name, count: confirm.template.usage })}</p>
            <div className="bt__actions">
              <button type="button" className="sac__ghost" onClick={() => setConfirm(null)}>
                {t("bannerTemplates.form.cancel")}
              </button>
              <button type="button" className="sac__primary" onClick={confirmAction}>
                {t("bannerTemplates.confirm.ok")}
              </button>
            </div>
          </div>
        ) : null}
      </AppModal>
    </section>
  );
}
