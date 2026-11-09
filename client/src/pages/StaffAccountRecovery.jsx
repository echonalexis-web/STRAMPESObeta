import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { staffRecoveryAPI } from "../services/api";
import "../styles/auth.css";
import "../styles/username-signup.css";
import "../styles/idOcr.css";
import { isUsernameSignupEnabled } from "../utils/usernameSignup";
import { phoneProblem } from "../utils/phone";

export default function StaffAccountRecovery() {
  const { t } = useTranslation();
  const [links] = useState(() => Object.fromEntries(new URLSearchParams(window.location.search)));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [files, setFiles] = useState({});
  // With username sign-up on, a person with no email can give a phone as the contact.
  // Nothing is texted: staff finish the recovery in person at the PESO office.
  const phoneOption = isUsernameSignupEnabled();
  const [contactMethod, setContactMethod] = useState("email");
  const usePhone = phoneOption && contactMethod === "phone";
  const [form, setForm] = useState({ identifier: "", fullName: "", dateOfBirth: "", contactEmail: "", contactPhone: "", phone: "", lastKnownAddress: "", idTypeDeclared: "", idNumberDeclared: "" });
  const verification = useRef(null);
  useEffect(() => {
    // Remove bearer capabilities from history/referrers without persisting them.
    if (links.contactToken || links.recoveryToken) window.history.replaceState(null, "", window.location.pathname);
  }, [links]);
  const verify = async () => {
    setSaving(true); setError("");
    try {
      // Reuse an in-flight promise so repeated clicks cannot consume the token twice.
      verification.current ||= staffRecoveryAPI.verifyContact(links.contactToken);
      await verification.current; setMessage(t("staffRecovery.contactConfirmed")); setCompleted(true);
    } catch { setError(t("staffRecovery.error")); verification.current = null; }
    finally { setSaving(false); }
  };
  const submit = async (event) => {
    event.preventDefault(); setError("");
    if (links.recoveryToken && password !== confirm) { setError(t("staffRecovery.passwordMismatch")); return; }
    setSaving(true);
    try {
      if (links.recoveryToken) {
        await staffRecoveryAPI.finish(links.recoveryToken, password);
        setMessage(t("staffRecovery.finished"));
      } else {
        if (usePhone && phoneProblem(form.contactPhone)) { setError(t("errors.codes.PHONE_INVALID")); setSaving(false); return; }
        const payload = new FormData();
        Object.entries(form).forEach(([key, value]) => {
          // Send only the contact that applies.
          if (key === "contactEmail" && usePhone) return;
          if (key === "contactPhone" && !usePhone) return;
          payload.append(key, value);
        });
        if (usePhone) payload.append("contactMethod", "phone");
        Object.entries(files).forEach(([key, value]) => { if (value) payload.append(key, value); });
        await staffRecoveryAPI.submit(payload);
        setMessage(t(usePhone ? "recoveryPhone.submitted" : "staffRecovery.received"));
      }
      setCompleted(true); setPassword(""); setConfirm(""); setFiles({});
    } catch { setError(t("staffRecovery.error")); }
    finally { setSaving(false); }
  };
  return <div className="auth-container"><div className="auth-panel"><main className="auth-card staff-recovery-card">
    <h1>{t("staffRecovery.title")}</h1><p>{t("staffRecovery.policy")}</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!completed && (links.contactToken ? <button className="auth-button" disabled={saving} onClick={verify}>{t("staffRecovery.verifyContact")}</button> : <form onSubmit={submit}>
      {links.recoveryToken ? <>
        <p>{t("staffRecovery.finishHint")}</p>
        <label>{t("staffRecovery.newPassword")}<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label>{t("staffRecovery.confirmPassword")}<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      </> : <>
        {phoneOption && <fieldset className="su-mode" style={{ border: 0, margin: 0 }}><legend className="su-mode__legend">{t("recoveryPhone.contactMethodLabel")}</legend>
          <button type="button" className="su-mode__btn" aria-pressed={!usePhone} onClick={() => setContactMethod("email")}>{t("recoveryPhone.methodEmail")}</button>
          <button type="button" className="su-mode__btn" aria-pressed={usePhone} onClick={() => setContactMethod("phone")}>{t("recoveryPhone.methodPhone")}</button></fieldset>}
        {usePhone && <p className="su-hint">{t("recoveryPhone.contactPhoneHint")}</p>}
        <div className="id-ocr-grid">{Object.entries(form).filter(([key]) => (key === "contactEmail" ? !usePhone : key === "contactPhone" ? usePhone : true)).map(([key, value]) => <label key={key}>{t(`staffRecovery.fields.${key}`)}<input type={key === "dateOfBirth" ? "date" : key === "contactEmail" ? "email" : key === "contactPhone" ? "tel" : "text"} required={["identifier", "fullName", "dateOfBirth", "contactEmail", "contactPhone"].includes(key)} maxLength={key === "lastKnownAddress" ? 500 : 254} value={value} onChange={(e) => setForm((previous) => ({ ...previous, [key]: e.target.value }))} /></label>)}</div>
        <p>{t("staffRecovery.filesHint")}</p>
        {["governmentIdFile", "selfieFile"].map((key) => <label className="form-group" key={key}>{t(`staffRecovery.fields.${key}`)}<input type="file" required accept={key === "selfieFile" ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,application/pdf"} onChange={(e) => setFiles((previous) => ({ ...previous, [key]: e.target.files[0] }))} /></label>)}
      </>}
      <button type="submit" className="auth-button" disabled={saving}>{t(`staffRecovery.${saving ? "saving" : links.recoveryToken ? "finish" : "submit"}`)}</button>
    </form>)}
    <p><Link to="/login">{t("staffRecovery.back")}</Link></p>
  </main></div></div>;
}
