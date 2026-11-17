import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import FormField from "./FormField";
import { DEFAULT_PHONE_ISO } from "../constants/phoneCountries";
import {
  countryByIso,
  formatNational,
  interpretPaste,
  parsePhone,
  phoneExample,
  sanitizeNational,
  searchCountries,
  splitStored,
} from "../utils/phoneIntl";

// Country calling code (left) + number (right). Philippines (+63) is always the
// default. The control reports E.164 ("+639171234567") through onChange when the
// number parses, "" when empty, and "+<dial><digits>" while it is still partial,
// so the form can show the exact problem. It never calls onChange on mount: an
// untouched legacy value stays exactly as stored.
export default function PhoneInput({
  id,
  name,
  label,
  value,
  onChange,
  error,
  required = false,
  disabled = false,
  allowLandline = false,
  autoFocus = false,
}) {
  const { t } = useTranslation();
  const listboxId = useId();
  const [state, setState] = useState(() => splitStored(value, DEFAULT_PHONE_ISO));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [badChars, setBadChars] = useState(false);
  // The last value this control sent up. A different value arriving from the
  // parent (draft restored, account loaded, or a parent that refused our value)
  // replaces the control's state; our own values do not loop back.
  const [emitted, setEmitted] = useState(value ?? "");
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const searchRef = useRef(null);

  const incoming = value ?? "";
  if (incoming !== emitted) {
    setEmitted(incoming);
    setState(splitStored(incoming, DEFAULT_PHONE_ISO));
  }

  const country = countryByIso(state.iso);
  const results = useMemo(() => searchCountries(query), [query]);

  const emit = useCallback((next) => {
    let out = "";
    if (next.national) {
      const parsed = parsePhone(`+${countryByIso(next.iso).dial}${next.national}`, { allowLandline });
      out = parsed.ok ? parsed.e164 : `+${countryByIso(next.iso).dial}${next.national}`;
    }
    setEmitted(out);
    onChange(out);
  }, [allowLandline, onChange]);

  const apply = (next) => {
    setState(next);
    emit(next);
  };

  const handleInput = (event) => {
    const raw = event.target.value;
    if (raw.trim().startsWith("+")) {
      const pasted = interpretPaste(raw, state.iso, allowLandline);
      setBadChars(pasted.rejected);
      apply({ iso: pasted.iso, national: pasted.national });
      return;
    }
    setBadChars(/[^0-9+\-\s()]/.test(raw));
    apply({ iso: state.iso, national: sanitizeNational(raw, state.iso, allowLandline) });
  };

  const handlePaste = (event) => {
    const text = event.clipboardData?.getData("text") ?? "";
    event.preventDefault();
    const pasted = interpretPaste(text, state.iso, allowLandline);
    setBadChars(pasted.rejected);
    apply({ iso: pasted.iso, national: pasted.national });
  };

  const choose = (iso) => {
    setOpen(false);
    setQuery("");
    setBadChars(false);
    // Keep the digits, re-cap them for the new country.
    apply({ iso, national: sanitizeNational(state.national, iso, allowLandline) });
    buttonRef.current?.focus();
  };

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onSearchKey = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(results.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (results[active]) choose(results[active].iso);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const example = phoneExample(state.iso);
  const hint = badChars ? t("phoneInput.errors.badChars") : example ? t("phoneInput.example", { example }) : t("phoneInput.hintOther");
  const activeId = results[active] ? `${listboxId}-${results[active].iso}` : undefined;

  return (
    <FormField
      id={id}
      label={label || t("phoneInput.mobileLabel")}
      required={required}
      hint={hint}
      error={error}
      className="phone-input"
      renderControl={(aria) => (
        <div className="phone-input__row" ref={wrapRef}>
          <div className="phone-input__country">
            <button
              type="button"
              ref={buttonRef}
              className="phone-input__country-btn"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={open ? listboxId : undefined}
              aria-label={`${t("phoneInput.countryLabel")}: ${country.name} +${country.dial}`}
              onClick={() => { setOpen((v) => !v); setActive(0); }}
              disabled={disabled}
            >
              <span aria-hidden="true">{country.iso} +{country.dial}</span>
              <span className="phone-input__caret" aria-hidden="true" />
            </button>
            {open ? (
              <div className="phone-input__panel">
                <input
                  ref={searchRef}
                  type="search"
                  role="combobox"
                  className="phone-input__search"
                  aria-expanded="true"
                  aria-controls={listboxId}
                  aria-activedescendant={activeId}
                  aria-autocomplete="list"
                  aria-label={t("phoneInput.searchPlaceholder")}
                  placeholder={t("phoneInput.searchPlaceholder")}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                  onKeyDown={onSearchKey}
                  autoComplete="off"
                />
                <ul id={listboxId} role="listbox" aria-label={t("phoneInput.countryLabel")} className="phone-input__list">
                  {results.length === 0 ? (
                    <li className="phone-input__empty" role="presentation">{t("phoneInput.noResults")}</li>
                  ) : results.map((c, index) => (
                    <li
                      key={c.iso}
                      id={`${listboxId}-${c.iso}`}
                      role="option"
                      aria-selected={c.iso === state.iso}
                      className={`phone-input__option ${index === active ? "is-active" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); choose(c.iso); }}
                      onMouseEnter={() => setActive(index)}
                    >
                      <span>{c.name}</span>
                      <span className="phone-input__dial">+{c.dial}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <input
            {...aria}
            name={name}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            className="phone-input__number"
            value={formatNational(state.iso, state.national)}
            onChange={handleInput}
            onPaste={handlePaste}
            maxLength={state.iso === "PH" ? 12 : 20}
            disabled={disabled}
            autoFocus={autoFocus}
          />
        </div>
      )}
    />
  );
}

PhoneInput.propTypes = {
  id: PropTypes.string.isRequired,
  name: PropTypes.string,
  label: PropTypes.node,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  error: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  required: PropTypes.bool,
  disabled: PropTypes.bool,
  allowLandline: PropTypes.bool,
  autoFocus: PropTypes.bool,
};
