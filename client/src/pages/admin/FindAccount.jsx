import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaSearch } from "react-icons/fa";
import { adminAPI } from "../../services/api";
import { userContactLabel } from "../../utils/usernameSignup";
import StateBlock from "../../components/StateBlock";
import AdminHeader from "./AdminHeader";
import "../../styles/admin.css";
import "../../styles/username-signup.css";

// PESO staff: find a jobseeker account by name, username or email, then open its
// profile to reset the password at the counter or unlock sign-in. A small search,
// not the full user directory (that stays superadmin-only).
export default function FindAccount() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const search = async (event) => {
    event.preventDefault();
    const query = term.trim();
    if (query.length < 2 || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await adminAPI.getUsers({ role: "jobseeker", search: query, page: 1, limit: 20 });
      setResults(Array.isArray(data?.users) ? data.users : []);
    } catch {
      setResults(null);
      setError(t("admin.find.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page-container">
      <AdminHeader title={t("admin.find.title")} description={t("admin.find.subtitle")} />

      <section className="admin-panel-card">
        <form className="egate" onSubmit={search} role="search">
          <div className="egate__field">
            <label className="egate__label" htmlFor="find-term">{t("admin.find.searchLabel")}</label>
            <input
              id="find-term"
              className="egate__input"
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t("admin.find.searchPlaceholder")}
              autoComplete="off"
              minLength={2}
            />
          </div>
          <button type="submit" className="egate__btn egate__btn--primary" disabled={busy || term.trim().length < 2}>
            <FaSearch aria-hidden="true" /> {busy ? t("admin.find.searching") : t("admin.find.search")}
          </button>
          <p className="su-hint">{t("admin.find.hint")}</p>
        </form>

        {error && <p className="egate__error" role="alert">{error}</p>}

        {results && results.length === 0 && <StateBlock kind="empty" title={t("admin.find.noResults")} />}

        {results && results.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("admin.find.colName")}</th>
                  <th>{t("admin.find.colContact")}</th>
                  <th>{t("admin.find.colJoined")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((account) => (
                  <tr key={account._id}>
                    <td>{account.name}</td>
                    <td>{userContactLabel(account)}</td>
                    <td>{account.createdAt ? new Date(account.createdAt).toLocaleDateString() : "—"}</td>
                    <td>
                      <button type="button" className="admin-inline-btn" onClick={() => navigate(`/admin/users/${account._id}`)}>
                        {t("admin.find.open")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
