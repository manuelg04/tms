"use client";

import { useState } from "react";

export function formatThousands(digits: string): string {
  const clean = digits.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function MoneyField({ className = "", label, name, value, onChange, required, readOnly, hint }: { className?: string; label: string; name: string; value?: string; onChange?: (raw: string) => void; required?: boolean; readOnly?: boolean; hint?: string }) {
  const [internal, setInternal] = useState(() => (value ?? "").replace(/\D/g, ""));
  const raw = onChange ? (value ?? "").replace(/\D/g, "") : internal;
  return (
    <label className={`form-field money-field ${className}`}>
      <span>{label}{required ? <em aria-hidden="true"> *</em> : null}</span>
      <div className="money-input">
        <span>$</span>
        <input
          inputMode="numeric"
          onChange={(event) => {
            const next = event.target.value.replace(/\D/g, "");
            if (onChange) onChange(next);
            else setInternal(next);
          }}
          placeholder="0"
          readOnly={readOnly}
          value={formatThousands(raw)}
        />
      </div>
      <input name={name} type="hidden" value={raw} />
      {hint ? <small className="search-select-hint">{hint}</small> : null}
    </label>
  );
}
