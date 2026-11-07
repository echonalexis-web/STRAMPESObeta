import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSocket } from "../context/SocketContext";
import { authAPI } from "../services/api";
import "../styles/idOcr.css";

export function IdNumberHint({ type, number }) {
  const { t } = useTranslation();
  const [formats, setFormats] = useState({});
  useEffect(() => {
    let alive = true;
    authAPI.getIdFormats().then(({ data }) => { if (alive) setFormats(data.formats || {}); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const format = formats[type];
  if (!format) return null;
  return <small>
    {format.hint}
    {number && !new RegExp(format.pattern).test(number.trim().toUpperCase()) && <span role="status"> {t("settings.account.idOcr.formatWarning")}</span>}
  </small>;
}

export function IdOcrSummary({ ocr }) {
  const { t } = useTranslation();
  if (!ocr || ocr.status === "none") return null;
  return <div className="id-ocr" aria-live="polite">
    <strong>{t("settings.account.idOcr.title")}</strong>
    <p>{t(`settings.account.idOcr.status.${ocr.status}`)}</p>
    <p>{t("settings.account.idOcr.disclaimer")}</p>
    {ocr.failureReason && <p>{t(`settings.account.idOcr.reason.${ocr.failureReason}`)}</p>}
    {ocr.extracted && <dl className="id-ocr-grid">{Object.entries(ocr.extracted).filter(([, value]) => value).map(([key, value]) =>
      <div key={key}><dt>{t(`settings.account.idOcr.fields.${key}`)}</dt><dd>{String(value).replace(/T00:00:00.000Z$/, "")}</dd></div>
    )}</dl>}
    {ocr.checks && <div className="id-ocr-checks">{Object.entries(ocr.checks).map(([key, value]) =>
      <span className="id-ocr-badge" key={key}>{t(`settings.account.idOcr.checks.${key}`)}: {value == null ? t("settings.account.idOcr.unknown") : typeof value === "number" ? `${Math.round(value * 100)}%` : t(`settings.account.idOcr.${value ? "yes" : "no"}`)}</span>
    )}</div>}
  </div>;
}

export default function IdOcrReview({ initialOcr, onConfirmed }) {
  const { t } = useTranslation();
  const { socket } = useSocket();
  const [ocr, setOcr] = useState(initialOcr);
  const [formats, setFormats] = useState({});
  const [type, setType] = useState("");
  const [number, setNumber] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const suggestionRun = useRef(null);
  useEffect(() => {
    let alive = true;
    let timer;
    let attempts = 0;
    let fetching = false;
    const apply = (value) => {
      if (!alive) return;
      setOcr(value);
      // Reconnects refresh status without discarding the user's edited fields.
      if (value?.status === "done" && value.runId !== suggestionRun.current) {
        suggestionRun.current = value.runId;
        setType(value.extracted?.detectedType || ""); setNumber(value.extracted?.idNumber || "");
      }
    };
    const refresh = async () => {
      clearTimeout(timer);
      if (fetching) return;
      fetching = true;
      try {
        const { data } = await authAPI.getProfile();
        if (!alive) return;
        apply(data.user?.governmentIdOcr);
        if (["queued", "processing"].includes(data.user?.governmentIdOcr?.status)) {
          if (++attempts < 30) timer = setTimeout(refresh, 4000);
          else setOcr({ ...data.user.governmentIdOcr, status: "failed", failureReason: "processing_failed" });
        }
      } catch { /* A later visit or socket reconnect retries. */ }
      finally { fetching = false; }
    };
    const receive = (data) => { clearTimeout(timer); apply(data.governmentIdOcr); };
    authAPI.getIdFormats().then(({ data }) => { if (alive) setFormats(data.formats || {}); }).catch(() => {});
    refresh(); socket?.on("id:ocr:done", receive); socket?.on("connect", refresh);
    return () => { alive = false; clearTimeout(timer); socket?.off("id:ocr:done", receive); socket?.off("connect", refresh); };
  }, [socket, initialOcr?.runId]);
  if (!ocr || ocr.status === "none") return null;
  const hint = formats[type]?.hint;
  const formatMismatch = number && formats[type]?.pattern && !new RegExp(formats[type].pattern).test(number.trim().toUpperCase());
  const confirm = async () => {
    setSaving(true); setError("");
    try {
      const { data } = await authAPI.confirmIdOcr({ runId: ocr.runId, governmentIdType: type, governmentIdNumber: number });
      setOcr(data.user.governmentIdOcr); onConfirmed?.(data.user);
    } catch { setError(t("settings.account.idOcr.saveError")); }
    finally { setSaving(false); }
  };
  return <section className="id-ocr">
    <IdOcrSummary ocr={ocr} />
    {ocr.status === "done" && !ocr.confirmedAt && <>
      <p>{t("settings.account.idOcr.confirmHint")}</p>
      <div className="id-ocr-grid">
        <label>{t("settings.account.idOcr.fields.detectedType")}<select value={type} onChange={(e) => setType(e.target.value)}><option value="">{t("settings.account.idOcr.selectType")}</option>{Object.keys(formats).map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>{t("settings.account.idOcr.fields.idNumber")}<input value={number} maxLength={80} onChange={(e) => setNumber(e.target.value)} />{hint && <small>{hint}</small>}</label>
      </div>
      {formatMismatch && <p>{t("settings.account.idOcr.formatWarning")}</p>}
      <button type="button" className="set-btn set-btn--primary" disabled={saving || !type || !number.trim()} onClick={confirm}>{t(`settings.account.idOcr.${saving ? "saving" : "confirm"}`)}</button>
    </>}
    {ocr.confirmedAt && <p role="status">{t("settings.account.idOcr.confirmed")}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
