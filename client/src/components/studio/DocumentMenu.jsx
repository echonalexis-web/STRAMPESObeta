import { useEffect, useId, useRef, useState } from "react";
import PropTypes from "prop-types";
import { FaChevronDown } from "react-icons/fa";

// One "Document" menu button for the save and export actions. A menu button pattern:
// aria-haspopup="menu" + aria-expanded on the button; role="menu" / "menuitem" in the popover;
// arrow keys move, Home/End jump, Escape and an outside click close it, a choice closes it, and
// focus goes back to the button. An action that does not apply is simply not passed in.
export default function DocumentMenu({ label, menuLabel, items }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const itemRefs = useRef([]);
  const menuId = useId();

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    itemRefs.current[0]?.focus();
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const onMenuKeyDown = (event) => {
    const nodes = itemRefs.current.filter(Boolean);
    const index = nodes.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      nodes[(index + 1) % nodes.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      nodes[(index - 1 + nodes.length) % nodes.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      nodes[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false); // leaving the menu with Tab closes it; focus continues from the button
    }
  };

  return (
    <div className="stu-menu" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="stu-btn stu-btn--secondary stu-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label} <FaChevronDown aria-hidden="true" size={11} />
      </button>
      {open ? (
        <div className="stu-menu__popover" id={menuId} role="menu" aria-label={menuLabel} onKeyDown={onMenuKeyDown}>
          {items.map((item, index) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="stu-menu__item"
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              onClick={() => {
                close(false);
                buttonRef.current?.focus();
                item.onSelect();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

DocumentMenu.propTypes = {
  label: PropTypes.string.isRequired,
  menuLabel: PropTypes.string.isRequired,
  items: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      onSelect: PropTypes.func.isRequired,
      icon: PropTypes.node,
    })
  ).isRequired,
};
