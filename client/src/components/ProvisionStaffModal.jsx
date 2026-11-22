import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { FaUserPlus } from "react-icons/fa6";
import AppModal from "./AppModal";
import FormField from "./FormField";
import { useFieldErrors } from "../hooks/useFieldErrors";
import { makeError, mapServerError } from "../utils/formErrors";
import { superadminAPI } from "../services/api";
import { POSITION_PRESETS } from "../constants/staffPositions";
import "../styles/staff-invite.css";

const FIELD_ORDER = ["name", "email", "position", "role"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Staff moderator is stored as the existing admin role. Superadmin is never offered.
const ROLE_OPTIONS = ["staff_moderator"];

// "Provision staff account": the Superadmin enters who the person is; the server
// creates the account pending activation and emails them a one-time link to set
// their own password. No password is created, shown or typed here.
export default function ProvisionStaffModal({ isOpen, onClose, onProvisioned, expiryHours = 48 }) {
  const { t } = useTranslation();
  const formRef = useRef(null);
  const { errors, clearFieldError, replaceErrors, focusFirstInvalid } = useFieldErrors();
  const [form, setForm] = useState({ name: "", email: "", position: "", role: ROLE_OPTIONS[0] });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  // Focus can only move to a field once it is enabled again, after the request ends.
  const focusAfterRequest = useRef(null);

  useEffect(() => {
    if (submitting || !focusAfterRequest.current) return;
    const next = focusAfterRequest.current;
    focusAfterRequest.current = null;
    focusFirstInvalid(FIELD_ORDER, next, formRef.current);
  }, [submitting, focusFirstInvalid]);

  const setField = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    clearFieldError(name);
  };

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = makeError("staffInvite.errors.nameRequired");
    const email = form.email.trim();
    if (!email) next.email = makeError("staffInvite.errors.emailRequired");
    else if (!EMAIL_RE.test(email)) next.email = makeError("staffInvite.errors.emailInvalid");
    if (!form.position.trim()) next.position = makeError("staffInvite.errors.positionRequired");
    return next;
  };

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setFormError("");
    const found = validate();
    replaceErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalid(FIELD_ORDER, found, formRef.current);
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await superadminAPI.createAdmin({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        position: form.position.trim(),
        role: form.role,
      });
      setForm({ name: "", email: "", position: "", role: ROLE_OPTIONS[0] });
      replaceErrors({});
      onProvisioned(data);
    } catch (err) {
      const mapped = mapServerError(err);
      if (mapped.field && FIELD_ORDER.includes(mapped.field)) {
        const next = {
          [mapped.field]: mapped.key ? makeError(mapped.key, mapped.params) : { message: mapped.message },
        };
        replaceErrors(next);
        focusAfterRequest.current = next;
      } else {
        setFormError(mapped.message || t("staffInvite.errors.generic"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={close}
      title={t("staffInvite.form.title")}
      titleId="staff-provision-title"
      describedBy="staff-provision-lead"
      closeLabel={t("staffInvite.form.close")}
      panelClassName="si-modal"
    >
      <p className="si-lead" id="staff-provision-lead">{t("staffInvite.form.lead")}</p>

      {formError ? <div className="si-alert" role="alert">{formError}</div> : null}

      <form className="si-form" onSubmit={submit} noValidate ref={formRef}>
        <FormField id="name" label={t("staffInvite.form.name")} required error={errors.name}>
          <input
            name="name"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder={t("staffInvite.form.namePlaceholder")}
            autoComplete="off"
            maxLength={100}
            disabled={submitting}
          />
        </FormField>

        <FormField
          id="email"
          label={t("staffInvite.form.email")}
          required
          error={errors.email}
          hint={t("staffInvite.form.emailHint")}
        >
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={(e) => setField("email", e.target.value)}
            placeholder={t("staffInvite.form.emailPlaceholder")}
            autoComplete="off"
            disabled={submitting}
          />
        </FormField>

        <FormField id="position" label={t("staffInvite.form.position")} required error={errors.position}>
          <input
            name="position"
            value={form.position}
            onChange={(e) => setField("position", e.target.value)}
            placeholder={t("staffInvite.form.positionPlaceholder")}
            autoComplete="off"
            maxLength={120}
            disabled={submitting}
          />
        </FormField>

        <div className="si-chips" role="group" aria-label={t("staffInvite.form.presetsLabel")}>
          {POSITION_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset}
              className={`si-chip${form.position.trim() === preset ? " is-active" : ""}`}
              aria-pressed={form.position.trim() === preset}
              onClick={() => setField("position", form.position.trim() === preset ? "" : preset)}
              disabled={submitting}
            >
              {preset}
            </button>
          ))}
        </div>

        <FormField id="role" label={t("staffInvite.form.role")} required error={errors.role} hint={t("staffInvite.form.roleHint")}>
          <select name="role" value={form.role} onChange={(e) => setField("role", e.target.value)} disabled={submitting}>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>{t("staffInvite.form.roleStaff")}</option>
            ))}
          </select>
        </FormField>

        <p className="si-note">{t("staffInvite.form.expiryNote", { hours: expiryHours })}</p>

        <div className="si-actions">
          <button type="button" className="si-btn si-btn--ghost" onClick={close} disabled={submitting}>
            {t("staffInvite.form.cancel")}
          </button>
          <button type="submit" className="si-btn si-btn--primary" disabled={submitting}>
            <FaUserPlus aria-hidden="true" /> {submitting ? t("staffInvite.form.submitting") : t("staffInvite.form.submit")}
          </button>
        </div>
      </form>
    </AppModal>
  );
}

ProvisionStaffModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onProvisioned: PropTypes.func.isRequired,
  expiryHours: PropTypes.number,
};
