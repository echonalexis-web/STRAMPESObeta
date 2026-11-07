import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSecureFileUrl } from "../hooks/useSecureFileUrl";
import SecureFileLink from "./SecureFileLink";

export default function IdEvidence({ value, label }) {
  const { t } = useTranslation();
  const { resolve, loading } = useSecureFileUrl(value);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(false);
  if (!value) return <p>{t("staffRecovery.noDocument")}</p>;
  return <div className="id-evidence">
    <SecureFileLink value={value}>{label}</SecureFileLink>{" "}
    <button type="button" disabled={loading} onClick={async () => { setError(false); const url = await resolve(); if (url) setPreview(url); else setError(true); }}>{t("staffRecovery.preview")}</button>
    {preview && <img src={preview} alt={label} onError={() => { setPreview(null); setError(true); }} />}
    {error && <p role="status">{t("staffRecovery.previewHint")}</p>}
  </div>;
}
