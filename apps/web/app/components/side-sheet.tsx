"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function SideSheet({
  label,
  eyebrow,
  title,
  description,
  narrow = false,
  busy = false,
  onClose,
  footer,
  children,
}: {
  label: string;
  eyebrow?: string;
  title: string;
  description?: string;
  narrow?: boolean;
  busy?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const locked = useRef(busy);
  close.current = onClose;
  locked.current = busy;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheet.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !locked.current) close.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className="side-sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        aria-label={label}
        aria-modal="true"
        className={narrow ? "side-sheet narrow" : "side-sheet"}
        ref={sheet}
        role="dialog"
        tabIndex={-1}
      >
        <div className="side-sheet-head">
          <div>
            {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <button aria-label="Cerrar" className="side-sheet-close" disabled={busy} onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="side-sheet-body">{children}</div>
        {footer ? <div className="side-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
