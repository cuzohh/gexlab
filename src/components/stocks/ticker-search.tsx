"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

export type TickerSuggestion = { symbol: string; name: string };

/**
 * The add-to-watchlist field, with suggestions.
 *
 * Typing a ticker from memory means knowing it exactly, and the field silently
 * rejected anything else — someone who wanted Palantir and typed PLNTR was told
 * only that a ticker is one to five letters. Suggestions come from the SEC
 * company list this workstation already keeps, so a keystroke is a lookup in
 * memory rather than a request to a third party, and the company name is shown
 * beside the symbol because that is the half the reader actually knows.
 *
 * Keyboard first: the arrow keys move through the list, Enter takes the
 * highlighted suggestion or, when nothing is highlighted, whatever has been
 * typed. Escape closes the list without clearing the field.
 */
export function TickerSearch({
  value,
  onChange,
  onSubmit,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Called with the chosen symbol, from the list or from the raw input. */
  onSubmit: (symbol: string) => void;
  error?: string;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<TickerSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const container = useRef<HTMLDivElement>(null);
  // A suggestion just taken should not immediately re-open the list it came from.
  const justChose = useRef(false);

  useEffect(() => {
    const query = value.trim();
    if (justChose.current) {
      justChose.current = false;
      return;
    }
    // An empty field shows nothing without having to be told: the visible list
    // is derived from the query below, so there is no state to clear here.
    if (!query) return;
    const controller = new AbortController();
    // Debounced: a five-letter ticker typed at speed is one request, not five.
    const timer = setTimeout(() => {
      fetch(`/api/tickers?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((payload: { suggestions?: TickerSuggestion[] }) => {
          setSuggestions(payload.suggestions ?? []);
          setHighlighted(-1);
          setOpen(true);
        })
        .catch(() => {
          // Suggestions are a convenience. The field still accepts a typed
          // ticker when the lookup is unavailable.
        });
    }, 120);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value]);

  // A click anywhere else dismisses the list.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Suggestions belong to the text that fetched them. Deriving the visible list
  // rather than clearing it on every keystroke keeps the state out of the
  // effect, and an empty field can never show a leftover list.
  const visible = value.trim() ? suggestions : [];
  const showList = open && visible.length > 0;

  function choose(symbol: string) {
    justChose.current = true;
    setOpen(false);
    setHighlighted(-1);
    setSuggestions([]);
    onSubmit(symbol);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (highlighted >= 0) {
      choose(visible[highlighted]?.symbol ?? value);
      return;
    }
    // Someone who typed "SOFI TECHNOLOGIES" and pressed Enter without arrowing
    // down means the company they were searching for, not a literal ticker.
    // Only text that could itself be a ticker is taken at face value.
    const typed = value.trim().toUpperCase();
    choose(/^[A-Z]{1,5}$/.test(typed) ? typed : visible[0]?.symbol ?? typed);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
      return;
    }
    if (!showList) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((current) => {
        const next = current + step;
        // Past either end returns to the typed text rather than wrapping, so
        // the reader can always get back to what they wrote.
        return next < -1 ? visible.length - 1 : next >= visible.length ? -1 : next;
      });
    }
  }

  return (
    <div className="sw-search" ref={container}>
      <form className="sw-bar__add" onSubmit={submit} role="search">
        <input
          id="watchlist-ticker"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          placeholder="Add ticker"
          aria-label="Add ticker"
          aria-invalid={error ? true : undefined}
          // The combobox pattern, so a screen reader announces the list and the
          // highlighted option rather than an input that mysteriously changes.
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
        />
        <button type="submit">Add</button>
      </form>

      {showList ? (
        <ul className="sw-search__list" id={listId} role="listbox" aria-label="Ticker suggestions">
          {visible.map((suggestion, index) => (
            <li key={suggestion.symbol}>
              <button
                type="button"
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlighted}
                data-highlighted={index === highlighted || undefined}
                // Pointer down rather than click: a click fires after blur, and
                // the blur had already closed the list out from under it.
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(suggestion.symbol);
                }}
                onMouseEnter={() => setHighlighted(index)}
              >
                <b>{suggestion.symbol}</b>
                <span>{suggestion.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
