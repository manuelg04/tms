"use client";

import { useState } from "react";
import { FormField } from "./form-validation";
import { RNDC_TEXT_LIMITS, fitRndcText, rndcTextLength, type RndcTextField } from "../../../convex/model/rndcTextLimits";

export function LimitedTextarea({ className, field, label, name, rows, value }: { className?: string; field: RndcTextField; label: string; name: string; rows: number; value?: string }) {
  const limit = RNDC_TEXT_LIMITS[field];
  const [text, setText] = useState(value ?? "");
  const length = rndcTextLength(text);
  const over = length > limit;
  return (
    <FormField className={className}>
      <span>{label}</span>
      <textarea aria-describedby={`${name}-count`} aria-invalid={over || undefined} name={name} onChange={(event) => setText(event.target.value.length > limit && event.target.value.length > text.length ? event.target.value.slice(0, Math.max(limit, text.length)) : event.target.value)} rows={rows} value={text} />
      <small className={over ? "text-count over" : "text-count"} id={`${name}-count`}>
        {over ? `${length} de ${limit} caracteres: el RNDC rechaza el documento si pasa de ${limit}. Recorta ${length - limit}.` : `${length} de ${limit} caracteres`}
      </small>
      {over ? <button className="text-button" onClick={() => setText(fitRndcText(field, text))} type="button">Recortar a {limit}</button> : null}
    </FormField>
  );
}
