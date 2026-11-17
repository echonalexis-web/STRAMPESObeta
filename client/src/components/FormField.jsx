import { cloneElement, isValidElement } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { messageFor } from "../utils/formErrors";

const ErrorIcon = ({ label }) => (
  <svg className="ds-field__error-icon" viewBox="0 0 16 16" role="img" aria-label={label} focusable="false">
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.2v4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="8" cy="11.3" r="0.95" fill="currentColor" />
  </svg>
);
ErrorIcon.propTypes = { label: PropTypes.string };

// Just the error row, for forms whose markup already wraps the control in a
// <label>. Pair it with ariaFor(errors, name) from utils/formErrors on the control.
export function FieldError({ id, error }) {
  const { t } = useTranslation();
  const message = messageFor(error, t);
  if (!message) return null;
  return (
    <p className="ds-field__error" id={`${id}-error`}>
      <ErrorIcon label={t("formErrors.errorIcon")} />
      <span>{message}</span>
    </p>
  );
}
FieldError.propTypes = {
  id: PropTypes.string.isRequired,
  error: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
};

// Label + control + hint + specific error. The control (a single child element)
// receives id, aria-invalid and aria-describedby. `error` is a string or an
// error entry ({ key, params }) from formErrors.js.
export default function FormField({ id, label, required = false, hint, error, className = "", renderControl, children }) {
  const { t } = useTranslation();
  const message = messageFor(error, t);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [message ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const ariaProps = {
    id,
    "aria-invalid": message ? "true" : undefined,
    "aria-describedby": describedBy,
    "aria-required": required ? "true" : undefined,
  };

  // `renderControl(ariaProps)` is for composite controls (country + number): the
  // caller puts the aria props on the one control that should carry them.
  let control = children;
  if (typeof renderControl === "function") control = renderControl(ariaProps);
  else if (isValidElement(children)) control = cloneElement(children, ariaProps);

  return (
    <div className={`ds-field ${message ? "ds-field--invalid" : ""} ${className}`.trim()}>
      {label ? (
        <label className="ds-field__label" htmlFor={id}>
          {label}
          {required ? <span className="ds-field__required" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {control}
      {hint ? <span className="ds-field__hint" id={hintId}>{hint}</span> : null}
      {message ? (
        <p className="ds-field__error" id={errorId}>
          <ErrorIcon label={t("formErrors.errorIcon")} />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}

FormField.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.node,
  required: PropTypes.bool,
  hint: PropTypes.node,
  error: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  className: PropTypes.string,
  renderControl: PropTypes.func,
  children: PropTypes.node,
};

// Checkbox, radio and pill-button groups: group-level error.
export function FieldGroup({ id, legend, error, hint, radio = false, className = "", children }) {
  const { t } = useTranslation();
  const message = messageFor(error, t);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [message ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`ds-field ${message ? "ds-field--invalid" : ""} ${className}`.trim()}>
      {legend ? <span className="ds-field__label" id={`${id}-legend`}>{legend}</span> : null}
      <div
        id={id}
        role={radio ? "radiogroup" : "group"}
        aria-labelledby={legend ? `${id}-legend` : undefined}
        aria-invalid={message ? "true" : undefined}
        aria-describedby={describedBy}
        tabIndex={message ? -1 : undefined}
      >
        {children}
      </div>
      {hint ? <span className="ds-field__hint" id={hintId}>{hint}</span> : null}
      {message ? (
        <p className="ds-field__error" id={errorId}>
          <ErrorIcon label={t("formErrors.errorIcon")} />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}

FieldGroup.propTypes = {
  id: PropTypes.string.isRequired,
  legend: PropTypes.node,
  error: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  hint: PropTypes.node,
  radio: PropTypes.bool,
  className: PropTypes.string,
  children: PropTypes.node,
};
