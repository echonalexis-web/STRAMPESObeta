import { useEffect, useId, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import AccountStatusBadge from "./AccountStatusBadge";
import "../styles/staff-invite.css";

// A "pending staff activations" badge for the User Management page. Staff
// accounts are not a directory tab, so this is where a superadmin sees that
// invitations are still waiting. Hovering, focusing or clicking the badge opens
// a small panel with a button to the Admin accounts page, where invitations are
// resent or cancelled. Renders nothing when no invitation is pending.
export default function PendingStaffNotice({ count, onOpen }) {
  const { t } = useTranslation();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  // `open` is what shows; `pinned` means a click or key press opened it, so moving
  // the pointer away does not close it (hover alone only peeks).
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!Number.isFinite(count) || count <= 0) return null;

  const onKeyDown = (event) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      setPinned(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      className="si-notice"
      ref={rootRef}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="si-notice__trigger"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          const next = !pinned;
          setPinned(next);
          setOpen(next);
        }}
      >
        <AccountStatusBadge state="pending">{t("superadmin.users.pendingStaff.badge", { count })}</AccountStatusBadge>
      </button>
      {open ? (
        <div className="si-notice__pop" id={panelId} role="region" aria-label={t("superadmin.users.pendingStaff.title")}>
          <p className="si-notice__title">{t("superadmin.users.pendingStaff.title")}</p>
          <p className="si-notice__body">{t("superadmin.users.pendingStaff.body", { count })}</p>
          <button type="button" className="si-btn si-btn--primary" onClick={onOpen}>
            {t("superadmin.users.pendingStaff.open")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

PendingStaffNotice.propTypes = {
  count: PropTypes.number,
  onOpen: PropTypes.func.isRequired,
};
