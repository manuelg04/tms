export function StatusBadge({ status }: { status: string }) {
  const label = status === "ready"
    ? "Listo"
    : status === "succeeded"
      ? "Completado"
    : status === "in_progress"
      ? "En viaje"
      : status === "completed"
        ? "Completado"
        : status === "cancelled"
          ? "Cancelado"
          : status === "authorized"
            ? "Autorizado"
            : status === "fulfilled"
              ? "Cumplido"
              : status === "annulled"
                ? "Anulado"
                : status === "rejected" || status === "failed"
                  ? "Requiere atencion"
                  : status === "uncertain"
                    ? "Incierto"
                    : status === "reconciling"
                      ? "Conciliando"
                  : status === "pending" || status === "queued" || status === "claimed"
                    ? "Pendiente"
                    : "Borrador";
  const tone = ["ready", "authorized", "fulfilled", "completed", "succeeded"].includes(status)
    ? "ok"
    : ["rejected", "failed", "cancelled"].includes(status)
      ? "bad"
      : ["pending", "queued", "claimed", "uncertain", "reconciling"].includes(status)
        ? "wait"
        : "neutral";
  return <span className={`status-badge ${tone}`}><span className="status-dot" />{label}</span>;
}
