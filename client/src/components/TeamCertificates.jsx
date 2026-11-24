import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildCertificateRows, expiryInfo, formatCertDate } from "../utils/teamCertificates";

const VISIBLE_ROWS = 5;

// Only http(s) links are rendered, so a typo in the data can never produce a javascript: URL.
const safeUrl = (url) => (/^https?:\/\//i.test(String(url || "")) ? url : null);

function CertDetails({ cert }) {
  const { t } = useTranslation();
  const expiry = expiryInfo(cert.expires);
  const url = safeUrl(cert.credential);
  if (!expiry && !url) return null;
  return (
    <span className="tp-cert__extra">
      {expiry?.kind === "expires" && <span>{t("teamProfile.expires", { date: expiry.text })}</span>}
      {expiry?.kind === "expired" && <span className="tp-cert__expired">{t("teamProfile.expired")}</span>}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {t("teamProfile.viewCredential")}
        </a>
      )}
    </span>
  );
}

function CertItem({ cert, showIssuer }) {
  return (
    <li className="tp-cert">
      <div className="tp-cert__main">
        <span className="tp-cert__title">{cert.name}</span>
        {showIssuer && cert.issuer && <span className="tp-cert__issuer">{cert.issuer}</span>}
        <CertDetails cert={cert} />
      </div>
      {cert.year && <span className="tp-pill">{formatCertDate(cert.year)}</span>}
    </li>
  );
}

function CertGroup({ group }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const label = [group.issuer, t("teamProfile.certificate", { count: group.items.length }), group.range]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="tp-cert-group">
      <button type="button" className="tp-cert-group__btn" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <span className="tp-cert-group__label">{label}</span>
        <span className="tp-cert-group__toggle">{open ? t("teamProfile.hide") : t("teamProfile.showAll")}</span>
      </button>
      <ul id={panelId} className="tp-cert-group__list" hidden={!open}>
        {group.items.map((cert, i) => <CertItem key={`${cert.name}-${i}`} cert={cert} showIssuer={false} />)}
      </ul>
    </li>
  );
}

export default function TeamCertificates({ certificates }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const rows = useMemo(() => buildCertificateRows(certificates), [certificates]);
  const shown = all ? rows : rows.slice(0, VISIBLE_ROWS);
  const hidden = rows.length - shown.length;
  return (
    <>
      <ul className="tp-cert-list">
        {shown.map((row, i) =>
          row.type === "group" ? (
            <CertGroup key={`g-${row.issuer}`} group={row} />
          ) : (
            <CertItem key={`s-${row.cert.name}-${i}`} cert={row.cert} showIssuer />
          )
        )}
      </ul>
      {hidden > 0 && (
        <button type="button" className="tp-btn tp-btn--ghost tp-more" onClick={() => setAll(true)}>
          {t("teamProfile.showMore", { count: hidden })}
        </button>
      )}
    </>
  );
}
