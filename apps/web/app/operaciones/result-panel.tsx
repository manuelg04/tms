"use client";

import type { FormResult } from "./operations-config";

export function ResultPanel({
  result,
  error,
  processIds,
  route,
  plate,
  apiBase
}: {
  result: FormResult | null;
  error: string;
  processIds: string;
  route: string;
  plate: string;
  apiBase: string;
}) {
  const documentLinks = result?.documents ?? [];

  return (
    <aside className="result-panel" aria-live="polite">
      <div className={result?.ok ? "status-card success" : error ? "status-card danger" : "status-card"}>
        <span className="eyebrow">Estado del envio</span>
        <br />
        <strong className="status-word">
          {result?.ok ? "Aceptado por RNDC" : error ? "Revisar" : "Sin envio"}
        </strong>
        {!result && !error ? (
          <p className="error-text" style={{ color: "var(--ink-soft)" }}>
            {processIds} · {route}
          </p>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
      </div>

      {result ? (
        <div className="panel">
          <div className="panel-head">
            <h2>Pasos RNDC</h2>
            <span className="plate-chip">{plate}</span>
          </div>
          <div className="step-list">
            {result.steps.map((step) => (
              <div className={step.accepted ? "step-row ok" : "step-row fail"} key={`${step.name}-${step.procesoId}`}>
                <div className="step-name">
                  <strong>{step.title}</strong>
                  <span>proceso {step.procesoId}</span>
                </div>
                <em>{step.radicado ?? step.errorText ?? "sin radicado"}</em>
              </div>
            ))}
          </div>

          {documentLinks.length > 0 ? (
            <div className="documents-row">
              {documentLinks.map((document) => (
                <a
                  className="pdf-link"
                  href={`${apiBase}${document.urlPath}`}
                  key={`${document.kind}-${document.number}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  PDF {document.number}
                </a>
              ))}
            </div>
          ) : null}

          <p className={result.convexSync?.synced ? "sync-note ok" : "sync-note"}>
            {result.convexSync?.synced
              ? "Registrado en el panel."
              : `No quedo registrado en el panel: ${result.convexSync?.reason ?? "sin conexion con Convex"}`}
          </p>

          <code className="evidence">{result.evidencePath}</code>
        </div>
      ) : null}
    </aside>
  );
}
