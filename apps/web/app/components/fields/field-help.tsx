"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { lookupFieldHelp, rndcFieldHelp } from "../../lib/rndc-field-help";
import "./field-help.css";

const FieldHelpScope = createContext<Readonly<Record<string, string>>>(rndcFieldHelp);

export function FieldHelpProvider({ help, children }: { help: Readonly<Record<string, string>>; children: ReactNode }) {
  const parent = useContext(FieldHelpScope);
  const value = useMemo(() => ({ ...parent, ...help }), [parent, help]);
  return <FieldHelpScope.Provider value={value}>{children}</FieldHelpScope.Provider>;
}

export function useFieldHelp(name: string | undefined): string | undefined {
  const help = useContext(FieldHelpScope);
  return name ? lookupFieldHelp(help, name) : undefined;
}

export function HelpTip({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className={`field-help${open ? " open" : ""}`} ref={rootRef}>
      <button
        aria-describedby={id}
        aria-expanded={open}
        aria-label={label ? `Ayuda sobre ${label}` : "Ayuda sobre este campo"}
        className="field-help-toggle"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        type="button"
      >
        ?
      </button>
      <span className="field-help-bubble" id={id} role="tooltip">{text}</span>
    </span>
  );
}
