import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import { avatarPresetAPI, bannerTemplateAPI, resolveAssetUrl } from "../services/api";
import { apiErrorMessage } from "../utils/apiErrors";
import { matchesFilter, matchesQuery } from "../utils/bannerTemplateFile";
import { builtInStatus } from "../utils/builtInTemplates";
import AppModal from "./AppModal";
import BannerPreview from "./BannerPreview";
import { useToast } from "./feedback/context";
import { builtInManifest } from "./builtInLoaders";
import "../styles/profile-templates.css";

// One tab of the "Banner templates & avatars" screen: the banners or the avatars.
// Both tabs share this pattern (filter, search over 12 items, built-in install, a
// responsive grid of cards, delete and archive confirmations); the kind only picks the
// API, the thumbnail shape and the wording. The server validates everything; this only
// mirrors it. Templates made before image uploads (gradient or pattern banners) stay
// listed with a Legacy badge and keep rendering for the people who chose them.

const FILTERS = ["all", "active", "archived"];
const SEARCH_MIN_ITEMS = 12;
const SKELETONS = [0, 1, 2, 3, 4, 5];

const KINDS = {
  banner: { i18n: "banners", api: bannerTemplateAPI, hasDefault: true, round: false },
  avatar: { i18n: "avatars", api: avatarPresetAPI, hasDefault: false, round: true },
};

