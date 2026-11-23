import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminAPI } from "../services/api";
import { useToast } from "./feedback/context";
import { downloadBlob } from "../utils/exportUtils";
import AppModal from "./AppModal";
import StateBlock from "./StateBlock";
import ReportHistoryList from "./ReportHistoryList";
import {
  PURPOSE_MAX,
  PURPOSE_MIN,
  buildRequest,
  canChooseColumns,
  errorCodeOf,
  filenameFromDisposition,
  initialBuilder,
  problems,
  selectDataset,
  toggleColumn,
} from "../utils/reportBuilderState";
import "../styles/analytics-filters.css";

// Report generator. Its period and municipality are the page's filter bar (`scope`), never its own
// controls; the steps here are the report, the columns, the grouping, and the file and purpose.
// The server decides the preparer, the report ID and the time.
//   scope: { period, from, to, municipality, text, ready }
export default function ReportGeneratorPanel({ scope }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [catalog, setCatalog] = useState(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [builder, setBuilder] = useState(() => initialBuilder());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [historyKey, setHistoryKey] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const sectionRef = useRef(null);

  // A link from another page ("/admin/reports#report-generator") lands here.
  useEffect(() => {
    if (window.location.hash === "#report-generator" && sectionRef.current) sectionRef.current.scrollIntoView({ block: "start" });
  }, []);

  useEffect(() => {
    let live = true;
    adminAPI
      .getReportCatalog()
      .then(({ data }) => live && setCatalog(data))
      .catch(() => live && setCatalogFailed(true));
    return () => {
      live = false;
    };
  }, [attempt]);

  const dataset = useMemo(() => (catalog ? catalog.datasets.find((item) => item.id === builder.dataset) || null : null), [catalog, builder.dataset]);
  // The form's own choices plus the page's scope: this is what is sent and what is checked.
  const effective = useMemo(
    () => ({
      ...builder,
      period: scope.period,
      from: scope.from,
      to: scope.to,
      filters: scope.municipality ? { municipality: scope.municipality } : {},
    }),
    [builder, scope.period, scope.from, scope.to, scope.municipality]
  );
  const missing = problems(effective, dataset);
  const ready = missing.length === 0 && scope.ready !== false;
  const update = (patch) => setBuilder((current) => ({ ...current, ...patch }));
  const datasetName = (id) => t(`analyticsDash.generator.datasetLabels.${id}`, { defaultValue: id });
  const pdfCap = catalog && dataset ? dataset.maxRows.pdf : null;

  const failMessage = async (error) => {
    const code = await errorCodeOf(error);
    return code ? t(`analyticsDash.generator.errors.${code}`, { defaultValue: t("analyticsDash.generator.failed") }) : t("analyticsDash.generator.failed");
  };

  const runPreview = async () => {
    setBusy("preview");
    try {
      const { data } = await adminAPI.previewReportExport(buildRequest(effective, dataset));
      setPreview(data);
    } catch (error) {
      toast.error(await failMessage(error));
    } finally {
      setBusy("");
    }
  };

  const finish = (response, fallbackId) => {
    const name = filenameFromDisposition(response.headers?.["content-disposition"], `${fallbackId || "report"}`);
    const id = response.headers?.["x-report-id"] || name.replace(/\.[a-z]+$/i, "");
    downloadBlob(name, response.data);
    toast.success(t("analyticsDash.generator.done", { id }));
    setHistoryKey((key) => key + 1);
  };

  const generate = async () => {
    setBusy("generate");
    try {
      finish(await adminAPI.generateReportExport(buildRequest(effective, dataset)));
    } catch (error) {
      toast.error(await failMessage(error));
    } finally {
      setBusy("");
    }
  };

  const regenerate = async (reportId) => {
    setBusy(reportId);
    try {
      finish(await adminAPI.regenerateReportExport(reportId), reportId);
    } catch (error) {
      toast.error(await failMessage(error));
    } finally {
      setBusy("");
    }
  };

  if (catalogFailed) {
    return (
      <section className="asf" id="report-generator" aria-labelledby="rg-title" ref={sectionRef}>
        <h2 id="rg-title" className="asf__title">{t("analyticsDash.generator.title")}</h2>
        <StateBlock kind="error" title={t("analyticsDash.errorTitle")} description={t("analyticsDash.errorText")} onRetry={() => { setCatalogFailed(false); setAttempt((n) => n + 1); }} />
      </section>
    );
  }

  const previewMessage = preview
    ? preview.notEnoughData
      ? t("analyticsDash.generator.previewNotEnough")
      : preview.wouldExceedLimit
        ? t("analyticsDash.generator.previewTooLarge", { max: preview.maxRows })
        : preview.recordCount === 0
          ? t("analyticsDash.generator.previewEmpty")
          : t("analyticsDash.generator.previewCount", { count: preview.recordCount })
    : "";

  return (
    <>
      <section className="asf rg" id="report-generator" aria-labelledby="rg-title" ref={sectionRef}>
        <header className="asf__head">
          <div>
            <h2 id="rg-title" className="asf__title">{t("adminAnalytics.generator.sectionTitle")}</h2>
            <p className="asf__intro">{t("adminAnalytics.generator.scopeIntro", { scope: scope.text })}</p>
          </div>
        </header>

        {!catalog ? (
          <StateBlock kind="loading" title={t("analyticsDash.loading")} />
        ) : (
          <form className="rg__form" onSubmit={(event) => event.preventDefault()}>
            <fieldset className="rg__step">
              <legend>{t("analyticsDash.generator.step1")}</legend>
              <div className="asf-field">
                <label htmlFor="rg-dataset">{t("analyticsDash.generator.dataset")}</label>
                <select
                  id="rg-dataset"
                  value={builder.dataset}
                  onChange={(event) => setBuilder((current) => selectDataset(current, catalog.datasets.find((item) => item.id === event.target.value) || null))}
                >
                  <option value="">{t("analyticsDash.generator.chooseDataset")}</option>
                  {catalog.datasets.map((item) => <option key={item.id} value={item.id}>{datasetName(item.id)}</option>)}
                </select>
              </div>
            </fieldset>

            {dataset && (
              <>
                <fieldset className="rg__step">
                  <legend>{t("analyticsDash.generator.step3")}</legend>
                  {canChooseColumns(dataset, effective) ? (
                    <>
                      <p className="asf__intro">{t("analyticsDash.generator.columnsHint")}</p>
                      <div className="rg__columns">
                        {dataset.columns.map((column) => (
                          <label key={column.key} className="rg__check">
                            <input type="checkbox" checked={builder.columns.includes(column.key)} onChange={() => setBuilder((current) => toggleColumn(current, dataset, column.key))} />
                            {column.label}
                          </label>
                        ))}
                      </div>
                      {missing.includes("columns") && <p className="asf__hint" role="alert">{t("analyticsDash.generator.needs.columns")}</p>}
                    </>
                  ) : (
                    <p className="asf__intro">{dataset.groupings.includes("none") ? t("analyticsDash.generator.columnsGrouped") : t("analyticsDash.generator.columnsFixed")}</p>
                  )}
                </fieldset>

                {dataset.groupings.filter((g) => g !== "none").length > 0 && (
                  <fieldset className="rg__step">
                    <legend>{t("analyticsDash.generator.step4")}</legend>
                    <div className="asf-field">
                      <label htmlFor="rg-grouping">{t("analyticsDash.generator.grouping")}</label>
                      <select id="rg-grouping" value={builder.grouping} onChange={(event) => update({ grouping: event.target.value })}>
                        {dataset.groupings.map((value) => <option key={value} value={value}>{t(`analyticsDash.generator.groupings.${value}`, { defaultValue: value })}</option>)}
                      </select>
                    </div>
                  </fieldset>
                )}

                <fieldset className="rg__step">
                  <legend>{t("analyticsDash.generator.step5")}</legend>
                  <div className="rg__formats" role="radiogroup" aria-label={t("analyticsDash.generator.format")}>
                    {catalog.formats.map((format) => (
                      <label key={format} className="rg__check">
                        <input type="radio" name="rg-format" value={format} checked={builder.format === format} onChange={() => update({ format })} />
                        {t(`analyticsDash.generator.formats.${format}`)}
                      </label>
                    ))}
                  </div>
                  {builder.format === "pdf" && pdfCap && <p className="asf__note">{t("analyticsDash.generator.pdfCap", { count: pdfCap })}</p>}
                  {dataset.needsPurpose && (
                    <div className="asf-field rg__purpose">
                      <label htmlFor="rg-purpose">{t("analyticsDash.generator.purpose")}</label>
                      <textarea
                        id="rg-purpose"
                        rows={3}
                        maxLength={PURPOSE_MAX}
                        value={builder.purpose}
                        aria-describedby="rg-purpose-hint"
                        aria-invalid={missing.includes("purpose") && builder.purpose.length > 0}
                        onChange={(event) => update({ purpose: event.target.value })}
                      />
                      <small id="rg-purpose-hint">
                        {t("analyticsDash.generator.purposeHint", { min: PURPOSE_MIN, max: PURPOSE_MAX })} {t("analyticsDash.generator.purposeCount", { count: builder.purpose.trim().length, max: PURPOSE_MAX })}
                      </small>
                    </div>
                  )}
                </fieldset>
              </>
            )}

            <div className="rg__actions">
              <button type="button" className="asf__clear" disabled={!ready || Boolean(busy)} onClick={runPreview}>
                {busy === "preview" ? t("analyticsDash.generator.working") : t("analyticsDash.generator.preview")}
              </button>
              <button type="button" className="asf__tab rg__go" aria-pressed="true" disabled={!ready || Boolean(busy)} onClick={generate}>
                {busy === "generate" ? t("analyticsDash.generator.working") : t("analyticsDash.generator.generate")}
              </button>
            </div>
            {!ready && missing[0] && missing[0] !== "period" && missing[0] !== "columns" && (
              <p className="asf__hint" id="rg-needs">{t(`analyticsDash.generator.needs.${missing[0]}`, { min: PURPOSE_MIN, max: PURPOSE_MAX })}</p>
            )}
          </form>
        )}
      </section>

      <ReportHistoryList refreshKey={historyKey} onRegenerate={regenerate} busyId={busy && busy !== "preview" && busy !== "generate" ? busy : ""} />

      <AppModal isOpen={Boolean(preview)} onClose={() => setPreview(null)} title={t("analyticsDash.generator.previewTitle")} closeLabel={t("common.close", { defaultValue: "Close" })}>
        {preview && (
          <div className="rg__preview">
            <p role="status">{previewMessage}</p>
            <p className="asf__note">
              {t("analyticsDash.generator.previewPreparedBy", {
                name: preview.preparedBy.name,
                role: preview.preparedBy.role,
                office: preview.preparedBy.office ? t("analyticsDash.generator.previewOffice", { office: preview.preparedBy.office }) : "",
              })}
            </p>
            {preview.sample.length > 0 && (
              <>
                <h3 className="asf__panel-title">{t("analyticsDash.generator.previewSample", { count: preview.sample.length })}</h3>
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>{preview.columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((row, index) => (
                        <tr key={index}>{preview.columns.map((column) => <td key={column.key}>{row[column.key] ?? ""}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </AppModal>
    </>
  );
}
