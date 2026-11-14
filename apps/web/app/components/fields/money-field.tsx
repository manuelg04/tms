"use client";

import { amountInWords } from "../../../convex/model/moneyChecks";
import { FormField } from "./form-validation";

import { useState } from "react";

export function formatThousands(digits: string): string {
  const clean = digits.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function MoneyField({ className = "", label, name, value, onChange, required, readOnly, hint, alert }: { className?: string; label: string; name: string; value?: string; onChange?: (raw: string) => void; required?: boolean; readOnly?: boolean; hint?: string; alert?: { tone: "warning" | "error"; message: string } }) {
  const [internal, setInternal] = useState(() => (value ?? "").replace(/\D/g, ""));
  const [focused, setFocused] = useState(false);
  const raw = onChange ? (value ?? "").replace(/\D/g, "") : internal;
  const words = !readOnly && (focused || alert) && Number(raw) > 0 ? amountInWords(raw) : "";
  return (
    <FormField name={name} required={required} value={raw} className={`money-field ${className}${alert ? ` money-${alert.tone}` : ""}`}>
      <span>{label}{required ? <em aria-hidden="true"> *</em> : null}</span>
      <div className="money-input">
        <span>$</span>
        <input
          inputMode="numeric"
          onBlur={() => setFocused(false)}
          onFocus={() => setFocused(true)}
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
      {words ? <small className="money-words">{words}</small> : null}
      {alert ? <small className="money-alert" role="status">{alert.message}</small> : null}
      {hint ? <small className="search-select-hint">{hint}</small> : null}
    </FormField>
  );
}