export default function ProfileTemplatesTab({ kind, items, status, onChange, onReload, onUpload, onEdit }) {
  const { t } = useTranslation();
  const toast = useToast();
  const config = KINDS[kind];
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState(null); // { action, item }
  const [busyId, setBusyId] = useState(null);
  const [installing, setInstalling] = useState(false);
  // 0 to 100 while the files upload; the server then validates and converts them.
  const [installProgress, setInstallProgress] = useState(0);
  const [installPhase, setInstallPhase] = useState("reading"); // reading | uploading | processing
  const [announce, setAnnounce] = useState("");

  const showSearch = items.length > SEARCH_MIN_ITEMS;
  const filtering = filter !== "all" || (showSearch && query.trim() !== "");
  const visible = useMemo(
    () => items.filter((item) => matchesFilter(item, filter) && (!showSearch || matchesQuery(item, query))),
    [items, filter, query, showSearch]
  );
  const manifest = useMemo(() => builtInManifest(kind), [kind]);
  const builtIns = builtInStatus(manifest, items);

  const say = (key, values) => {
    const text = t(key, values);
    toast.success(text);
    setAnnounce(text);
  };
  const fail = (err) => toast.error(apiErrorMessage(err, t("bannerTemplates.actionError")));

  const run = async (item, action, successKey) => {
    setBusyId(item.id);
    try {
      await action();
      say(successKey);
      await onReload();
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  const archive = (item) => config.api.setActive(item.id, false);

  const confirmAction = async () => {
    const { action, item } = confirm;
    setConfirm(null);
    if (action === "archive") await run(item, () => archive(item), "bannerTemplates.archived");
    if (action === "default") await run(item, () => bannerTemplateAPI.setDefault(item.id), "bannerTemplates.defaultSet");
    if (action === "delete") await run(item, () => config.api.remove(item.id, { confirmUsage: item.usage > 0 }), "bannerTemplates.deleted");
  };

  const move = async (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    setAnnounce(t("bannerTemplates.moved", { name: items[index].name, position: target + 1, total: next.length }));
    try {
      await config.api.reorder(next.map((item) => item.id));
    } catch (err) {
      fail(err);
      onReload();
    }
  };

  // Reads the bundled SVGs (lazily) and sends them in one request; the server skips
  // every built-in that already exists, so this is safe to run again.
  const installBuiltIns = async () => {
    setInstalling(true);
    setInstallProgress(0);
    setInstallPhase("reading");
    try {
      const { buildBuiltInUpload } = await import("./builtInLoaders");
      const { formData } = await buildBuiltInUpload(kind);
      setInstallPhase("uploading");
      const { data } = await config.api.installBuiltins(formData, (percent) => {
        setInstallProgress(percent);
        if (percent >= 100) setInstallPhase("processing");
      });
      if (data.created > 0) say("profileTemplates.builtins.done", { count: data.created });
      else if (data.failed === 0) say("profileTemplates.builtins.upToDate");
      if (data.failed > 0) toast.error(t("profileTemplates.builtins.failed", { count: data.failed }));
      await onReload();
    } catch (err) {
      toast.error(apiErrorMessage(err, t("profileTemplates.builtins.error")));
    } finally {
      setInstalling(false);
    }
  };

  const builtInButton = (
    <button type="button" className={`bt__btn${builtIns.none ? " bt__btn--primary" : ""}`} disabled={installing || status !== "ready"} onClick={installBuiltIns}>
      {builtIns.none ? t("profileTemplates.builtins.install") : t("profileTemplates.builtins.restore")}
    </button>
  );

  // A progress bar replaces the button's "Installing…" word: the files upload (a real
  // percentage), then the server validates and converts them (an indeterminate bar).
  const installBar = installing ? (
    <div className="bt__progress" role="status" aria-live="polite">
      <span className="bt__progress-text">
        {installPhase === "uploading" ? t("profileTemplates.builtins.uploading", { percent: installProgress }) : installPhase === "processing" ? t("profileTemplates.builtins.processing") : t("profileTemplates.builtins.reading")}
      </span>
      <progress className="bt__progress-bar" max={100} {...(installPhase === "uploading" ? { value: installProgress } : {})} aria-label={t("profileTemplates.builtins.install")} />
    </div>
  ) : null;

  return (
    <div className="bt__tab">
      <p className="bt__sr" role="status" aria-live="polite">
        {announce}
      </p>

      {status === "ready" && manifest.length > 0 ? (
        <div className={`bt__builtins${builtIns.none ? " is-missing" : ""}`}>
          <p className="bt__builtins-text">
            {builtIns.none
              ? t(`profileTemplates.${config.i18n}.builtinsNone`, { total: builtIns.total })
              : builtIns.missing > 0
                ? t("profileTemplates.builtins.someMissing", { present: builtIns.present, total: builtIns.total })
                : t("profileTemplates.builtins.allInstalled", { total: builtIns.total })}
          </p>
          {installing ? installBar : builtInButton}
        </div>
      ) : null}

      {status === "ready" && items.length > 0 ? (
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
                name={`${kind}Search`}
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
        <ul className={`bt__grid${config.round ? " bt__grid--avatars" : ""}`} aria-busy="true" aria-label={t("bannerTemplates.loading")}>
          {SKELETONS.map((n) => (
            <li key={n} className="bt__card bt__card--skeleton" aria-hidden="true">
              <span className={`bt__skeleton bt__skeleton--thumb${config.round ? " bt__skeleton--round" : ""}`} />
              <span className="bt__skeleton bt__skeleton--line" />
              <span className="bt__skeleton bt__skeleton--line bt__skeleton--short" />
            </li>
          ))}
        </ul>
      ) : null}

      {status === "error" ? (
        <div className="bt__state" role="alert">
          <p>{t("bannerTemplates.loadError")}</p>
          <button type="button" className="bt__btn" onClick={onReload}>
            {t("bannerTemplates.retry")}
          </button>
        </div>
      ) : null}

      {status === "ready" && items.length === 0 ? (
        <div className="bt__state">
          <p>{t(`profileTemplates.${config.i18n}.empty`)}</p>
          <div className="bt__state-actions">
            <button type="button" className="bt__btn" onClick={onUpload}>
              {t(`profileTemplates.${config.i18n}.upload`)}
            </button>
          </div>
        </div>
      ) : null}

      {status === "ready" && items.length > 0 && visible.length === 0 ? <p className="bt__state">{t("bannerTemplates.noMatches")}</p> : null}

      {status === "ready" && visible.length > 0 ? (
        <>
          {filtering ? <p className="bt__hint">{t("bannerTemplates.reorderHint")}</p> : null}
          <ul className={`bt__grid${config.round ? " bt__grid--avatars" : ""}`} aria-label={t(`profileTemplates.${config.i18n}.list`)}>
            {visible.map((item) => {
              const index = items.findIndex((x) => x.id === item.id);
              const busy = busyId === item.id;
              const secondary = item.nameFil && item.nameFil !== item.name ? item.nameFil : "";
              const orderButtons = !filtering ? (
                <div className={`bt__order${config.round ? " bt__order--inline" : ""}`}>
                  <button
                    type="button"
                    className="bt__icon-btn"
                    disabled={index === 0 || busy}
                    onClick={() => move(index, -1)}
                    aria-label={t("bannerTemplates.moveUpFor", { name: item.name })}
                  >
                    <FaArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="bt__icon-btn"
                    disabled={index === items.length - 1 || busy}
                    onClick={() => move(index, 1)}
                    aria-label={t("bannerTemplates.moveDownFor", { name: item.name })}
                  >
                    <FaArrowDown aria-hidden="true" />
                  </button>
                </div>
              ) : null;
              return (
                <li key={item.id} className={`bt__card${config.round ? " bt__card--avatar" : ""}${item.isActive ? "" : " is-archived"}`} aria-busy={busy || undefined}>
                  <div className="bt__thumb-wrap">
                    {config.round ? (
                      item.image?.url ? (
                        <img
                          className="bt__avatar-img"
                          src={resolveAssetUrl(item.image.thumbUrl || item.image.url)}
                          alt={item.name}
                          width={128}
                          height={128}
                          loading="lazy"
                          decoding="async"
                          style={item.image.placeholderColor ? { background: item.image.placeholderColor } : undefined}
                        />
                      ) : (
                        <span className="bt__avatar-img bt__avatar-img--empty" role="img" aria-label={item.name} />
                      )
                    ) : (
                      <BannerPreview template={item} definition={item.definition} height="auto" alt={item.name} className="bt__thumb" />
                    )}
                    {!config.round ? orderButtons : null}
                  </div>

                  <div className="bt__info">
                    <h3 className="bt__name">{item.name}</h3>
                    {secondary ? (
                      <p className="bt__name-fil" lang="fil">
                        {secondary}
                      </p>
                    ) : null}
                    <div className="bt__badges">
                      {item.isBuiltIn ? (
                        <span className="bt__badge bt__badge--builtin">{t("profileTemplates.badge.builtIn")}</span>
                      ) : item.legacy ? null : (
                        <span className="bt__badge">{t("profileTemplates.badge.custom")}</span>
                      )}
                      {item.isDefault ? <span className="bt__badge bt__badge--default">{t("bannerTemplates.badge.default")}</span> : null}
                      <span className={`bt__badge ${item.isActive ? "bt__badge--active" : "bt__badge--archived"}`}>
                        {item.isActive ? t("bannerTemplates.badge.active") : t("bannerTemplates.badge.archived")}
                      </span>
                      {item.legacy ? <span className="bt__badge bt__badge--legacy">{t("bannerTemplates.badge.legacy")}</span> : null}
                    </div>
                    <p className="bt__usage">{t("bannerTemplates.usage", { count: item.usage })}</p>
                    {item.legacy ? <p className="bt__hint">{t("profileTemplates.banners.legacyHint")}</p> : null}
                    {config.round ? orderButtons : null}
                  </div>

                  <div className="bt__actions">
                    <button type="button" className="bt__btn" disabled={busy} onClick={() => onEdit(item)} aria-label={t("bannerTemplates.editFor", { name: item.name })}>
                      {t("bannerTemplates.edit")}
                    </button>
                    {!item.isBuiltIn ? (
                      <button type="button" className="bt__btn" disabled={busy} onClick={() => onEdit(item)} aria-label={t("bannerTemplates.replaceImageFor", { name: item.name })}>
                        {t("bannerTemplates.replaceImage")}
                      </button>
                    ) : null}
                    {config.hasDefault && item.isActive && !item.isDefault ? (
                      <button type="button" className="bt__btn" disabled={busy} onClick={() => setConfirm({ action: "default", item })}>
                        {t("bannerTemplates.setDefault")}
                      </button>
                    ) : null}
                    {item.isActive ? (
                      <button
                        type="button"
                        className="bt__btn"
                        disabled={busy || item.isDefault}
                        onClick={() => (item.usage > 0 ? setConfirm({ action: "archive", item }) : run(item, () => archive(item), "bannerTemplates.archived"))}
                      >
                        {t("bannerTemplates.archive")}
                      </button>
                    ) : (
                      <button type="button" className="bt__btn" disabled={busy} onClick={() => run(item, () => config.api.setActive(item.id, true), "bannerTemplates.activated")}>
                        {t("bannerTemplates.restore")}
                      </button>
                    )}
                    {!item.isBuiltIn && !item.isDefault ? (
                      <button type="button" className="bt__btn bt__btn--danger" disabled={busy} onClick={() => setConfirm({ action: "delete", item })}>
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

      <AppModal
        isOpen={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={
          confirm
            ? confirm.action === "delete" && confirm.item.usage > 0
              ? t("profileTemplates.confirm.deleteInUseTitle")
              : t(`bannerTemplates.confirm.${confirm.action}Title`)
            : ""
        }
        closeLabel={t("bannerTemplates.form.cancel")}
      >
        {confirm ? (
          <div className="bt__confirm">
            <p>
              {confirm.action === "delete" && confirm.item.usage > 0
                ? t("profileTemplates.confirm.deleteInUseBody", { name: confirm.item.name, count: confirm.item.usage })
                : t(`bannerTemplates.confirm.${confirm.action}Body`, { name: confirm.item.name, count: confirm.item.usage })}
            </p>
            <div className="bt__confirm-actions">
              <button type="button" className="bt__btn" onClick={() => setConfirm(null)}>
                {t("bannerTemplates.form.cancel")}
              </button>
              <button type="button" className={`bt__btn ${confirm.action === "delete" ? "bt__btn--danger-solid" : "bt__btn--primary"}`} onClick={confirmAction}>
                {t("bannerTemplates.confirm.ok")}
              </button>
            </div>
          </div>
        ) : null}
      </AppModal>
    </div>
  );
}
