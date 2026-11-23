import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminAPI } from "../services/api";
import AppModal from "./AppModal";
import Pagination from "./Pagination";
import StateBlock from "./StateBlock";
import { periodText } from "../utils/reportHistory";

const DATASET_IDS = ["jobs", "employers", "applications", "hires", "jobseekers", "spes", "employer_ranking", "verification_activity", "audit_summary"];
const FORMATS = ["csv", "xlsx", "pdf"];
const EMPTY_FILTERS = { dataset: "", format: "", from: "", to: "" };

// Report history in a dialog: records of reports made, newest first. It is mounted when the person opens
// it, so the history is fetched then and never before; reading it is not an export and writes nothing.
// The server decides which rows this person may read (a PESO admin sees their own, a superadmin all).
//   onSetUp(item): the row's "Set up again"; the parent prefills the generator and closes this dialog.
export default function ReportHistoryModal({ onClose, onSetUp }) {
  const { t, i18n } = useTranslation();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ key: null, data: null, failed: null });
  const scrollRef = useRef(null);

  const rangeOk = !filters.from || !filters.to || filters.from <= filters.to;
  const params = useMemo(() => {
    const out = { page, limit: pageSize, sort: "newest" };
    for (const [name, value] of Object.entries(filters)) if (value) out[name] = value;
    return out;
  }, [filters, page, pageSize]);
  const key = `${JSON.stringify(params)}#${attempt}`;

  useEffect(() => {
    if (!rangeOk) return undefined;
    let live = true;
    adminAPI
      .listReportExports(params)
      .then(({ data }) => live && setState({ key, data, failed: null }))
      .catch(() => live && setState({ key, data: null, failed: key }));
    return () => {
      live = false;
    };
  }, [params, key, rangeOk]);

  const data = state.data;
  const failed = state.failed === key;
  const loading = rangeOk && !failed && state.key !== key;
  const filtered = Object.values(filters).some(Boolean);
  const change = (patch) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  const reset = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };
  const when = (value) => {
    try {
      return new Intl.DateTimeFormat(i18n.language === "fil" ? "fil-PH" : "en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(value));
    } catch {
      return "";
    }
  };
  const datasetName = (id) => t(`analyticsDash.generator.datasetLabels.${id}`, { defaultValue: id });
  const items = data ? data.items : [];

  return (
    <AppModal
      isOpen
      onClose={onClose}
      title={t("reportHistory.title")}
      titleId="rhm-title"
      closeLabel={t("reportHistory.close")}
      className="rhm"
      panelClassName="rhm__card"
    >
      <div className="rhm__content">
        <p className="rhm__sub">{t("reportHistory.subtitle")}</p>

        <form className="rh__toolbar" aria-label={t("reportHistory.toolbar")} onSubmit={(event) => event.preventDefault()}>
          <div className="an-field">
            <label htmlFor="rh-report">{t("reportHistory.report")}</label>
            <select id="rh-report" value={filters.dataset} onChange={(event) => change({ dataset: event.target.value })}>
              <option value="">{t("reportHistory.all")}</option>
              {DATASET_IDS.map((id) => <option key={id} value={id}>{datasetName(id)}</option>)}
            </select>
          </div>
          <div className="an-field">
            <label htmlFor="rh-format">{t("reportHistory.fileType")}</label>
            <select id="rh-format" value={filters.format} onChange={(event) => change({ format: event.target.value })}>
              <option value="">{t("reportHistory.all")}</option>
              {FORMATS.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
            </select>
          </div>
          <div className="an-field">
            <label htmlFor="rh-from">{t("reportHistory.madeFrom")}</label>
            <input id="rh-from" type="date" value={filters.from} onChange={(event) => change({ from: event.target.value })} />
          </div>
          <div className="an-field">
            <label htmlFor="rh-to">{t("reportHistory.madeTo")}</label>
            <input id="rh-to" type="date" value={filters.to} onChange={(event) => change({ to: event.target.value })} />
          </div>
          <button type="button" className="an__btn" onClick={reset} aria-disabled={!filtered}>{t("reportHistory.reset")}</button>
        </form>
        {!rangeOk && <p className="an__hint" role="alert">{t("adminAnalytics.filter.customHint")}</p>}

        <div className="rhm__scroll" ref={scrollRef}>
          {failed ? (
            <StateBlock kind="error" title={t("reportHistory.errorTitle")} description={t("reportHistory.errorText")} onRetry={() => setAttempt((n) => n + 1)} />
          ) : !data ? (
            <StateBlock kind="loading" title={t("analyticsDash.loading")} />
          ) : items.length === 0 ? (
            filtered ? (
              <StateBlock kind="empty" title={t("reportHistory.filteredTitle")} description={t("reportHistory.filteredText")} action={<button type="button" className="an__btn" onClick={reset}>{t("reportHistory.reset")}</button>} />
            ) : (
              <StateBlock kind="empty" title={t("reportHistory.emptyTitle")} description={t("reportHistory.emptyText")} action={<button type="button" className="an__btn" onClick={onClose}>{t("reportHistory.emptyButton")}</button>} />
            )
          ) : (
            <table className="rh__table" style={loading ? { opacity: 0.6 } : undefined} aria-busy={loading}>
              <caption className="ds-sr-only">{t("reportHistory.card")}</caption>
              <thead>
                <tr>
                  {["when", "report", "fileType", "period", "municipality", "preparedBy", "result", "action"].map((column) => (
                    <th key={column} scope="col">{column === "action" ? <span className="ds-sr-only">{t("reportHistory.columns.action")}</span> : t(`reportHistory.columns.${column}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.reportId}>
                    <td data-label={t("reportHistory.columns.when")}>{when(item.createdAt)}</td>
                    <th scope="row" data-label={t("reportHistory.columns.report")}>{datasetName(item.dataset)}</th>
                    <td data-label={t("reportHistory.columns.fileType")}>{item.format.toUpperCase()}</td>
                    <td data-label={t("reportHistory.columns.period")}>{periodText(item, t)}</td>
                    <td data-label={t("reportHistory.columns.municipality")}>{item.municipality || t("reportHistory.allMunicipalities")}</td>
                    <td data-label={t("reportHistory.columns.preparedBy")}>{item.preparedBy.name}</td>
                    <td data-label={t("reportHistory.columns.result")}>
                      <span className={`rh__result rh__result--${item.result}`}>
                        {t(`reportHistory.result.${item.result}`)}
                        {item.result === "blocked" && item.blockedReason ? ` · ${t(`reportHistory.reasons.${item.blockedReason}`, { defaultValue: item.blockedReason })}` : ""}
                      </span>
                    </td>
                    <td className="rh__action">
                      <button type="button" className="an__btn" aria-label={t("reportHistory.setUpFor", { id: item.reportId })} onClick={() => onSetUp(item)}>
                        {t("reportHistory.setUp")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rhm__footer">
          <Pagination
            total={data ? data.total : 0}
            page={page}
            pageSize={pageSize}
            pageSizes={[10, 20, 50]}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            label={t("reportHistory.items")}
            disabled={loading}
            idPrefix="rhm-pager"
            scrollTargetRef={scrollRef}
          />
        </div>
      </div>
    </AppModal>
  );
}
