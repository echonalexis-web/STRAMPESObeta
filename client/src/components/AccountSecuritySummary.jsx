import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminAPI } from "../services/api";
import "../styles/username-signup.css";

// Admin: counts only (no emails, no dates of birth, no usernames) for accounts
// that have no email, plus recent lockouts. Fails quiet-but-visible.
export default function AccountSecuritySummary() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminAPI
      .getAccountSecuritySummary()
      .then(({ data }) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <section className="asum" aria-label={t("admin.accounts.title")}>
        <p className="su-hint" role="status">{t("admin.accounts.loadError")}</p>
      </section>
    );
  }
  if (!summary) return null;

  const cells = [
    ["emailLessCount", t("admin.accounts.emailLessCount"), summary.emailLessCount],
    ["idleNoEmail", t("admin.accounts.idleNoEmail", { days: summary.idleDays }), summary.idleEmailLessCount],
    ["locksLast24h", t("admin.accounts.locksLast24h"), summary.locksLast24h],
    ["locksLast7d", t("admin.accounts.locksLast7d"), summary.locksLast7d],
    ["lockedNow", t("admin.accounts.lockedNow"), summary.lockedNow],
  ];

  return (
    <section className="asum" aria-label={t("admin.accounts.title")}>
      <h3 className="asum__title">{t("admin.accounts.title")}</h3>
      <dl className="asum__grid">
        {cells.map(([key, label, value]) => (
          <div className="asum__cell" key={key}>
            <dt>{label}</dt>
            <dd>{Number(value) || 0}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
