"use client";

export function ActionBar({
  label,
  pending,
  missing,
  onSubmit
}: {
  label: string;
  pending: boolean;
  missing: string[];
  onSubmit: () => void;
}) {
  const blocked = missing.length > 0;

  return (
    <div className="action-bar">
      {blocked ? (
        <span className="action-note warn">Faltan: {missing.join(", ")}</span>
      ) : (
        <span className="action-note">Listo para enviar al RNDC</span>
      )}
      <button className="primary-action" disabled={pending || blocked} onClick={onSubmit} type="button">
        {pending ? "Enviando…" : label}
      </button>
    </div>
  );
}
