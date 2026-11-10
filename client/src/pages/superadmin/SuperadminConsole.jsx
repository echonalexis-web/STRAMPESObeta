import { useId, useMemo, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaArrowRight, FaFilePdf, FaImages, FaListCheck, FaMagnifyingGlass, FaScaleBalanced, FaUserShield, FaXmark } from "react-icons/fa6";
import { ConsoleHero } from "./ConsoleShell";
import {
  CONSOLE_FUNCTIONS,
  descriptionKey,
  filterFunctions,
  groupFunctions,
  groupKey,
  legacyHashTarget,
  titleKey,
} from "./consoleRegistry";

const ICONS = { shield: FaUserShield, pdf: FaFilePdf, scale: FaScaleBalanced, list: FaListCheck, images: FaImages };

// The console home: one card per function, each a link to its own page. Nothing is
// loaded here, so no function fetches data until it is opened.
export default function SuperadminConsole() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const searchId = useId();
  const [query, setQuery] = useState("");

  const text = (entry) => ({ title: t(titleKey(entry)), description: t(descriptionKey(entry)) });
  const groups = useMemo(
    () => groupFunctions(filterFunctions(CONSOLE_FUNCTIONS, query, text)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, t]
  );

  // Links to the old single page (an anchor on one of its sections) land on that function.
  const legacyTarget = legacyHashTarget(hash);
  if (legacyTarget) return <Navigate to={legacyTarget} replace />;

  return (
    <div className="sac">
      <main className="sac__main scl-main">
        <ConsoleHero title={t("navbar.superadminConsole")} subtitle={t("superadmin.console.subtitle")} />

        <div className="scl__search">
          <label htmlFor={searchId} className="scl__search-label">
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

        <p className="scl__sr" role="status" aria-live="polite">
          {query && groups.length === 0 ? t("superadmin.launcher.empty") : ""}
        </p>

        {groups.length === 0 ? <p className="scl__empty">{t("superadmin.launcher.empty")}</p> : null}

        {groups.map(({ group, entries }) => {
          const headingId = `scl-group-${group}`;
          return (
            <section key={group} className="scl__group" aria-labelledby={headingId}>
              <h2 className="scl__group-title" id={headingId}>
                {t(groupKey(group))}
              </h2>
              <ul className="scl__grid">
                {entries.map((entry) => {
                  const Icon = ICONS[entry.icon] || FaListCheck;
                  const titleId = `scl-${entry.id}-title`;
                  const descId = `scl-${entry.id}-desc`;
                  return (
                    <li key={entry.id}>
                      <Link to={entry.path} className="scl__card" aria-labelledby={titleId} aria-describedby={descId}>
                        <span className="scl__icon" aria-hidden="true">
                          <Icon />
                        </span>
                        <span className="scl__body">
                          <span className="scl__title" id={titleId}>
                            {t(titleKey(entry))}
                          </span>
                          <span className="scl__desc" id={descId}>
                            {t(descriptionKey(entry))}
                          </span>
                        </span>
                        <FaArrowRight className="scl__arrow" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
