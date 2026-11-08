import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { FaChevronDown } from "react-icons/fa";

// A navigation group that can be opened and closed (sidebar and mobile drawer).
//
// - The header is a <button> with aria-expanded / aria-controls; Enter and Space
//   toggle it. Children live in a <ul> that is `hidden` while closed, so closed
//   links leave the tab order and the drawer's focus trap.
// - A group opens by itself when one of its links is the current page, and again
//   whenever the user navigates into it. The user's open/closed choice is kept per
//   group in sessionStorage as a convenience only (try/catch: the menu works
//   without it).
// - Compact (icons-only) sidebar: the header shows its icon, and the open group
//   lists its links inline as icon-only items with title tooltips (CSS only).
//
// `items`: [{ label, to, icon? }]. `variant="mobile"` uses the drawer's plain-link
// styling (no icons).
const storageKey = (id) => `navGroupOpen:${id}`;

const readStored = (id) => {
  try {
    const value = sessionStorage.getItem(storageKey(id));
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
};

const writeStored = (id, open) => {
  try {
    sessionStorage.setItem(storageKey(id), open ? "1" : "0");
  } catch {
    /* storage unavailable: the group just will not be remembered */
  }
};

export default function NavCollapsibleGroup({ id, label, icon, items, isActiveLink, onNavigate, variant = "sidebar" }) {
  const panelId = useId();
  const childActive = items.some((item) => isActiveLink(item.to));
  const [open, setOpen] = useState(() => childActive || readStored(id) === true);

  // Navigating into the group (a link, a redirect, the back button) opens it.
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  const toggle = () => {
    setOpen((prev) => {
      writeStored(id, !prev);
      return !prev;
    });
  };

  const mobile = variant === "mobile";
  const rootClass = ["nav-collapsible", mobile ? "nav-collapsible--mobile" : "", open ? "is-open" : "", childActive ? "is-child-active" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass}>
      <button
        type="button"
        className="nav-collapsible__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        title={label}
        onClick={toggle}
      >
        {!mobile && icon}
        <span className="nav-link-text">{label}</span>
        <FaChevronDown className="nav-collapsible__chevron" aria-hidden="true" />
      </button>
      <ul id={panelId} className="nav-collapsible__list" hidden={!open}>
        {items.map((item) => {
          const active = isActiveLink(item.to);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className={`${mobile ? "" : "nav-section-link "}nav-collapsible__link${active ? " is-active" : ""}`.trim()}
                aria-current={active ? "page" : undefined}
                title={item.label}
                onClick={onNavigate}
              >
                {!mobile && item.icon}
                <span className="nav-link-text">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
