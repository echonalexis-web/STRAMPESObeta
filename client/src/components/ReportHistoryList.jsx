import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminAPI } from "../services/api";
import StateBlock from "./StateBlock";

// The report history: metadata of reports made (never the files), newest first, with Regenerate.
// `refreshKey` changes when a report was just made so the list reloads.
export default function ReportHistoryList({ refreshKey, onRegenerate, busyId }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ key: null, data: null, failed: null });
  const [attempt, setAttempt] = useState(0);
  const key = `${page}|${refreshKey}|${attempt}`;

  useEffect(() => {
    let live = true;
    adminAPI
      .listReportExports({ page, limit: 10 })
      .then(({ data }) => live && setState({ key, data, failed: null }))
      .catch(() => live && setState({ key, data: null, failed: key }));
    return () => {
      live = false;
    };
  }, [page, key]);

  const failed = state.failed === key;
  const data = state.key === key ? state.data : null;
  const format = (value) => new Intl.DateTimeFormat(i18n.language === "fil" ? "fil-PH" : "en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(value));
  const datasetName = (id) => t(`analyticsDash.generator.datasetLabels.${id}`, { defaultValue: id });

  return (
    <section className="asf rg-history" aria-labelledby="rg-history-title">
      <header className="asf__head">
        <div>
          <h2 id="rg-history-title" className="asf__title">{t("analyticsDash.generator.history")}</h2>
          <p className="asf__intro">{t("analyticsDash.generator.historyIntro")}</p>
        </div>
      </header>

      {failed ? (
        <StateBlock kind="error" title={t("analyticsDash.generator.historyError")} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !data ? (
        <StateBlock kind="loading" title={t("analyticsDash.loading")} />
      ) : data.items.length === 0 ? (
        <p className="asf__intro">{t("analyticsDash.generator.historyEmpty")}</p>
      ) : (
        <>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <caption className="ds-sr-only">{t("analyticsDash.generator.history")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("analyticsDash.generator.reportId")}</th>
                  <th scope="col">{t("analyticsDash.generator.dataset")}</th>
                  <th scope="col">{t("analyticsDash.generator.format")}</th>
                  <th scope="col" className="is-num">{t("analyticsDash.generator.records")}</th>
                  <th scope="col">{t("analyticsDash.generator.made")}</th>
                  <th scope="col">{t("analyticsDash.generator.by")}</th>
                  <th scope="col"><span className="ds-sr-only">{t("analyticsDash.generator.regenerate")}</span></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.reportId}>
                    <th scope="row">
                      {item.reportId}
                      {item.regeneratedFrom && <small className="rg-history__from">{t("analyticsDash.generator.regeneratedFrom", { id: item.regeneratedFrom })}</small>}
                    </th>
                    <td>{datasetName(item.dataset)}</td>
                    <td>{item.format.toUpperCase()}</td>
                    <td className="is-num">{item.recordCount}</td>
                    <td>{format(item.createdAt)}</td>
                    <td>{item.preparedBy.name}</td>
                    <td>
                      <button
                        type="button"
                        className="asf__clear"
                        disabled={Boolean(busyId)}
                        aria-label={t("analyticsDash.generator.regenerateFor", { id: item.reportId })}
                        onClick={() => onRegenerate(item.reportId)}
                      >
                        {busyId === item.reportId ? t("analyticsDash.generator.working") : t("analyticsDash.generator.regenerate")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.totalPages > 1 && (
            <nav className="rg-history__pager" aria-label={t("analyticsDash.generator.history")}>
              <button type="button" className="asf__clear" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("analyticsDash.generator.prev")}</button>
              <span>{t("analyticsDash.generator.pageOf", { page: data.page, total: data.totalPages })}</span>
              <button type="button" className="asf__clear" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>{t("analyticsDash.generator.next")}</button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
