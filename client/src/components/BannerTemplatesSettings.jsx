import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import { bannerTemplateAPI } from "../services/api";
import { apiErrorMessage } from "../utils/apiErrors";
import { matchesFilter, matchesQuery } from "../utils/bannerTemplateFile";
import AppModal from "./AppModal";
import BannerPreview from "./BannerPreview";
import BannerTemplateModal from "./BannerTemplateModal";
import { useToast } from "./feedback/context";
import "../styles/banner-templates.css";

// Superadmin screen for the profile banner templates (COVER_PHOTO_PLAN.md 7.5).
// A template is an image the superadmin uploads (SVG or PNG, rasterized by the
// server); there is no banner builder. Templates made before that (gradient or
// pattern) stay in the list with a Legacy badge and keep rendering for the people
// who chose them. The server validates everything; this screen only mirrors it.

const FILTERS = ["all", "active", "archived"];
const SEARCH_MIN_TEMPLATES = 12;
const SKELETONS = [0, 1, 2, 3, 4, 5];

const primaryName = (tpl) => tpl.name;

export default function BannerTemplatesSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | error | ready
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(null); // { template } (template null = create)
  const [confirm, setConfirm] = useState(null); // { kind, template }
  const [busyId, setBusyId] = useState(null);
  const [announce, setAnnounce] = useState("");

  const load = useCallback(() => {
    setStatus((current) => (current === "ready" ? current : "loading"));
    return bannerTemplateAPI
      .adminList()
      .then((res) => {
        setTemplates(Array.isArray(res.data?.templates) ? res.data.templates : []);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showSearch = templates.length > SEARCH_MIN_TEMPLATES;
  const filtering = filter !== "all" || (showSearch && query.trim() !== "");
  const visible = useMemo(
    () => templates.filter((tpl) => matchesFilter(tpl, filter) && (!showSearch || matchesQuery(tpl, query))),
    [templates, filter, query, showSearch]
  );

  const fail = (err) => toast.error(apiErrorMessage(err, t("bannerTemplates.actionError")));

  const run = async (template, action, successKey) => {
    setBusyId(template.id);
    try {
      await action();
      toast.success(t(successKey));
      setAnnounce(t(successKey));
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  const archive = (tpl) => bannerTemplateAPI.setActive(tpl.id, false);

  const confirmAction = async () => {
    const { kind, template } = confirm;
    setConfirm(null);
    if (kind === "archive") await run(template, () => archive(template), "bannerTemplates.archived");
    if (kind === "default") await run(template, () => bannerTemplateAPI.setDefault(template.id), "bannerTemplates.defaultSet");
    if (kind === "delete") await run(template, () => bannerTemplateAPI.remove(template.id), "bannerTemplates.deleted");
  };

  const move = async (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= templates.length) return;
    const next = [...templates];
    [next[index], next[target]] = [next[target], next[index]];
    setTemplates(next);
    setAnnounce(t("bannerTemplates.moved", { name: primaryName(templates[index]), position: target + 1, total: next.length }));
    try {
      await bannerTemplateAPI.reorder(next.map((tpl) => tpl.id));
    } catch (err) {
      fail(err);
      load();
    }
  };

  const onSaved = (_saved, outcome) => {
    setModal(null);
    toast.success(t(`bannerTemplates.${outcome}`));
    setAnnounce(t(`bannerTemplates.${outcome}`));
    load();
  };

  return (
    <section className="sac__card bt" aria-labelledby="banner-templates-title">
      <header className="bt__head">
        <div className="bt__head-text">
          <h2 id="banner-templates-title">{t("bannerTemplates.title")}</h2>
          <p className="bt__subtitle">{t("bannerTemplates.subtitle")}</p>
        </div>
        <button type="button" className="bt__btn bt__btn--primary bt__upload" onClick={() => setModal({ template: null })}>
          {t("bannerTemplates.upload")}
        </button>
      </header>

      <p className="bt__sr" role="status" aria-live="polite">
        {announce}
      </p>

      {status === "ready" && templates.length > 0 ? (
        <div className="bt__toolbar">
          <div className="bt__filters" role="group" aria-label={t("bannerTemplates.filter.label")}>
            {FILTERS.map((value) => (
              <button key={value} type="button" className="bt__chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {t(`bannerTemplates.filter.${value}`)}
              </button>
            ))}
          </div>
          {showSearch ? (
            <label className="bt__search">
              <span className="bt__sr">{t("bannerTemplates.search.label")}</span>
              <input
                type="search"
                name="templateSearch"
                value={query}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("bannerTemplates.search.placeholder")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {status === "loading" ? (
        <ul className="bt__grid" aria-busy="true" aria-label={t("bannerTemplates.loading")}>
          {SKELETONS.map((n) => (
            <li key={n} className="bt__card bt__card--skeleton" aria-hidden="true">
              <span className="bt__skeleton bt__skeleton--thumb" />
              <span className="bt__skeleton bt__skeleton--line" />
              <span className="bt__skeleton bt__skeleton--line bt__skeleton--short" />
            </li>
          ))}
        </ul>
      ) : null}

      {status === "error" ? (
        <div className="bt__state" role="alert">
          <p>{t("bannerTemplates.loadError")}</p>
          <button type="button" className="bt__btn" onClick={load}>
            {t("bannerTemplates.retry")}
          </button>
        </div>
      ) : null}

      {status === "ready" && templates.length === 0 ? (
        <div className="bt__state">
          <p>{t("bannerTemplates.empty")}</p>
          <button type="button" className="bt__btn bt__btn--primary" onClick={() => setModal({ template: null })}>
            {t("bannerTemplates.upload")}
          </button>
        </div>
      ) : null}

      {status === "ready" && templates.length > 0 && visible.length === 0 ? <p className="bt__state">{t("bannerTemplates.noMatches")}</p> : null}

      {status === "ready" && visible.length > 0 ? (
        <>
          {filtering ? <p className="bt__hint">{t("bannerTemplates.reorderHint")}</p> : null}
          <ul className="bt__grid" aria-label={t("bannerTemplates.list")}>
            {visible.map((tpl) => {
              const index = templates.findIndex((x) => x.id === tpl.id);
              const busy = busyId === tpl.id;
              const secondary = tpl.nameFil && tpl.nameFil !== tpl.name ? tpl.nameFil : "";
              return (
                <li key={tpl.id} className={`bt__card${tpl.isActive ? "" : " is-archived"}`} aria-busy={busy || undefined}>
                  <div className="bt__thumb-wrap">
                    <BannerPreview template={tpl} definition={tpl.definition} height="auto" alt={tpl.name} className="bt__thumb" />
                    {!filtering ? (
                      <div className="bt__order">
                        <button
                          type="button"
                          className="bt__icon-btn"
                          disabled={index === 0 || busy}
                          onClick={() => move(index, -1)}
                          aria-label={t("bannerTemplates.moveUpFor", { name: tpl.name })}
                        >
                          <FaArrowUp aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="bt__icon-btn"
                          disabled={index === templates.length - 1 || busy}
                          onClick={() => move(index, 1)}
                          aria-label={t("bannerTemplates.moveDownFor", { name: tpl.name })}
                        >
                          <FaArrowDown aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="bt__info">
                    <h3 className="bt__name">{tpl.name}</h3>
                    {secondary ? (
                      <p className="bt__name-fil" lang="fil">
                        {secondary}
                      </p>
                    ) : null}
                    <div className="bt__badges">
                      {tpl.isDefault ? <span className="bt__badge bt__badge--default">{t("bannerTemplates.badge.default")}</span> : null}
                      <span className={`bt__badge ${tpl.isActive ? "bt__badge--active" : "bt__badge--archived"}`}>
                        {tpl.isActive ? t("bannerTemplates.badge.active") : t("bannerTemplates.badge.archived")}
                      </span>
                      {tpl.legacy ? <span className="bt__badge bt__badge--legacy">{t("bannerTemplates.badge.legacy")}</span> : null}
                    </div>
                    <p className="bt__usage">{t("bannerTemplates.usage", { count: tpl.usage })}</p>
                    {tpl.legacy ? <p className="bt__hint">{t("bannerTemplates.legacyHint")}</p> : null}
                  </div>

                  <div className="bt__actions">
                    <button type="button" className="bt__btn" disabled={busy} onClick={() => setModal({ template: tpl })} aria-label={t("bannerTemplates.editFor", { name: tpl.name })}>
                      {t("bannerTemplates.edit")}
                    </button>
                    <button type="button" className="bt__btn" disabled={busy} onClick={() => setModal({ template: tpl })} aria-label={t("bannerTemplates.replaceImageFor", { name: tpl.name })}>
                      {t("bannerTemplates.replaceImage")}
                    </button>
                    {tpl.isActive && !tpl.isDefault ? (
                      <button type="button" className="bt__btn" disabled={busy} onClick={() => setConfirm({ kind: "default", template: tpl })}>
                        {t("bannerTemplates.setDefault")}
                      </button>
                    ) : null}
                    {tpl.isActive ? (
                      <button
                        type="button"
                        className="bt__btn"
                        disabled={busy || tpl.isDefault}
                        onClick={() => (tpl.usage > 0 ? setConfirm({ kind: "archive", template: tpl }) : run(tpl, () => archive(tpl), "bannerTemplates.archived"))}
                      >
                        {t("bannerTemplates.archive")}
                      </button>
                    ) : (
                      <button type="button" className="bt__btn" disabled={busy} onClick={() => run(tpl, () => bannerTemplateAPI.setActive(tpl.id, true), "bannerTemplates.activated")}>
                        {t("bannerTemplates.restore")}
                      </button>
                    )}
                    {tpl.usage === 0 && !tpl.isDefault ? (
                      <button type="button" className="bt__btn bt__btn--danger" disabled={busy} onClick={() => setConfirm({ kind: "delete", template: tpl })}>
                        {t("bannerTemplates.delete")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {modal ? <BannerTemplateModal key={modal.template?.id || "new"} template={modal.template} onClose={() => setModal(null)} onSaved={onSaved} /> : null}

      <AppModal
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm ? t(`bannerTemplates.confirm.${confirm.kind}Title`) : ""}
        closeLabel={t("bannerTemplates.form.cancel")}
      >
        {confirm ? (
          <div className="bt__confirm">
            <p>{t(`bannerTemplates.confirm.${confirm.kind}Body`, { name: confirm.template.name, count: confirm.template.usage })}</p>
            <div className="bt__confirm-actions">
              <button type="button" className="bt__btn" onClick={() => setConfirm(null)}>
                {t("bannerTemplates.form.cancel")}
              </button>
              <button type="button" className={`bt__btn ${confirm.kind === "delete" ? "bt__btn--danger-solid" : "bt__btn--primary"}`} onClick={confirmAction}>
                {t("bannerTemplates.confirm.ok")}
              </button>
            </div>
          </div>
        ) : null}
      </AppModal>
    </section>
  );
}
