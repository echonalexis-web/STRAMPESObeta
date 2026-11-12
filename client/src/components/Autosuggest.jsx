import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_MAX_SUGGESTIONS, canonicalOption, collapseSpaces, matchSuggestions } from "../utils/suggestMatch";

const OPTION_HEIGHT = 44; // touch-friendly row height used in enhanced mode
const EDGE_GAP = 8;

// Free-text input with a filtered suggestion list. Typing any other text is always allowed.
//
// `enhanced` (opt-in, used by the profile wizard's Citizenship, Eligibility and PRC
// license fields) adds: matching that ignores case, accents and extra spaces with
// prefix matches first, a "No match" state, a spoken result count, the full ARIA
// combobox wiring (aria-controls, aria-activedescendant, labelled listbox), a list
// that opens upward when there is no room below, and exact matches saved under the
// list's own label. Without it the component behaves exactly as before.
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
  enhanced = false,
  label,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [placement, setPlacement] = useState({ up: false, maxHeight: null });
  const containerRef = useRef(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (index) => `${uid}-opt-${index}`;
  const currentValue = value || "";

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const suggestions = useMemo(() => {
    if (enhanced) return matchSuggestions(currentValue, options, maxSuggestions);
    const q = currentValue.trim().toLowerCase();
    if (!q) return [];
    return options.filter((opt) => opt.toLowerCase().includes(q)).slice(0, maxSuggestions);
  }, [enhanced, currentValue, options, maxSuggestions]);

  // Decide, when the list is about to open, whether it fits below the field inside its
  // scroll area (or the window); if not, open it upward, and cap its height to the room.
  const measurePlacement = (count) => {
    const el = containerRef.current;
    if (!enhanced || !el) return;
    const rect = el.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden") {
        const box = node.getBoundingClientRect();
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
        break;
      }
    }
    const below = bottom - rect.bottom - EDGE_GAP;
    const above = rect.top - top - EDGE_GAP;
    const want = Math.max(1, count) * OPTION_HEIGHT + 12;
    const up = below < want && above > below;
    const room = up ? above : below;
    setPlacement({ up, maxHeight: Math.max(OPTION_HEIGHT * 2, Math.min(want, room)) });
  };

  const commit = (val) => {
    onChange(val);
    setOpen(false);
    setHighlighted(-1);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    onChange(next);
    setOpen(true);
    setHighlighted(-1);
    if (enhanced) measurePlacement(matchSuggestions(next, options, maxSuggestions).length);
  };

  const handleFocus = () => {
    if (!currentValue.trim()) return;
    setOpen(true);
    if (enhanced) measurePlacement(suggestions.length);
  };

  const handleBlur = (e) => {
    if (enhanced) {
      // Tidy what was typed; an exact match is stored under the list's own label.
      const tidy = collapseSpaces(currentValue);
      const canonical = canonicalOption(tidy, options);
      const final = canonical || tidy;
      if (final !== currentValue) onChange(final);
      setOpen(false);
    }
    if (onBlur) onBlur(e);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
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
    }
  };

  const showList = open && suggestions.length > 0;
  const showNoMatch = enhanced && open && suggestions.length === 0 && currentValue.trim().length > 0;
  const listStyle = enhanced && placement.maxHeight ? { maxHeight: `${placement.maxHeight}px` } : undefined;
  const announcement = !enhanced || !open || !currentValue.trim()
    ? ""
    : suggestions.length > 0
      ? t("suggest.count", { count: suggestions.length })
      : t("suggest.noMatch");

  return (
    <div className={`autosuggest ${enhanced ? "autosuggest--rich" : ""} ${className}`.replace(/\s+/g, " ").trim()} ref={containerRef}>
      <input
        id={id}
        name={name}
        type="text"
        className={inputClassName}
        value={currentValue}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        aria-controls={enhanced && showList ? listId : undefined}
        aria-activedescendant={enhanced && showList && highlighted >= 0 ? optionId(highlighted) : undefined}
      />
      {showList && (
        <ul
          id={enhanced ? listId : undefined}
          className={`autosuggest-list${enhanced && placement.up ? " autosuggest-list--up" : ""}`}
          role="listbox"
          aria-label={enhanced ? label || t("suggest.listLabel") : undefined}
          style={listStyle}
        >
          {suggestions.map((s, i) => (
            <li
              key={s}
              id={enhanced ? optionId(i) : undefined}
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
      {showNoMatch && (
        <div className={`autosuggest-empty${placement.up ? " autosuggest-empty--up" : ""}`}>{t("suggest.noMatch")}</div>
      )}
      {enhanced && (
        <span className="ds-sr-only" role="status" aria-live="polite">{announcement}</span>
      )}
    </div>
  );
}
