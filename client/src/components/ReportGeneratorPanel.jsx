import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";
import { adminAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./feedback/context";
import { downloadBlob } from "../utils/exportUtils";
import AppModal from "./AppModal";
import StateBlock from "./StateBlock";
import ReportHistoryModal from "./ReportHistoryModal";
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

// Generate a report: one flat card. The period and municipality are the page's filter bar (`scope`),
// never this card's own controls. The server decides the preparer, the report ID and the time.
//   scope:   { period, from, to, municipality, text, ready }
//   prefill: { dataset, format, nonce } from "Set up again" in the report history (a new nonce applies it again)
//   onSetUp: called with the history row when "Set up again" is pressed; the page applies its scope
export default function ReportGeneratorPanel({ scope, prefill = null, onSetUp = null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
  const [catalog, setCatalog] = useState(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [builder, setBuilder] = useState(() => initialBuilder());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  // Nothing is reported as missing until the person has pressed Preview or Generate once.
  const [tried, setTried] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sectionRef = useRef(null);
  const selectRef = useRef(null);
  const appliedNonce = useRef(null);

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

  // "Set up again": choose the report and file type, once per request, as soon as the catalog is here.
  useEffect(() => {
    if (!catalog || !prefill || appliedNonce.current === prefill.nonce) return;
    appliedNonce.current = prefill.nonce;
    const chosen = catalog.datasets.find((item) => item.id === prefill.dataset);
    if (!chosen) return;
    setTried(false);
    setBuilder((current) => {
      const next = selectDataset(current, chosen);
      return catalog.formats.includes(prefill.format) ? { ...next, format: prefill.format } : next;
    });
  }, [catalog, prefill]);

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
  const showDatasetError = tried && !dataset;

  const failMessage = async (error) => {
    const code = await errorCodeOf(error);
    return code ? t(`analyticsDash.generator.errors.${code}`, { defaultValue: t("analyticsDash.generator.failed") }) : t("analyticsDash.generator.failed");
  };

  // A button that is not ready stays focusable (aria-disabled): pressing it shows what is missing.
  const press = (action) => () => {
    if (busy) return;
    if (!ready) {
      setTried(true);
      if (!dataset && selectRef.current) selectRef.current.focus();
      return;
    }
    action();
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

  const generate = async () => {
    setBusy("generate");
    try {
      const response = await adminAPI.generateReportExport(buildRequest(effective, dataset));
      const name = filenameFromDisposition(response.headers?.["content-disposition"], "report");
      const id = response.headers?.["x-report-id"] || name.replace(/\.[a-z]+$/i, "");
      downloadBlob(name, response.data);
      toast.success(t("analyticsDash.generator.done", { id }));
    } catch (error) {
      toast.error(await failMessage(error));
    } finally {
      setBusy("");
    }
  };

  if (catalogFailed) {
    return (
      <section className="an__card" id="report-generator" aria-labelledby="rg-title" ref={sectionRef}>
        <h2 id="rg-title" className="an__h2">{t("adminAnalytics.generator.title")}</h2>
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
  const purposeError = tried && missing.includes("purpose");
  const columnsError = tried && missing.includes("columns");
  const periodError = tried && missing.includes("period");

  return (
    <>
      <section className="an__card rg" id="report-generator" aria-labelledby="rg-title" ref={sectionRef}>
        <div className="rg__head">
          <div>
            <h2 id="rg-title" className="an__h2">{t("adminAnalytics.generator.title")}</h2>
            <p className="an__sub">{t("adminAnalytics.generator.scopeIntro", { scope: scope.text })}</p>
          </div>
          <button type="button" className="an__btn rg__history" aria-haspopup="dialog" onClick={() => setHistoryOpen(true)}>
            <History size={16} aria-hidden="true" />
            {t("adminAnalytics.generator.historyButton")}
          </button>
        </div>

        {!catalog ? (
          <StateBlock kind="loading" title={t("analyticsDash.loading")} />
        ) : (
          <form className="rg__form" noValidate onSubmit={(event) => event.preventDefault()}>
            <div className="rg__fields">
              <div className="an-field rg__report">
                <label htmlFor="rg-dataset">{t("adminAnalytics.generator.report")}</label>
                <select
                  id="rg-dataset"
                  ref={selectRef}
                  value={builder.dataset}
                  aria-invalid={showDatasetError ? "true" : undefined}
                  aria-describedby={showDatasetError ? "rg-dataset-error" : undefined}
                  onChange={(event) => {
                    setTried(false);
                    setBuilder((current) => selectDataset(current, catalog.datasets.find((item) => item.id === event.target.value) || null));
                  }}
                >
                  <option value="">{t("adminAnalytics.generator.choose")}</option>
                  {catalog.datasets.map((item) => <option key={item.id} value={item.id}>{datasetName(item.id)}</option>)}
                </select>
                {showDatasetError && <p id="rg-dataset-error" className="rg__error" role="alert">{t("adminAnalytics.generator.needDataset")}</p>}
              </div>

              <div className="an-field rg__type" role="group" aria-labelledby="rg-format-label">
                <span id="rg-format-label" className="an__plabel">{t("adminAnalytics.generator.fileType")}</span>
                <div className="an__chips">
                  {catalog.formats.map((format) => (
                    <button key={format} type="button" className="an__chip" aria-pressed={builder.format === format} onClick={() => update({ format })}>
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
                {builder.format === "pdf" && pdfCap && <p className="an__note">{t("analyticsDash.generator.pdfCap", { count: pdfCap })}</p>}
              </div>
            </div>

            {dataset && canChooseColumns(dataset, effective) && (
              <div className="rg__block" role="group" aria-labelledby="rg-columns-label" aria-describedby={columnsError ? "rg-columns-error" : undefined}>
                <span id="rg-columns-label" className="an__plabel">{t("adminAnalytics.generator.columns")}</span>
                <div className="rg__columns">
                  {dataset.columns.map((column) => (
                    <label key={column.key} className="rg__check">
                      <input type="checkbox" checked={builder.columns.includes(column.key)} onChange={() => setBuilder((current) => toggleColumn(current, dataset, column.key))} />
                      {column.label}
                    </label>
                  ))}
                </div>
                {columnsError && <p id="rg-columns-error" className="rg__error" role="alert">{t("analyticsDash.generator.needs.columns")}</p>}
              </div>
            )}

            {dataset && dataset.groupings.filter((g) => g !== "none").length > 0 && (
              <div className="an-field rg__group">
                <label htmlFor="rg-grouping">{t("analyticsDash.generator.grouping")}</label>
                <select id="rg-grouping" value={builder.grouping} onChange={(event) => update({ grouping: event.target.value })}>
                  {dataset.groupings.map((value) => <option key={value} value={value}>{t(`analyticsDash.generator.groupings.${value}`, { defaultValue: value })}</option>)}
                </select>
              </div>
            )}

            {dataset && dataset.needsPurpose && (
              <div className="an-field rg__purpose">
                <label htmlFor="rg-purpose">{t("analyticsDash.generator.purpose")}</label>
                <textarea
                  id="rg-purpose"
                  rows={3}
                  maxLength={PURPOSE_MAX}
                  value={builder.purpose}
                  aria-invalid={purposeError ? "true" : undefined}
                  aria-describedby={purposeError ? "rg-purpose-hint rg-purpose-error" : "rg-purpose-hint"}
                  onChange={(event) => update({ purpose: event.target.value })}
                />
                <small id="rg-purpose-hint">
                  {t("analyticsDash.generator.purposeHint", { min: PURPOSE_MIN, max: PURPOSE_MAX })} {t("analyticsDash.generator.purposeCount", { count: builder.purpose.trim().length, max: PURPOSE_MAX })}
                </small>
                {purposeError && <p id="rg-purpose-error" className="rg__error" role="alert">{t("analyticsDash.generator.needs.purpose", { min: PURPOSE_MIN, max: PURPOSE_MAX })}</p>}
              </div>
            )}

            {periodError && <p className="rg__error" role="alert">{t("analyticsDash.generator.needs.period")}</p>}

            <p className="an__note rg__prepared">{t("adminAnalytics.generator.preparedBy", { name: user?.name || "" })}</p>

            <div className="rg__actions">
              <span id="rg-disabled-note" className="ds-sr-only">{!ready ? t("adminAnalytics.generator.disabledNote") : ""}</span>
              <button type="button" className="an__btn rg__preview" aria-disabled={!ready || Boolean(busy)} aria-describedby="rg-disabled-note" onClick={press(runPreview)}>
                {busy === "preview" ? t("analyticsDash.generator.working") : t("analyticsDash.generator.preview")}
              </button>
              <button type="button" className="an__btn an__btn--primary rg__go" aria-disabled={!ready || Boolean(busy)} aria-describedby="rg-disabled-note" onClick={press(generate)}>
                {busy === "generate" ? t("analyticsDash.generator.working") : t("analyticsDash.generator.generate")}
              </button>
            </div>
          </form>
        )}
      </section>

      {historyOpen && (
        <ReportHistoryModal
          onClose={() => setHistoryOpen(false)}
          onSetUp={(item) => {
            // Set up again exports nothing: it prefills this card (and the page's scope), then closes.
            setHistoryOpen(false);
            if (onSetUp) onSetUp(item);
          }}
        />
      )}

      <AppModal isOpen={Boolean(preview)} onClose={() => setPreview(null)} title={t("analyticsDash.generator.previewTitle")} closeLabel={t("common.close", { defaultValue: "Close" })}>
        {preview && (
          <div className="rg__preview">
            <p role="status">{previewMessage}</p>
            <p className="an__note">
              {t("analyticsDash.generator.previewPreparedBy", {
                name: preview.preparedBy.name,
                role: preview.preparedBy.role,
                office: preview.preparedBy.office ? t("analyticsDash.generator.previewOffice", { office: preview.preparedBy.office }) : "",
              })}
            </p>
            {preview.sample.length > 0 && (
              <>
                <h3 className="an__h2">{t("analyticsDash.generator.previewSample", { count: preview.sample.length })}</h3>
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
