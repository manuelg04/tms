"use client";

import { useEffect, useId, useRef, useState } from "react";

export type SearchOption = { key: string; title: string; subtitle?: string; badge?: string };

type Props = {
  label: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  selectedLabel?: string;
  options: SearchOption[] | undefined;
  onSearch: (term: string) => void;
  onSelect: (key: string) => void;
  onClear?: () => void;
  hint?: string;
  emptyText?: string;
  minLength?: number;
  mono?: boolean;
};

export function SearchSelect({ label, className = "", placeholder, required, disabled, selectedLabel, options, onSearch, onSelect, onClear, hint, emptyText = "Sin resultados", minLength = 2, mono }: Props) {
  const id = useId();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [options]);

  const searching = term.trim().length >= minLength;
  const list = open && searching ? options : undefined;
  const shown = open ? term : (selectedLabel ?? term);

  function choose(key: string) {
    onSelect(key);
    setOpen(false);
    setTerm("");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!list || list.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, list.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = list[active];
      if (option) choose(option.key);
    }
  }

  return (
    <div className={`form-field search-select ${selectedLabel ? "has-selection" : ""} ${className}`} ref={rootRef}>
      <span id={`${id}-label`}>{label}{required ? <em aria-hidden="true"> *</em> : null}</span>
      <div className="search-select-control">
        <input
          aria-autocomplete="list"
          aria-labelledby={`${id}-label`}
          aria-controls={`${id}-list`}
          aria-expanded={Boolean(list)}
          autoComplete="off"
          className={mono ? "mono" : undefined}
          disabled={disabled}
          onChange={(event) => {
            setTerm(event.target.value);
            onSearch(event.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setTerm(selectedLabel ?? term);
            if (!selectedLabel) onSearch(term);
            setOpen(!selectedLabel);
            requestAnimationFrame(() => inputRef.current?.select());
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          value={shown}
        />
        {selectedLabel && onClear && !disabled ? (
          <button aria-label={`Quitar ${label}`} className="search-select-clear" onClick={() => { onClear(); setTerm(""); inputRef.current?.focus(); }} type="button">×</button>
        ) : (
          <span aria-hidden="true" className="search-select-icon">{selectedLabel ? "✓" : "⌕"}</span>
        )}
        {list ? (
          <ul className="search-select-list" id={`${id}-list`} role="listbox">
            {list.length === 0 ? <li className="search-select-empty">{emptyText}</li> : null}
            {list.map((option, index) => (
              <li
                aria-selected={index === active}
                className={index === active ? "active" : undefined}
                key={option.key}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option.key)}
                role="option"
              >
                <div><strong>{option.title}</strong>{option.badge ? <em>{option.badge}</em> : null}</div>
                {option.subtitle ? <small>{option.subtitle}</small> : null}
              </li>
            ))}
          </ul>
        ) : open && !searching && !selectedLabel ? (
          <ul className="search-select-list" id={`${id}-list`} role="listbox"><li className="search-select-empty">Escribe al menos {minLength} caracteres</li></ul>
        ) : null}
      </div>
      {hint ? <small className="search-select-hint">{hint}</small> : null}
    </div>
  );
}
