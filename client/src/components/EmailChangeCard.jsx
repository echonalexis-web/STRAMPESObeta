import { useState } from "react";
import { FaEnvelope } from "react-icons/fa";
import { authAPI } from "../services/api";

/**
 * Self-contained "change your sign-in email" panel. Lives outside the main
 * profile <form> so its submit never triggers a full profile save. The email
 * only changes after the user opens the confirmation link sent to the new
 * address (handled by /verify-email).
 */
export default function EmailChangeCard({ currentEmail }) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [devUrl, setDevUrl] = useState("");

  const reset = () => {
    setNewEmail("");
    setPassword("");
    setErr("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setMsg("");
    setDevUrl("");
    setLoading(true);
    try {
      const { data } = await authAPI.requestEmailChange({
        newEmail: newEmail.trim(),
        currentPassword: password,
      });
      setMsg(data.message || `We sent a confirmation link to ${newEmail.trim()}.`);
      setDevUrl(data.devVerifyUrl || "");
      setNewEmail("");
      setPassword("");
      setOpen(false);
    } catch (e2) {
      setErr(e2?.response?.data?.message || "Could not start the email change. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="email-change-card">
      <div className="email-change-card__head">
        <div className="email-change-card__title">
          <FaEnvelope />
          <div>
            <h2>Email address</h2>
            <p>
              Signed in as <strong>{currentEmail || "—"}</strong>
            </p>
          </div>
        </div>
        {!open && (
          <button
            type="button"
            className="email-change-card__toggle"
            onClick={() => {
              reset();
              setMsg("");
              setDevUrl("");
              setOpen(true);
            }}
          >
            Change email
          </button>
        )}
      </div>

      {msg && (
        <div className="alert alert-success email-change-card__result">
          {msg}
          {devUrl && (
            <>
              <br />
              <a href={devUrl}>Dev: open the confirmation link</a>
            </>
          )}
        </div>
      )}

      {open && (
        <form className="email-change-card__form" onSubmit={submit}>
          <p className="email-change-card__hint">
            We'll email a confirmation link to the new address. Your sign-in email changes only
            after you open that link. A heads-up is also sent to your current address.
          </p>

          {err && <div className="alert alert-error">{err}</div>}

          <label className="email-change-card__field">
            <span>New email address</span>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="email"
              required
              disabled={loading}
            />
          </label>

          <label className="email-change-card__field">
            <span>Current password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={loading}
            />
          </label>

          <div className="email-change-card__actions">
            <button
              type="button"
              className="email-change-card__btn email-change-card__btn--ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="email-change-card__btn email-change-card__btn--primary"
              disabled={loading}
            >
              {loading ? "Sending…" : "Send confirmation link"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
