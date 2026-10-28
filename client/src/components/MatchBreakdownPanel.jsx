import { Link } from "react-router-dom";
import { DIMENSION_ORDER, DIMENSION_LABELS, DIMENSION_PROFILE_TAB } from "../utils/qualifications";
import "../styles/match-breakdown.css";

/**
 * Per-dimension "why this match?" breakdown — shared by the job detail page
 * (§A.3) and the employer's applicant review modal (§B.4), so the reasoning
 * behind a match percentage is never only a hover tooltip.
 *
 * A dimension missing from `breakdown` means the engine had no usable data
 * for it (server/services/semanticService.js never coerces "no data" to a
 * 0% score) — rendered here as "Not enough info", never as 0%, so a blank
 * profile field doesn't read as a strike against the match.
 *
 * props:
 *   breakdown    the job/application's matchBreakdown object (per-dimension
 *                0..1 scores, plus optional ageEligible/ageUnknown flags)
 *   disqualified "age" when the age hard-gate applies, else null/undefined
 *   audience     "applicant" (default) shows "complete your profile" links
 *                for unscored dimensions; "employer" omits them — an
 *                employer reviewing a candidate has no profile of their own
 *                to complete here.
 */
export default function MatchBreakdownPanel({ breakdown, disqualified, audience = "applicant" }) {
  const b = breakdown && typeof breakdown === "object" ? breakdown : {};
  const presentKeys = DIMENSION_ORDER.filter((key) => typeof b[key] === "number");
  const missingKeys = DIMENSION_ORDER.filter((key) => typeof b[key] !== "number");
  const isApplicant = audience === "applicant";

  return (
    <div className="match-breakdown-panel">
      {disqualified === "age" && (
        <p className="match-breakdown-flag match-breakdown-flag--dq">
          Outside this job's age requirement
        </p>
      )}
      {b.ageUnknown && (
        <p className="match-breakdown-flag match-breakdown-flag--age-unknown">
          Age not on file — not verified against this job's range
        </p>
      )}

      <p className="match-breakdown-coverage">
        Based on {presentKeys.length} of {DIMENSION_ORDER.length} criteria
        {isApplicant && presentKeys.length < DIMENSION_ORDER.length
          ? " — complete your profile for a more accurate match."
          : "."}
      </p>

      <div className="match-breakdown-rows">
        {presentKeys.map((key) => {
          const percent = Math.round(b[key] * 100);
          return (
            <div className="match-breakdown-row" key={key}>
              <span className="match-breakdown-label">{DIMENSION_LABELS[key]}</span>
              <div className="match-breakdown-bar" role="presentation">
                <div className="match-breakdown-bar-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
              </div>
              <span className="match-breakdown-pct">{percent}%</span>
            </div>
          );
        })}

        {missingKeys.map((key) => {
          const tab = DIMENSION_PROFILE_TAB[key];
          return (
            <div className="match-breakdown-row match-breakdown-row--unknown" key={key}>
              <span className="match-breakdown-label">{DIMENSION_LABELS[key]}</span>
              <span className="match-breakdown-unknown">
                Not enough info on your profile
                {isApplicant && tab && (
                  <>
                    {" — "}
                    <Link to={`/profile/edit?tab=${tab}`}>complete it</Link>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
