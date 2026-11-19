import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaSearch } from "react-icons/fa";
import { jobAPI } from "../services/api";
import {
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
  createRequestGate,
  highlightParts,
  nextActiveIndex,
} from "../utils/liveSearch";

// Keyword box with live suggestions, following the ARIA combobox (list
// autocomplete) pattern. The input event (onChange) drives it, so paste,
// voice input and mobile keyboards all work. If suggestions fail the box
// still works as a plain search field.
export default function JobSearchBox({ id, value, onChange, onCommit, placeholder }) {
  const { t } = useTranslation();
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const gate = useRef(createRequestGate());
  const skipNext = useRef(false);
  const wrapRef = useRef(null);

  const query = String(value || "").trim();
  // Below the minimum length nothing is suggested (stale results are simply not shown).
  const tooShort = query.length < SUGGEST_MIN_CHARS;

  // Fetch suggestions ~250ms after the last keystroke; a newer request cancels the older one.
  useEffect(() => {
    const requests = gate.current;
    if (skipNext.current) {
      skipNext.current = false;
      return undefined;
    }
    if (tooShort) {
      requests.abort();
      return undefined;
    }
    const timer = setTimeout(async () => {
      const request = requests.begin();
      try {
        const { data } = await jobAPI.suggestJobs(query, { signal: request.signal });
        if (!request.isCurrent()) return;
        const list = Array.isArray(data?.suggestions) ? data.suggestions : [];
        setItems(list);
        setFailed(false);
        setActive(-1);
        setOpen(list.length > 0);
      } catch (err) {
        if (err?.code === "ERR_CANCELED" || !request.isCurrent()) return;
        setItems([]);
        setFailed(true);
        setOpen(false);
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, tooShort]);

  useEffect(() => {
    const requests = gate.current;
    return () => requests.abort();
  }, []);

  // Click outside closes the list.
  useEffect(() => {
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const listVisible = open && focused && !tooShort && items.length > 0;
  const optionId = (index) => `${listId}-opt-${index}`;

  const choose = (item) => {
    skipNext.current = true;
    setOpen(false);
    setActive(-1);
    onChange(item.text);
    if (onCommit) onCommit(item.text);
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!items.length) return;
      event.preventDefault();
      if (!listVisible) {
        setOpen(true);
        setActive(event.key === "ArrowDown" ? 0 : items.length - 1);
        return;
      }
      setActive((index) => nextActiveIndex(index, items.length, event.key));
    } else if (event.key === "Enter") {
      if (listVisible && active >= 0) {
        event.preventDefault();
        choose(items[active]);
      }
      // Otherwise Enter submits the form: an immediate search.
    } else if (event.key === "Escape") {
      if (listVisible) {
        // Close only the list, not the surrounding filters panel.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const countText = listVisible ? t("jobBoard.suggest.count", { count: items.length }) : "";

  return (
    <div className="jsf-search" ref={wrapRef}>
      <FaSearch className="jsf-search-icon" aria-hidden="true" />
      <input
        id={id}
        type="text"
        name="q"
        enterKeyHint="search"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listVisible}
        aria-controls={listId}
        aria-activedescendant={listVisible && active >= 0 ? optionId(active) : undefined}
        className="ds-input filter-input filter-keyword"
        placeholder={placeholder}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          setFocused(true);
          if (items.length) setOpen(true);
        }}
        onBlur={() => {
          setFocused(false);
          setOpen(false);
        }}
        onKeyDown={handleKeyDown}
      />

      <ul id={listId} className="jsf-suggest" role="listbox" aria-label={t("jobBoard.suggest.label")} hidden={!listVisible}>
        {items.map((item, index) => (
          <li
            key={`${item.type}:${item.text}`}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            className={`jsf-suggest__option ${index === active ? "is-active" : ""}`}
            // Keep focus in the input so a click never blurs (and closes) the list first.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(item)}
          >
            <span className="jsf-suggest__text">
              {highlightParts(item.text, query).map((part, i) =>
                part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>
              )}
            </span>
            <span className="jsf-suggest__type">{t(`jobBoard.suggest.types.${item.type}`)}</span>
          </li>
        ))}
      </ul>

      <div className="ds-sr-only" role="status" aria-live="polite">{countText}</div>
      {failed && focused && !tooShort && (
        <p className="jsf-suggest-error" role="status">{t("jobBoard.suggest.error")}</p>
      )}
    </div>
  );
}
