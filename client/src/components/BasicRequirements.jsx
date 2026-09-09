import { useMemo } from "react";
import { FaIdCard, FaGraduationCap, FaBriefcase, FaLanguage, FaBolt } from "react-icons/fa";
import "../styles/basic-requirements.css";
import {
  EDUCATION_LEVELS,
  REQUIREMENT_LANGUAGES,
  LANGUAGE_LABELS,
  LANGUAGE_MODES,
} from "../data/jobRequirements";
import { EMPTY_BASIC_REQUIREMENTS, validateBasicRequirements } from "../utils/basicRequirements";

export default function BasicRequirements({ value, onChange, disabled = false }) {
  const form = useMemo(() => ({ ...EMPTY_BASIC_REQUIREMENTS, ...(value || {}) }), [value]);
  const issues = validateBasicRequirements(form);

  const set = (patch) => onChange({ ...form, ...patch });

  const freshGradsWelcome = form.minExperienceYears === "0" || form.minExperienceYears === 0;

  const langEntry = (language) =>
    form.languageRequirements.find((entry) => entry.language === language) || null;

  const toggleLanguage = (language, enabled) => {
    const others = form.languageRequirements.filter((entry) => entry.language !== language);
    set({
      languageRequirements: enabled
        ? [...others, { language, read: false, write: false, speak: false, understand: false, required: true }]
        : others,
    });
  };

  const setLanguageMode = (language, mode, checked) => {
    const entry = langEntry(language);
    if (!entry) {
      // Turning a mode on for a language that isn't required yet also requires it.
      set({
        languageRequirements: [
          ...form.languageRequirements,
          { language, read: false, write: false, speak: false, understand: false, required: true, [mode]: checked },
        ],
      });
      return;
    }
    set({
      languageRequirements: form.languageRequirements.map((item) =>
        item.language === language ? { ...item, [mode]: checked } : item
      ),
    });
  };

  const applyNoFormalRequirements = () => {
    set({
      minEducationLevel: "",
      educationOrEquivalentExperience: false,
      minExperienceYears: "0",
      languageRequirements: [],
    });
  };

  return (
    <div className="br-block">
      <div className="br-block-head">
        <div>
          <h3 className="br-title">Basic eligibility</h3>
          <p className="br-subtitle">
            Age, education and experience gates. Leave a field blank and it simply
            isn&rsquo;t used when matching &mdash; it won&rsquo;t count against anyone.
          </p>
        </div>
        <button
          type="button"
          className="br-quick-btn"
          onClick={applyNoFormalRequirements}
          disabled={disabled}
          title="No education or experience requirement; open to fresh graduates"
        >
          <FaBolt /> No formal requirements
        </button>
      </div>

      <div className="br-cards">
        {/* Age */}
        <div className="br-card">
          <div className="br-card-head">
            <span className="br-card-icon"><FaIdCard /></span>
            <span className="br-card-title">Age range</span>
          </div>
          <div className="br-card-body">
            <div className="br-inline">
              <input
                type="number"
                min="15"
                inputMode="numeric"
                placeholder="Min"
                className="br-num"
                value={form.minAge}
                onChange={(e) => set({ minAge: e.target.value })}
                disabled={disabled}
                aria-label="Minimum age"
              />
              <span className="br-inline-sep">to</span>
              <input
                type="number"
                min="15"
                inputMode="numeric"
                placeholder="Max"
                className="br-num"
                value={form.maxAge}
                onChange={(e) => set({ maxAge: e.target.value })}
                disabled={disabled}
                aria-label="Maximum age"
              />
            </div>
            <p className="br-card-hint">
              Blank = no age limit. A candidate outside this range can&rsquo;t apply.
            </p>
          </div>
        </div>

        {/* Education */}
        <div className="br-card">
          <div className="br-card-head">
            <span className="br-card-icon"><FaGraduationCap /></span>
            <span className="br-card-title">Minimum education</span>
          </div>
          <div className="br-card-body">
            <select
              id="br-education"
              className="br-select"
              value={form.minEducationLevel}
              onChange={(e) => set({ minEducationLevel: e.target.value })}
              disabled={disabled}
              aria-label="Minimum education level"
            >
              <option value="">No minimum / Any</option>
              {EDUCATION_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <label className={`br-check ${!form.minEducationLevel ? "is-muted" : ""}`}>
              <input
                type="checkbox"
                checked={form.educationOrEquivalentExperience}
                onChange={(e) => set({ educationOrEquivalentExperience: e.target.checked })}
                disabled={disabled || !form.minEducationLevel}
              />
              <span>Accept equivalent work experience instead</span>
            </label>
          </div>
        </div>

        {/* Experience */}
        <div className="br-card">
          <div className="br-card-head">
            <span className="br-card-icon"><FaBriefcase /></span>
            <span className="br-card-title">Minimum experience</span>
          </div>
          <div className="br-card-body">
            <div className="br-inline">
              <input
                id="br-experience"
                type="number"
                min="0"
                step="0.5"
                inputMode="decimal"
                placeholder="e.g. 2"
                className="br-num br-num-wide"
                value={freshGradsWelcome ? "" : form.minExperienceYears}
                onChange={(e) => set({ minExperienceYears: e.target.value })}
                disabled={disabled || freshGradsWelcome}
                aria-label="Minimum years of experience"
              />
              <span className="br-inline-sep">years</span>
            </div>
            <label className="br-check">
              <input
                type="checkbox"
                checked={freshGradsWelcome}
                onChange={(e) => set({ minExperienceYears: e.target.checked ? "0" : "" })}
                disabled={disabled}
              />
              <span>Open to fresh graduates / no experience</span>
            </label>
          </div>
        </div>
      </div>

      {/* Language */}
      <div className="br-lang">
        <div className="br-lang-head">
          <span className="br-card-icon"><FaLanguage /></span>
          <span className="br-card-title">Language requirements</span>
        </div>
        <div className="br-lang-cards">
          {REQUIREMENT_LANGUAGES.map((language) => {
            const entry = langEntry(language);
            const on = Boolean(entry);
            return (
              <div key={language} className={`br-lang-card ${on ? "is-on" : ""}`}>
                <div className="br-lang-card-head">
                  <span className="br-lang-name">{LANGUAGE_LABELS[language] || language}</span>
                  <button
                    type="button"
                    className={`br-lang-switch ${on ? "is-on" : ""}`}
                    onClick={() => toggleLanguage(language, !on)}
                    disabled={disabled}
                    aria-pressed={on}
                  >
                    {on ? "Required" : "Not required"}
                  </button>
                </div>
                <div className="br-lang-modes" aria-hidden={!on}>
                  {LANGUAGE_MODES.map((mode) => {
                    const active = Boolean(entry && entry[mode]);
                    return (
                      <button
                        key={mode}
                        type="button"
                        className={`br-pill ${active ? "is-active" : ""}`}
                        onClick={() => setLanguageMode(language, mode, !active)}
                        disabled={disabled}
                      >
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <p className="br-card-hint">
          Turn a language on to require it; leave every mode off to accept any
          proficiency. A blank on the jobseeker&rsquo;s profile counts as unknown,
          never a strike against them.
        </p>
      </div>

      {issues.length > 0 && (
        <ul className="br-issues">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
