import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaTriangleExclamation } from "react-icons/fa6";
import { superadminAPI } from "../services/api";

const FORMS = ["form1", "form2"];

const download = (blob, form) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "NSRP-" + form + "-filled-sample.pdf";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const formatDate = (value) => {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
};

function TemplateCard({ form, t }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [meta, setMeta] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const { data } = await superadminAPI.getNsrpTemplateMeta(form);
      setMeta(data);
    } catch {
      setMeta(null);
    } finally {
      setMetaLoading(false);
    }
  }, [form]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const pickFile = (candidate) => {
    if (!candidate) return;
    setFile(candidate);
    setMessage(null);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    if (busy) return;
    pickFile(event.dataTransfer.files?.[0]);
  };

  const run = async (upload) => {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = upload
        ? await superadminAPI.uploadNsrpTemplate(form, file)
        : await superadminAPI.downloadNsrpSample(form);
      download(data, form);
      if (upload) {
        setMessage({ text: t("nsrpTemplates.saved"), error: false });
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        await loadMeta();
      }
    } catch (error) {
      let text = error.response?.data?.message;
      if (error.response?.data instanceof Blob) {
        try {
          text = JSON.parse(await error.response.data.text()).message;
        } catch {
          /* use localized fallback */
        }
      }
      setMessage({ text: text || t("nsrpTemplates.error"), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nts__card">
      <div className="nts__card-head">
        <span className="nts__card-title">{t("nsrpTemplates." + form)}</span>
        <span className="nts__badge">{t("nsrpTemplates.sizeBadge")}</span>
      </div>

      <label
        className={`nts__dropzone${dragOver ? " is-dragover" : ""}${busy ? " is-disabled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          className="nts__dropzone-input"
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <span className="nts__dropzone-text">
          {t("nsrpTemplates.dropHintPrefix")}{" "}
          <span className="nts__dropzone-browse">{t("nsrpTemplates.browse")}</span>
        </span>
        <span className="nts__dropzone-hint">{t("nsrpTemplates." + form + "Hint")}</span>
      </label>

      {file ? (
        <p className="nts__selected">{t("nsrpTemplates.selected")}: {file.name}</p>
      ) : null}

      <p className="nts__current">
        {metaLoading ? (
          <span>…</span>
        ) : meta?.isCustom ? (
          <span>
            {t("nsrpTemplates.currentFile")}: <strong>{meta.filename}</strong>
            {meta.updatedAt ? (
              <span className="nts__current-date">
                {" · "}
                {t("nsrpTemplates.lastUpdated", { date: formatDate(meta.updatedAt) })}
              </span>
            ) : null}
          </span>
        ) : (
          <span>{t("nsrpTemplates.noCustomTemplate")}</span>
        )}
      </p>

      <div className="nts__actions">
        <button type="button" className="sac__primary" disabled={!file || busy} onClick={() => run(true)}>
          {busy ? t("common.loading") : t("nsrpTemplates.upload")}
        </button>
        <button type="button" className="sac__ghost" disabled={busy} onClick={() => run(false)}>
          {t("nsrpTemplates.sample")}
        </button>
      </div>

      {message ? (
        <p className="nts__message" data-error={message.error} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

export default function NsrpTemplateSettings() {
  const { t } = useTranslation();

  return (
    <section className="sac__card nts" aria-labelledby="nsrp-templates-title">
      <header className="nts__head">
        <div>
          <h2 id="nsrp-templates-title">{t("nsrpTemplates.title")}</h2>
          <p className="nts__subtitle">{t("nsrpTemplates.subtitle")}</p>
        </div>
      </header>

      <p className="nts__warning" role="note">
        <FaTriangleExclamation aria-hidden="true" />
        <span>
          <strong>{t("nsrpTemplates.warningTitle")}</strong> {t("nsrpTemplates.warning")}
        </span>
      </p>

      <p className="nts__requirements">{t("nsrpTemplates.requirements")}</p>

      <div className="nts__grid">
        {FORMS.map((form) => (
          <TemplateCard key={form} form={form} t={t} />
        ))}
      </div>
    </section>
  );
}
