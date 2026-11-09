import { useTranslation } from "react-i18next";
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, Clock } from "lucide-react";
import { MiniProgress } from "./StepperProgress";
import ApplicationDetails from "./ApplicationDetails";
import { groupOf, replacementCount } from "../../utils/spesApplications";

const GROUP_ICON = {
  inProgress: Clock,
  needsAction: AlertTriangle,
  released: CheckCircle2,
  closed: Ban,
};

// One application: a collapsed row (status icon, title, date, mini progress, one status
// chip, an alert badge when the applicant must act) that expands to the full details. The
// whole row is the toggle button; the details are a labelled region controlled by it.
export default function ApplicationRow({ app, status, title, dateText, open, onToggle, onUpload, onWithdraw }) {
  const { t } = useTranslation();
  const group = groupOf(status);
  const Icon = GROUP_ICON[group];
  const id = String(app._id);
  const buttonId = `spes-app-btn-${id}`;
  const panelId = `spes-app-panel-${id}`;
  const replacing = replacementCount(app);
  const closed = group === "closed";

  return (
    <li className={`spes-app spes-app--${group}${open ? " is-open" : ""}`}>
      <h2 className="spes-app__heading">
        <button
          type="button"
          id={buttonId}
          className="spes-app__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className={`spes-app__icon spes-app__icon--${group}`} aria-hidden="true">
            <Icon size={18} />
          </span>
          <span className="spes-app__main">
            <span className="spes-app__title">{title}</span>
            <span className="spes-app__date">{t("spes.my.applied", { date: dateText })}</span>
          </span>
          <span className="spes-app__progress">{closed ? null : <MiniProgress status={status} />}</span>
          <span className="spes-app__state">
            <span className={`spes-chip spes-chip--${status}`}>{t(`spes.status.${status}`)}</span>
            {group === "needsAction" ? (
              <span className="spes-app__alert">
                <AlertTriangle size={13} aria-hidden="true" />
                {replacing > 0 ? t("spes.my.needsReplacing", { count: replacing }) : t("spes.my.actionNeeded")}
              </span>
            ) : null}
          </span>
          <span className="spes-app__more" aria-hidden="true">
            <span className="spes-app__more-text">{t("spes.my.details")}</span>
            <ChevronDown size={18} className="spes-app__chevron" />
          </span>
        </button>
      </h2>

      <div className="spes-app__panel" data-open={open ? "true" : "false"}>
        <div className="spes-app__panel-clip">
          <div id={panelId} role="region" aria-labelledby={buttonId} className="spes-app__panel-inner" inert={!open}>
            <ApplicationDetails app={app} status={status} onUpload={onUpload} onWithdraw={onWithdraw} />
          </div>
        </div>
      </div>
    </li>
  );
}
