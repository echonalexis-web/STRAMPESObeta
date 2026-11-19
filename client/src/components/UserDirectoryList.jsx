import { useTranslation } from "react-i18next";
import Avatar from "./Avatar";
import AccountStatusBadge from "./AccountStatusBadge";
import StateBlock from "./StateBlock";
import UserRowMenu from "./UserRowMenu";
import { getAccountState } from "../utils/userStatus";
import { userContactLabel } from "../utils/usernameSignup";
import { formatDirectoryDate, hasNoEmail, removalDays } from "../utils/userRowInfo";

// The account rows inside the directory card: a table on a tablet or desktop
// (the CSS drops Key info, Last active and Joined from the columns on a tablet
// and shows the key info under the name instead) and a stack of cards on a phone.

function UserCell({ user }) {
  const { t } = useTranslation();
  return (
    <div className="um-user">
      <Avatar size={36} name={user.name} photo={user.profileImage} />
      <div className="um-user__text">
        <strong className="um-user__name">{user.name}</strong>
        <span className="um-user__handle">
          {userContactLabel(user)}
          {hasNoEmail(user) ? <span className="um-note"> · {t("superadmin.users.row.noEmail")}</span> : null}
        </span>
      </div>
    </div>
  );
}

function StatusCell({ user }) {
  const { t } = useTranslation();
  const state = getAccountState(user);
  const days = state === "deleted" ? removalDays(user.purgeAfter) : null;
  return (
    <>
      <AccountStatusBadge state={state}>{t(`superadmin.users.status.${state}`)}</AccountStatusBadge>
      {days !== null ? (
        <span className="um-until">{t("superadmin.users.row.removal", { count: days })}</span>
      ) : null}
    </>
  );
}

// "Profile 80%" and "4 applications", or "2 postings, 1 hire" and the verification status.
function KeyInfo({ user }) {
  const { t } = useTranslation();
  const details = user.details;
  if (!details) return <span className="um-muted">—</span>;
  if (user.role === "employer") {
    const status = user.verificationStatus || "unverified";
    return (
      <>
        <span>
          {t("superadmin.users.row.postings", { count: details.postings })}, {t("superadmin.users.row.hires", { count: details.hires })}
        </span>
        <span className="um-muted">{t(`superadmin.users.filters.verificationOptions.${status}`)}</span>
      </>
    );
  }
  return (
    <>
      <span>{t("superadmin.users.row.profile", { percent: details.profilePercent })}</span>
      <span className="um-muted">{t("superadmin.users.row.applications", { count: details.applications })}</span>
    </>
  );
}

function Actions({ user, handlers, openMenuId, onOpenMenuChange }) {
  const { t } = useTranslation();
  return (
    <div className="um-actions">
      <button type="button" className="um-btn" onClick={() => handlers.onViewProfile(user)} aria-label={t("superadmin.users.actions.viewFor", { name: user.name })}>
        {t("superadmin.users.actions.view")}
      </button>
      <UserRowMenu
        user={user}
        openId={openMenuId}
        onOpenChange={onOpenMenuChange}
        onToggleStatus={handlers.onToggleStatus}
        onDelete={handlers.onDelete}
        onRestore={handlers.onRestore}
      />
    </div>
  );
}

function EmptyState({ role, filtered, onClear }) {
  const { t } = useTranslation();
  return (
    <div className="um-empty">
      <StateBlock
        kind="empty"
        className="um-state"
        title={filtered ? t("superadmin.users.filters.noMatchTitle") : t(`superadmin.users.empty.${role}Title`)}
        description={filtered ? t("superadmin.users.filters.noMatchDescription") : t("superadmin.users.empty.description")}
      />
      {filtered ? (
        <button type="button" className="um-btn" onClick={onClear}>
          {t("superadmin.users.filters.clear")}
        </button>
      ) : null}
    </div>
  );
}

export default function UserDirectoryList({ users, role, isMobile, loading, filtered, onClear, handlers, openMenuId, onOpenMenuChange }) {
  const { t } = useTranslation();
  const rowProps = { handlers, openMenuId, onOpenMenuChange };

  if (loading) {
    return <StateBlock kind="loading" className="um-state" title={t("superadmin.users.loading")} />;
  }
  if (users.length === 0) {
    return <EmptyState role={role} filtered={filtered} onClear={onClear} />;
  }

  if (isMobile) {
    return (
      <ul className="um-cards" aria-label={t("superadmin.users.cardsLabel")}>
        {users.map((user) => (
          <li key={user._id} className="um-cardrow">
            <div className="um-cardrow__top">
              <UserCell user={user} />
              <div className="um-cardrow__status"><StatusCell user={user} /></div>
            </div>
            <div className="um-cardrow__info"><KeyInfo user={user} /></div>
            <p className="um-cardrow__dates">
              {t("superadmin.users.columns.lastActive")}: {user.lastActiveAt ? formatDirectoryDate(user.lastActiveAt) : t("superadmin.users.row.never")}
              {" · "}
              {t("superadmin.users.columns.joined")}: {formatDirectoryDate(user.createdAt)}
            </p>
            <Actions user={user} {...rowProps} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <table className="um-table">
      <caption className="ds-sr-only">{t("superadmin.users.tableLabel")}</caption>
      <colgroup>
        <col className="um-col um-col--user" />
        <col className="um-col um-col--status" />
        <col className="um-col um-col--info" />
        <col className="um-col um-col--active" />
        <col className="um-col um-col--joined" />
        <col className="um-col um-col--actions" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{t("superadmin.users.columns.user")}</th>
          <th scope="col">{t("superadmin.users.columns.status")}</th>
          <th scope="col" className="um-hide-tablet">{t("superadmin.users.columns.keyInfo")}</th>
          <th scope="col" className="um-hide-tablet">{t("superadmin.users.columns.lastActive")}</th>
          <th scope="col" className="um-hide-tablet">{t("superadmin.users.columns.joined")}</th>
          <th scope="col">{t("superadmin.users.columns.actions")}</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user._id}>
            <td>
              <UserCell user={user} />
              <div className="um-keyinfo um-keyinfo--inline"><KeyInfo user={user} /></div>
            </td>
            <td><StatusCell user={user} /></td>
            <td className="um-hide-tablet"><div className="um-keyinfo"><KeyInfo user={user} /></div></td>
            <td className="um-hide-tablet">{user.lastActiveAt ? formatDirectoryDate(user.lastActiveAt) : t("superadmin.users.row.never")}</td>
            <td className="um-hide-tablet">{formatDirectoryDate(user.createdAt)}</td>
            <td><Actions user={user} {...rowProps} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
