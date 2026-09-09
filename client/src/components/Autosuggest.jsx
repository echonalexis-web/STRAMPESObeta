import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_MAX_SUGGESTIONS = 8;

export default function Autosuggest({
  id,
  name,
  value,
  onChange,
  onBlur,
  options,
  placeholder,
  disabled,
  className = "",
  inputClassName = "",
  maxLength,
  maxSuggestions = DEFAULT_MAX_SUGGESTIONS,
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef(null);
  const currentValue = value || "";

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const suggestions = useMemo(() => {
    const q = currentValue.trim().toLowerCase();
    if (!q) return [];
    return options.filter((opt) => opt.toLowerCase().includes(q)).slice(0, maxSuggestions);
  }, [currentValue, options, maxSuggestions]);

  const commit = (val) => {
    onChange(val);
    setOpen(false);
    setHighlighted(-1);
  };

  const handleChange = (e) => {
    onChange(e.target.value);
    setOpen(true);
    setHighlighted(-1);
  };

  const handleKeyDown = (e) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (highlighted >= 0) {
        e.preventDefault();
        commit(suggestions[highlighted]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={`autosuggest ${className}`.trim()} ref={containerRef}>
      <input
        id={id}
        name={name}
        type="text"
        className={inputClassName}
        value={currentValue}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={handleChange}
        onFocus={() => currentValue.trim() && setOpen(true)}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
      />
      {open && suggestions.length > 0 && (
        <ul className="autosuggest-list" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === highlighted}
              className={i === highlighted ? "is-highlighted" : ""}
              onMouseDown={(e) => { e.preventDefault(); commit(s); }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
