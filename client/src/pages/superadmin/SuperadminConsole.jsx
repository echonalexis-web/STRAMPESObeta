import { useEffect, useId, useMemo, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import useSegmentedRail from "../../hooks/useSegmentedRail";
import { FaArrowRight, FaFilePdf, FaImages, FaListCheck, FaMagnifyingGlass, FaScaleBalanced, FaUserShield, FaXmark } from "react-icons/fa6";
import { avatarPresetAPI, bannerTemplateAPI, superadminAPI } from "../../services/api";
import { ConsoleHero } from "./ConsoleShell";
import {
  CONSOLE_FUNCTIONS,
  CONSOLE_GROUPS,
  buildSummary,
  descriptionKey,
  filterByGroup,
  filterFunctions,
  groupKey,
  legacyHashTarget,
  titleKey,
} from "./consoleRegistry";

const ICONS = { shield: FaUserShield, pdf: FaFilePdf, scale: FaScaleBalanced, list: FaListCheck, images: FaImages };
const NSRP_FORMS = ["form1", "form2"];

// Loads, in parallel, the few numbers shown on the cards. Only calls the functions
// already make; a failed call just leaves that card without a summary line.
// State per id: undefined = loading, [] = nothing to show, [{ key, count }] = parts.
const useCardSummaries = () => {
  const [summaries, setSummaries] = useState({});
  useEffect(() => {
    let cancelled = false;
    const put = (id, parts) => {
      if (!cancelled) setSummaries((prev) => ({ ...prev, [id]: parts }));
    };
    const run = (id, load) => load().then((data) => put(id, buildSummary(id, data))).catch(() => put(id, []));

    run("admin-accounts", async () => (await superadminAPI.listAdmins()).data?.admins);
    // Both lists, each optional: one that fails is simply left out of the summary.
    run("banner-avatar-templates", async () => {
      const [banners, avatars] = await Promise.allSettled([bannerTemplateAPI.adminList(), avatarPresetAPI.adminList()]);
      return {
        banners: banners.status === "fulfilled" ? banners.value.data?.templates : null,
        avatars: avatars.status === "fulfilled" ? avatars.value.data?.presets : null,
      };
    });
    run("nsrp-forms", async () => {
      const results = await Promise.all(NSRP_FORMS.map((form) => superadminAPI.getNsrpTemplateMeta(form)));
      return results.map((res) => res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return summaries;
};

// The console home: a toolbar (group chips and search) over one grid of cards, each
// a link to its own page. Summary lines are loaded here; nothing else is.
export default function SuperadminConsole() {
  const railRef = useSegmentedRail();
  const { t } = useTranslation();
  const { hash } = useLocation();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const summaries = useCardSummaries();

  const text = (entry) => ({ title: t(titleKey(entry)), description: t(descriptionKey(entry)) });
  const visible = useMemo(
    () => filterFunctions(filterByGroup(CONSOLE_FUNCTIONS, group), query, text),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, group, t]
  );
  const chips = useMemo(() => ["all", ...CONSOLE_GROUPS.filter((g) => CONSOLE_FUNCTIONS.some((entry) => entry.group === g))], []);

  // Links to the old single page (an anchor on one of its sections) land on that function.
  const legacyTarget = legacyHashTarget(hash);
  if (legacyTarget) return <Navigate to={legacyTarget} replace />;

  const summaryText = (parts) =>
    parts
      .map((part) => t(`superadmin.launcher.summary.${part.key}`, { count: part.count, total: part.total }))
      .join(", ");

  return (
    <div className="sac">
      <main className="sac__main scl-main">
        <ConsoleHero compact title={t("navbar.superadminConsole")} subtitle={t("superadmin.console.subtitle")} />

        <div className="scl__toolbar">
          <div ref={railRef} className="scl__chips seg-rail" role="group" aria-label={t("superadmin.launcher.filterLabel")}>
            {chips.map((value) => (
              <button key={value} type="button" className="scl__chip" aria-pressed={group === value} onClick={() => setGroup(value)}>
                {value === "all" ? t("superadmin.launcher.all") : t(groupKey(value))}
              </button>
            ))}
          </div>
          <div className="scl__search">
            <label htmlFor={searchId} className="scl__sr">
              {t("superadmin.launcher.searchLabel")}
            </label>
            <div className="scl__search-box">
              <FaMagnifyingGlass aria-hidden="true" />
              <input
                id={searchId}
                type="search"
                name="consoleSearch"
                value={query}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("superadmin.launcher.searchPlaceholder")}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label={t("superadmin.launcher.clearSearch")}>
                  <FaXmark aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <p className="scl__sr" role="status" aria-live="polite">
          {visible.length === 0 ? t("superadmin.launcher.empty") : ""}
        </p>

        {visible.length === 0 ? <p className="scl__empty">{t("superadmin.launcher.empty")}</p> : null}

        <ul className="scl__grid">
          {visible.map((entry) => {
            const Icon = ICONS[entry.icon] || FaListCheck;
            const titleId = `scl-${entry.id}-title`;
            const descId = `scl-${entry.id}-desc`;
            const parts = summaries[entry.id];
            const hasSummary = Array.isArray(parts) && parts.length > 0;
            const loading = entry.id in summaries ? false : ["admin-accounts", "banner-avatar-templates", "nsrp-forms"].includes(entry.id);
            return (
              <li key={entry.id}>
                <Link to={entry.path} className="scl__card" aria-labelledby={titleId} aria-describedby={descId}>
                  <span className="scl__icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="scl__body">
                    <span className="scl__tag">{t(groupKey(entry.group))}</span>
                    <span className="scl__title" id={titleId}>
                      {t(titleKey(entry))}
                    </span>
                    <span className="scl__desc" id={descId}>
                      {t(descriptionKey(entry))}
                    </span>
                    {hasSummary ? <span className="scl__summary">{summaryText(parts)}</span> : null}
                    {loading ? <span className="scl__summary scl__summary--loading" aria-hidden="true" /> : null}
                  </span>
                  <FaArrowRight className="scl__arrow" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
