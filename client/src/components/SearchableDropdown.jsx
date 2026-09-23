import { useEffect, useMemo, useRef, useState } from "react";
import { FaChevronDown } from "react-icons/fa";

export default function SearchableDropdown({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className = "",
  inputClassName = "",
}) {
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState(value || "");
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef(null);

  // Re-syncs the displayed text whenever `value` changes from OUTSIDE this
  // component (a parent resetting the field, or loading existing data after
  // an async fetch) — `searchText` otherwise only ever seeds from `value`
  // once, on mount. Adjusted during render (React's documented pattern for
  // this) rather than in an effect, so it takes effect in the same render
  // instead of one tick later. A user typing here already keeps the two in
  // lockstep via handleChange's onChange(...) call, so this never fights
  // their input.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setSearchText(value || "");
  }

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [searchText, options]);

  const handleChange = (e) => {
    setSearchText(e.target.value);
    setHighlighted(-1);
    onChange(e.target.value);
  };

  const handleSelectOption = (option) => {
    setSearchText(option);
    onChange(option);
    setOpen(false);
    setHighlighted(-1);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
        setHighlighted(0);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      handleSelectOption(filtered[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const toggleDropdown = () => {
    if (disabled) return;
    setOpen(!open);
    setHighlighted(0);
  };

  return (
    <div className={`searchable-dropdown ${className}`.trim()} ref={containerRef}>
      <div className="searchable-dropdown-input-wrapper">
        <input
          id={id}
          type="text"
          className={`searchable-dropdown-input ${inputClassName}`.trim()}
          value={searchText}
          placeholder={placeholder}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => !disabled && setOpen(true)}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <button
          type="button"
          className="searchable-dropdown-toggle"
          onClick={toggleDropdown}
          disabled={disabled}
          aria-label="Toggle dropdown"
          tabIndex="-1"
        >
          <FaChevronDown />
        </button>
      </div>

      {open && filtered.length > 0 && (
        <ul className="searchable-dropdown-list" role="listbox">
          {filtered.map((option, i) => (
            <li
              key={option}
              role="option"
              aria-selected={i === highlighted}
              className={i === highlighted ? "is-highlighted" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectOption(option);
              }}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div className="searchable-dropdown-empty">No options found</div>
      )}
    </div>
  );
}
