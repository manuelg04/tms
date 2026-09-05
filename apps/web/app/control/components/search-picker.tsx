"use client";

import { useId, useState } from "react";

export function SearchPicker({
  label,
  value,
  onChange,
  options,
  onSelect,
  maxLength = 50,
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ key: string; label: string }>;
  onSelect: (key: string) => void;
  maxLength?: number;
  readOnly?: boolean;
}) {
  const id = useId(),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1);
  return (
    <div className="tracking-picker">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={`${id}-list`}
        aria-expanded={open && options.length > 0}
        aria-activedescendant={
          open && active >= 0 ? `${id}-${active}` : undefined
        }
        autoComplete="off"
        readOnly={readOnly}
        maxLength={maxLength}
        value={value}
        onFocus={() => {
          if (!readOnly) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, options.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          }
          if (e.key === "Enter" && open && active >= 0 && options[active]) {
            e.preventDefault();
            onSelect(options[active].key);
            setOpen(false);
          }
        }}
      />
      {open && options.length > 0 && !readOnly ? (
        <ul id={`${id}-list`} role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <li
              id={`${id}-${index}`}
              role="option"
              aria-selected={active === index}
              key={option.key}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(option.key);
                setOpen(false);
              }}
              onMouseEnter={() => setActive(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
