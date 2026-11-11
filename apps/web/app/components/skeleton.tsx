import type { CSSProperties } from "react";

type SkeletonVariant = "table" | "detail" | "cards" | "block" | "inline";

const widths = [92, 78, 86, 64, 88, 72, 81, 69];

export function Skeleton({
  label = "Cargando",
  variant = "table",
  rows = 6,
  height,
}: {
  label?: string;
  variant?: SkeletonVariant;
  rows?: number;
  height?: number;
}) {
  const style: CSSProperties | undefined = height ? { height } : undefined;
  return (
    <div aria-busy="true" className={`skeleton skeleton-${variant}`} role="status" style={style}>
      <span className="sr-only">{label}…</span>
      {variant === "cards" ? (
        <div className="skeleton-cards" aria-hidden>
          {Array.from({ length: 4 }, (_, index) => <span className="skeleton-bar skeleton-card" key={index} />)}
        </div>
      ) : null}
      {variant === "detail" ? (
        <div className="skeleton-detail" aria-hidden>
          <span className="skeleton-bar skeleton-title" />
          <span className="skeleton-bar skeleton-subtitle" />
          <div className="skeleton-cards">
            {Array.from({ length: 3 }, (_, index) => <span className="skeleton-bar skeleton-card" key={index} />)}
          </div>
        </div>
      ) : null}
      {variant === "block" ? <span className="skeleton-bar skeleton-fill" aria-hidden /> : null}
      {variant === "inline" ? <span className="skeleton-bar skeleton-line" aria-hidden style={{ width: "40%" }} /> : null}
      {variant === "table" || variant === "detail" || variant === "cards" ? (
        <div className="skeleton-rows" aria-hidden>
          {Array.from({ length: rows }, (_, index) => (
            <span className="skeleton-bar skeleton-line" key={index} style={{ width: `${widths[index % widths.length]}%` }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
