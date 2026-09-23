import { useContext, useEffect, useRef, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { searchBarangayLocations } from "../utils/philippineLocations";

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in local time, not the raw
// ISO string a Date().toISOString() would produce (which is UTC).
const toDatetimeLocalValue = (isoString) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function InterviewScheduleModal({ application, applications, saving, onClose, onSubmit }) {
  const { user } = useContext(AuthContext);
  const businessAddress = (user?.businessAddress || "").trim();

  const list = applications?.length ? applications : application ? [application] : [];
  const isBulk = list.length > 1;
  const primary = list[0] || null;
  const key = isBulk ? list.map((app) => app._id).join(",") : primary?._id;

  // A batch of applicants can each be at a different point in their own
  // interview history, so there's no single "existing" slot to prefill or
  // reschedule — bulk scheduling always starts from a blank form.
  const existing = isBulk ? null : primary?.interview;
  const isReschedule = Boolean(existing?.scheduledAt);

  const [scheduledAt, setScheduledAt] = useState(() => toDatetimeLocalValue(existing?.scheduledAt));
  const [mode, setMode] = useState(existing?.mode || "onsite");
  const [location, setLocation] = useState(existing?.location || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [error, setError] = useState("");
  const [useBusinessAddress, setUseBusinessAddress] = useState(
    Boolean(businessAddress) && existing?.location === businessAddress
  );
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const locationFieldRef = useRef(null);

  // Reset the form whenever a different application is opened.
  useEffect(() => {
    setScheduledAt(toDatetimeLocalValue(existing?.scheduledAt));
    setMode(existing?.mode || "onsite");
    setLocation(existing?.location || "");
    setNotes(existing?.notes || "");
    setError("");
    setUseBusinessAddress(Boolean(businessAddress) && existing?.location === businessAddress);
    setShowSuggestions(false);
  }, [key]);

  // Close the barangay-to-province suggestion list on outside clicks.
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (locationFieldRef.current && !locationFieldRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (list.length === 0) return null;

  const applicantName = primary.applicant?.name || "this applicant";
  const jobTitle = primary.vacancy?.title || "this role";

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setUseBusinessAddress(false);
    setShowSuggestions(false);
  };

  const handleToggleBusinessAddress = (checked) => {
    setUseBusinessAddress(checked);
    setShowSuggestions(false);
    if (checked) setLocation(businessAddress);
  };

  const handleLocationChange = (value) => {
    setLocation(value);
    setSuggestions(searchBarangayLocations(value));
    setShowSuggestions(true);
  };

  const handleSelectSuggestion = (suggestion) => {
    setLocation(suggestion);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");

    if (!scheduledAt) {
      setError("Please pick an interview date and time.");
      return;
    }
    if (new Date(scheduledAt) <= new Date()) {
      setError("Interview date/time must be in the future.");
      return;
    }
    if (!location.trim()) {
      setError(mode === "online" ? "Please add a meeting link." : "Please add a location.");
      return;
    }

    onSubmit({
      scheduledAt: new Date(scheduledAt).toISOString(),
      mode,
      location: location.trim(),
      notes: notes.trim(),
    });
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="interview-schedule-modal" onClick={(e) => e.stopPropagation()}>
        <header className="applicant-modal-header">
          <div className="applicant-modal-title">
            <h3>{isBulk ? "Schedule Interviews" : isReschedule ? "Reschedule Interview" : "Schedule Interview"}</h3>
            <p>{isBulk ? `${list.length} candidates selected · ${jobTitle}` : `${applicantName} · ${jobTitle}`}</p>
          </div>
          <button
            type="button"
            className="applicant-modal-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="interview-modal-body">
            {isBulk && (
              <div className="applicant-modal-field">
                <label>Candidates</label>
                <div className="interview-bulk-candidates">
                  {list.map((app) => (
                    <span key={app._id} className="interview-bulk-candidate-chip">
                      {app.applicant?.name || "Applicant"}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="applicant-modal-field">
              <label htmlFor="interview-datetime">Date &amp; Time</label>
              <input
                id="interview-datetime"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={saving}
                required
              />
            </div>

            <div className="applicant-modal-field">
              <label>Mode</label>
              <div className="interview-mode-toggle">
                <button
                  type="button"
                  className={mode === "onsite" ? "active" : ""}
                  onClick={() => handleModeChange("onsite")}
                  disabled={saving}
                >
                  Onsite
                </button>
                <button
                  type="button"
                  className={mode === "online" ? "active" : ""}
                  onClick={() => handleModeChange("online")}
                  disabled={saving}
                >
                  Online
                </button>
              </div>
            </div>

            <div className="applicant-modal-field" ref={locationFieldRef}>
              <label htmlFor="interview-location">
                {mode === "online" ? "Meeting Link" : "Location"}
              </label>

              {mode === "onsite" && (
                <label className="interview-use-business-address" title={!businessAddress ? "Add a business address in your profile first" : undefined}>
                  <input
                    type="checkbox"
                    checked={useBusinessAddress}
                    disabled={saving || !businessAddress}
                    onChange={(e) => handleToggleBusinessAddress(e.target.checked)}
                  />
                  Use my business address{businessAddress ? "" : " (none on file)"}
                </label>
              )}

              <div className="interview-location-autosuggest">
                <input
                  id="interview-location"
                  type="text"
                  value={location}
                  onChange={(e) => handleLocationChange(e.target.value)}
                  onFocus={() => mode === "onsite" && !useBusinessAddress && setShowSuggestions(Boolean(suggestions.length))}
                  placeholder={mode === "online" ? "e.g. https://meet.google.com/xyz" : "e.g. 2nd Floor, PESO Office, Boac"}
                  disabled={saving || (mode === "onsite" && useBusinessAddress)}
                  autoComplete="off"
                  required
                />
                {mode === "onsite" && showSuggestions && suggestions.length > 0 && (
                  <ul className="interview-location-suggestions" role="listbox">
                    {suggestions.map((suggestion) => (
                      <li
                        key={suggestion}
                        role="option"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectSuggestion(suggestion);
                        }}
                      >
                        {suggestion}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {mode === "onsite" && (
                <span className="interview-location-hint">Type a barangay, city, or province to see suggestions.</span>
              )}
            </div>

            <div className="applicant-modal-field">
              <label htmlFor="interview-notes">Notes <span className="onboarding-optional">(optional)</span></label>
              <textarea
                id="interview-notes"
                rows="3"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Bring a valid ID and a printed resume"
                disabled={saving}
              />
            </div>

            {error && <p className="applicant-modal-error">{error}</p>}
          </div>

          <footer className="applicant-modal-footer">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-save" disabled={saving}>
              {saving
                ? "Saving..."
                : isBulk
                  ? `Schedule & Notify ${list.length}`
                  : isReschedule
                    ? "Save & Notify"
                    : "Schedule & Notify"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
