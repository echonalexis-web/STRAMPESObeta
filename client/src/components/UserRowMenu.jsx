import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MoreVertical } from "lucide-react";
import { getAvailableActions } from "../utils/userStatus";

// "More actions" for one directory row: a disclosure button that reveals real
// buttons (Deactivate, Reactivate, Delete, Restore, depending on the account's
// state). Escape closes it and returns focus to the button, a click or Tab away
// closes it, and only one menu is open at a time because the parent owns
// `openId`. Which actions exist is decided by getAvailableActions, as before.
export default function UserRowMenu({ user, openId, onOpenChange, onToggleStatus, onDelete, onRestore }) {
  const { t } = useTranslation();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = useId();
  const open = openId === user._id;
  const actions = getAvailableActions(user);

  const items = [];
  if (actions.deactivate) items.push({ key: "deactivate", run: () => onToggleStatus(user) });
  if (actions.reactivate) items.push({ key: "reactivate", run: () => onToggleStatus(user) });
  if (actions.restore) items.push({ key: "restore", run: () => onRestore(user) });
  if (actions.delete) items.push({ key: "delete", run: () => onDelete(user), danger: true });

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) onOpenChange(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  if (items.length === 0) return null;

  const close = ({ restoreFocus }) => {
    onOpenChange(null);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const onKeyDown = (event) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      close({ restoreFocus: true });
      return;
    }
    // Tabbing past either end of the menu closes it (focus then moves on as usual).
    if (event.key === "Tab" && rootRef.current) {
      const buttons = rootRef.current.querySelectorAll("button");
      const edge = event.shiftKey ? buttons[0] : buttons[buttons.length - 1];
      if (document.activeElement === edge) close({ restoreFocus: false });
    }
  };

  return (
    <div className="um-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="um-iconbtn"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("superadmin.users.actions.moreFor", { name: user.name })}
        onClick={() => onOpenChange(open ? null : user._id)}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div className="um-menu__list" id={menuId}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`um-menu__item${item.danger ? " um-menu__item--danger" : ""}`}
              onClick={() => {
                close({ restoreFocus: false });
                item.run();
              }}
            >
              {t(`superadmin.users.actions.${item.key}`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
