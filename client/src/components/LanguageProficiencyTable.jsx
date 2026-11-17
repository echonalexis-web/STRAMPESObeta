import { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import {
  LANGUAGE_ROWS,
  LANGUAGE_SKILL_KEYS,
  rowState,
  setRow,
  toggleSkill,
  nextAllChecked,
} from "../utils/languageProficiency";

// "All" checkbox: partly ticked rows show the native indeterminate state.
function AllCheckbox({ row, label, disabled, onToggle }) {
  const ref = useRef(null);
  const state = rowState(row);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <label className="lang-prof__hit">
      <input
        ref={ref}
        type="checkbox"
        className="lang-prof__all"
        aria-label={label}
        checked={state === "all"}
        onChange={onToggle}
        disabled={disabled}
      />
    </label>
  );
}
AllCheckbox.propTypes = {
  row: PropTypes.object,
  label: PropTypes.string.isRequired,
  disabled: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
};

// One table for onboarding and Edit profile. Each language row has an "All"
// checkbox for Read, Write, Speak and Understand. Below 480px every language is
// a stacked card so six columns never need a sideways scroll.
export default function LanguageProficiencyTable({ value, othersLabel, onChange, onOthersLabelChange, disabled = false }) {
  const { t } = useTranslation();
  const skillLabel = (key) => t(`langTable.${key}`);

  return (
    <div className="lang-prof">
      <table className="lang-prof__table">
        <caption className="lang-prof__caption">{t("langTable.caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("langTable.language")}</th>
            <th scope="col">{t("langTable.all")}</th>
            {LANGUAGE_SKILL_KEYS.map((key) => <th key={key} scope="col">{skillLabel(key)}</th>)}
          </tr>
        </thead>
        <tbody>
          {LANGUAGE_ROWS.map((language) => {
            const row = value?.[language] || {};
            const isOthers = language === "Others";
            const name = isOthers ? (othersLabel?.trim() || t("langTable.otherLanguage")) : language;
            return (
              <tr key={language}>
                <th scope="row" className="lang-prof__name">
                  {isOthers ? (
                    <input
                      type="text"
                      placeholder={t("langTable.othersPlaceholder")}
                      aria-label={t("langTable.othersPlaceholder")}
                      value={othersLabel || ""}
                      onChange={(e) => onOthersLabelChange(e.target.value)}
                      disabled={disabled}
                    />
                  ) : language}
                </th>
                <td data-label={t("langTable.all")} className="lang-prof__cell">
                  <AllCheckbox
                    row={row}
                    label={t("langTable.allFor", { language: name })}
                    disabled={disabled}
                    onToggle={() => onChange(setRow(value, language, nextAllChecked(row)))}
                  />
                </td>
                {LANGUAGE_SKILL_KEYS.map((key) => (
                  <td key={key} data-label={skillLabel(key)} className="lang-prof__cell">
                    <label className="lang-prof__hit">
                      <input
                        type="checkbox"
                        aria-label={`${name} — ${skillLabel(key)}`}
                        checked={Boolean(row[key])}
                        onChange={() => onChange(toggleSkill(value, language, key))}
                        disabled={disabled}
                      />
                    </label>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

LanguageProficiencyTable.propTypes = {
  value: PropTypes.object.isRequired,
  othersLabel: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onOthersLabelChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};
