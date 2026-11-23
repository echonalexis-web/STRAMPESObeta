import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminAPI } from "../services/api";
import AppModal from "./AppModal";
import StateBlock from "./StateBlock";
import Avatar from "./Avatar";

const dash = (value, suffix = "") => (value === null || value === undefined ? null : `${value}${suffix}`);

// One employer's numbers for the chosen period, with the previous period beside them and a
// funnel per posting. Counts only: the server never sends an applicant's identity.
export default function EmployerPerformanceDetail({ employer, params, onClose }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ key: null, data: null, failed: null });
  const [attempt, setAttempt] = useState(0);
  const key = `${employer.employerId}|${JSON.stringify(params)}|${attempt}`;

  useEffect(() => {
    let live = true;
    adminAPI
      .getEmployerPerformanceDetail(employer.employerId, params)
      .then(({ data }) => live && setState({ key, data, failed: null }))
      .catch(() => live && setState({ key, data: null, failed: key }));
    return () => {
      live = false;
    };
  }, [employer.employerId, params, key]);

  const ready = state.key === key && state.data;
  const failed = state.failed === key;
  const data = ready ? state.data : null;
  const noValue = t("analyticsDash.performance.noValue");
  const rows = data
    ? [
        ["postings", data.metrics.postings, data.previousMetrics.postings],
        ["applicants", data.metrics.applicants, data.previousMetrics.applicants],
        ["hires", data.metrics.hires, data.previousMetrics.hires],
        ["hireRate", dash(data.metrics.hireRate, "%"), dash(data.previousMetrics.hireRate, "%")],
        ["fillRate", dash(data.metrics.fillRate, "%"), dash(data.previousMetrics.fillRate, "%")],
        ["daysToHire", data.metrics.medianDaysToHire, data.previousMetrics.medianDaysToHire],
        ["responseRate", dash(data.metrics.responseRate, "%"), dash(data.previousMetrics.responseRate, "%")],
      ]
    : [];

  return (
    <AppModal isOpen onClose={onClose} title={t("analyticsDash.performance.detailsFor", { name: employer.name })} closeLabel={t("common.close", { defaultValue: "Close" })}>
      <div className="epf-detail">
        {failed ? (
          <StateBlock kind="error" title={t("analyticsDash.errorTitle")} description={t("analyticsDash.errorText")} onRetry={() => setAttempt((n) => n + 1)} />
        ) : !data ? (
          <StateBlock kind="loading" title={t("analyticsDash.loading")} />
        ) : (
          <>
            <p className="epf-detail__who">
              <Avatar name={data.employer.name} photo={data.employer.photo} size={36} />
              <strong>{data.employer.name}</strong>
              <span>{data.period.label}</span>
            </p>
            {!data.employer.eligible && <p className="asf__hint">{t("analyticsDash.performance.notEligible")}</p>}
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th scope="col" />
                    <th scope="col" className="is-num">{data.period.label}</th>
                    <th scope="col" className="is-num">{t("analyticsDash.performance.previousPeriod")}: {data.previous.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([name, now, before]) => (
                    <tr key={name}>
                      <th scope="row">{t(`analyticsDash.performance.${name}`)}</th>
                      <td className="is-num">{now ?? noValue}</td>
                      <td className="is-num">{before ?? noValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="asf__panel-title">{t("analyticsDash.performance.postingsList")}</h3>
            {data.postings.length === 0 ? (
              <p className="asf__intro">{t("analyticsDash.emptyText")}</p>
            ) : (
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("analyticsDash.performance.posting")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.funnelApplicants")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.funnelQualified")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.funnelShortlisted")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.funnelHired")}</th>
                      <th scope="col" className="is-num">{t("analyticsDash.performance.daysToFill")}</th>
                      <th scope="col">{t("analyticsDash.performance.closeReason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.postings.map((posting) => (
                      <tr key={posting.id}>
                        <th scope="row">{posting.title}</th>
                        <td className="is-num">{posting.funnel.applicants}</td>
                        <td className="is-num">{posting.funnel.qualified}</td>
                        <td className="is-num">{posting.funnel.shortlisted}</td>
                        <td className="is-num">{posting.funnel.hired}</td>
                        <td className="is-num">{posting.timeToFillDays ?? noValue}</td>
                        <td>{posting.closeReason || noValue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="asf__note">{t("analyticsDash.performance.countsOnly")}</p>
          </>
        )}
      </div>
    </AppModal>
  );
}
