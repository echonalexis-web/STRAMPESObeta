import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, ClipboardList, Hourglass } from "lucide-react";

const TILES = [
  { key: "all", label: "total", Icon: ClipboardList },
  { key: "inProgress", label: "inProgress", Icon: Hourglass },
  { key: "needsAction", label: "needsAction", Icon: AlertTriangle },
  { key: "released", label: "released", Icon: CheckCircle2 },
];

// Page header band: title, subtitle and the primary action, then one row of stat tiles.
// Each tile is a button that filters the list below.
export default function ApplicationsHeader({ counts, filter, onFilter }) {
  const { t } = useTranslation();
  return (
    <header className="spes-apps__header">
      <div className="spes-apps__titlebar">
        <div>
          <h1>{t("spes.my.title")}</h1>
          <p className="spes-apps__subtitle">{t("spes.my.subtitle")}</p>
        </div>
        <Link to="/spes/postings" className="ds-btn ds-btn--primary spes-apps__browse">
          {t("spes.my.browse")}
        </Link>
      </div>

      <div className="spes-tiles" role="group" aria-label={t("spes.my.summaryLabel")}>
        {TILES.map((tile) => {
          const { key, label } = tile;
          const Icon = tile.Icon;
          return (
          <button
            key={key}
            type="button"
            className={`spes-tile spes-tile--${key}${filter === key ? " is-active" : ""}`}
            aria-pressed={filter === key}
            onClick={() => onFilter(key)}
          >
            <Icon size={18} aria-hidden="true" className="spes-tile__icon" />
            <span className="spes-tile__count">{counts[key]}</span>
            <span className="spes-tile__label">{t(`spes.my.tile.${label}`)}</span>
          </button>
          );
        })}
      </div>
    </header>
  );
}
