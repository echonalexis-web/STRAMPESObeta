import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import AppModal from "./AppModal";
import { addPreferredIndustries, toggleIndustry } from "../utils/industrySelection";
import "../styles/industries-filter-modal.css";

// Draft state lives in the inner body, which only mounts while the dialog is
// open, so closing (Escape, close button, backdrop) discards unapplied
// changes and reopening starts from the applied selection.
function IndustriesBody({ selected, preferred, options, onApply }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(selected);
  const mineId = useId();
  const allId = useId();

  const chip = (industry) => {
    const on = draft.includes(industry);
    return (
      <button
        key={industry}
        type="button"
        className={`ifm-chip ${on ? "active" : ""}`}
        aria-pressed={on}
        onClick={() => setDraft((list) => toggleIndustry(list, industry))}
      >
        {industry}
      </button>
    );
  };

  return (
    <>
      <div className="ifm-body">
        <fieldset className="ifm-group" aria-labelledby={mineId}>
          <legend className="ifm-legend" id={mineId}>{t("jobBoard.industries.mine")}</legend>
          {preferred.length > 0 ? (
            <>
              <div className="ifm-chips">{preferred.map(chip)}</div>
              <button
                type="button"
                className="ifm-link"
                onClick={() => setDraft((list) => addPreferredIndustries(list, preferred))}
              >
                {t("jobBoard.industries.selectMine")}
              </button>
            </>
          ) : (
            <p className="ifm-hint">{t("jobBoard.industries.noneHint")}</p>
          )}
        </fieldset>

        <fieldset className="ifm-group" aria-labelledby={allId}>
          <legend className="ifm-legend" id={allId}>{t("jobBoard.industries.all")}</legend>
          <div className="ifm-chips">
            <button
              type="button"
              className={`ifm-chip ${draft.length === 0 ? "active" : ""}`}
              aria-pressed={draft.length === 0}
              onClick={() => setDraft([])}
            >
              {t("jobBoard.industries.allIndustries")}
            </button>
            {options.map(chip)}
          </div>
        </fieldset>
      </div>

      <div className="ifm-footer">
        <button type="button" className="ds-btn ds-btn--secondary" onClick={() => setDraft([])}>
          {t("jobBoard.industries.clear")}
        </button>
        <button type="button" className="ds-btn ds-btn--primary" onClick={() => onApply(draft)}>
          {t("jobBoard.industries.apply")}
        </button>
      </div>
    </>
  );
}

export default function IndustriesFilterModal({ isOpen, onClose, selected, preferred, options, onApply }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("jobBoard.industries.title")}
      titleId={titleId}
      closeLabel={t("jobBoard.industries.close")}
      panelClassName="ifm-card"
    >
      <IndustriesBody
        selected={selected}
        preferred={preferred}
        options={options}
        onApply={onApply}
      />
    </AppModal>
  );
}
