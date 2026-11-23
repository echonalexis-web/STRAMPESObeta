import { forwardRef } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { FaArrowLeft, FaCheck } from "react-icons/fa";

// Save status is words, never colour alone, and announced politely (role="status").
function Status({ text }) {
  return (
    <p className="stu-status" role="status" aria-live="polite">
      {text}
    </p>
  );
}
Status.propTypes = { text: PropTypes.string.isRequired };

// The sticky bar of the applying flow: Back, what is being applied to, the save status and ONE
// primary button; below it the three steps. On phones the Back and primary controls pin to the
// bottom of the screen (CSS only: one set of controls, never two).
export const ApplyingBar = forwardRef(function ApplyingBar(
  { t, jobTitle, employer, statusText, steps, activeStep, onStep, onBack, primaryLabel, onPrimary, busy, error, errorId },
  ref
) {
  const activeIndex = steps.findIndex((step) => step.key === activeStep);
  return (
    <header className="stu-bar stu-bar--applying" ref={ref}>
      <div className="stu-bar__row">
        <div className="stu-bar__nav">
          <button type="button" className="stu-btn stu-btn--secondary" onClick={onBack}>
            <FaArrowLeft aria-hidden="true" size={12} /> {t("studio.back")}
          </button>
        </div>
        <div className="stu-bar__title">
          <p className="stu-bar__eyebrow">{t("studio.applyingTo")}</p>
          <p className="stu-bar__job">
            {jobTitle}
            {employer ? <span className="stu-bar__employer"> · {employer}</span> : null}
          </p>
        </div>
        <ol className="stu-steps" aria-label={t("studio.stepsLabel")}>
          {steps.map((step, index) => {
            const passed = index < activeIndex;
            return (
              <li key={step.key} className="stu-steps__item">
                <button
                  type="button"
                  className={`stu-step${step.key === activeStep ? " is-active" : ""}${passed ? " is-done" : ""}`}
                  aria-current={step.key === activeStep ? "step" : undefined}
                  onClick={() => onStep(step.key)}
                >
                  <span className="stu-step__num" aria-hidden="true">
                    {passed ? <FaCheck size={10} /> : index + 1}
                  </span>
                  <span>
                    {step.label}
                    {passed ? <span className="stu-sr"> ({t("studio.stepDone")})</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <Status text={statusText} />
        <div className="stu-bar__primary">
          <button
            type="button"
            className="stu-btn stu-btn--primary"
            onClick={onPrimary}
            aria-disabled={busy || undefined}
            aria-describedby={error ? errorId : undefined}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
      {error ? (
        <p className="stu-bar__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </header>
  );
});
ApplyingBar.propTypes = {
  t: PropTypes.func.isRequired,
  jobTitle: PropTypes.string.isRequired,
  employer: PropTypes.string,
  statusText: PropTypes.string.isRequired,
  steps: PropTypes.arrayOf(PropTypes.shape({ key: PropTypes.string, label: PropTypes.string })).isRequired,
  activeStep: PropTypes.string.isRequired,
  onStep: PropTypes.func.isRequired,
  onBack: PropTypes.func.isRequired,
  primaryLabel: PropTypes.string.isRequired,
  onPrimary: PropTypes.func.isRequired,
  busy: PropTypes.bool,
  error: PropTypes.string,
  errorId: PropTypes.string,
};

// The sticky header of the Profile version: breadcrumb, title, Resume | Cover letter switch, the
// save status and one primary button.
export const ProfileBar = forwardRef(function ProfileBar(
  { t, mode, onMode, statusText, primaryLabel, onPrimary, busy, error, errorId },
  ref
) {
  return (
    <header className="stu-bar stu-bar--profile" ref={ref}>
      <div className="stu-bar__row">
        <div className="stu-bar__title">
          <nav className="stu-crumb" aria-label="Breadcrumb">
            <Link to="/profile">{t("studio.crumbProfile")}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{t("studio.crumbStudio")}</span>
          </nav>
          <h1 className="stu-bar__h1">{t("studio.title")}</h1>
        </div>
        <div className="stu-segment" role="group" aria-label={t("studio.documentSwitch")} style={{ "--i": mode === "coverLetter" ? 1 : 0 }}>
          {[
            { key: "resume", label: t("studio.modeResume") },
            { key: "coverLetter", label: t("studio.modeLetter") },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              className={`stu-segment__option${mode === option.key ? " is-selected" : ""}`}
              aria-pressed={mode === option.key}
              onClick={() => onMode(option.key)}
            >
              {mode === option.key ? <FaCheck size={11} aria-hidden="true" /> : null} {option.label}
            </button>
          ))}
        </div>
        <Status text={statusText} />
        <div className="stu-bar__primary">
          <button
            type="button"
            className="stu-btn stu-btn--primary"
            onClick={onPrimary}
            aria-disabled={busy || undefined}
            aria-describedby={error ? errorId : undefined}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
      {error ? (
        <p className="stu-bar__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </header>
  );
});
ProfileBar.propTypes = {
  t: PropTypes.func.isRequired,
  mode: PropTypes.string.isRequired,
  onMode: PropTypes.func.isRequired,
  statusText: PropTypes.string.isRequired,
  primaryLabel: PropTypes.string.isRequired,
  onPrimary: PropTypes.func.isRequired,
  busy: PropTypes.bool,
  error: PropTypes.string,
  errorId: PropTypes.string,
};
