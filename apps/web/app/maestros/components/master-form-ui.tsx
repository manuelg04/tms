"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const MASTER_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MASTER_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export function MasterSection({ title, description, children, optional = false }: { title: string; description?: string; children: ReactNode; optional?: boolean }) {
  return (
    <fieldset className="master-editor-section">
      <legend>{title}</legend>
      {description ? <div className="master-section-intro"><p>{description}</p>{optional ? <span>Opcional</span> : null}</div> : optional ? <div className="master-section-intro"><span>Opcional</span></div> : null}
      <div className="master-editor-grid">{children}</div>
    </fieldset>
  );
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  wide?: boolean;
};

export function TextField({ label, hint, wide, required, className = "", ...props }: TextFieldProps) {
  return (
    <label className={`form-field ${wide ? "span-2" : ""} ${className}`.trim()}>
      <span>{label}{required ? <em aria-hidden="true"> *</em> : null}</span>
      <input required={required} {...props} />
      {hint ? <small className="search-select-hint">{hint}</small> : null}
    </label>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
};

export function SelectField({ label, hint, wide, required, className = "", children, ...props }: SelectFieldProps) {
  return (
    <label className={`form-field ${wide ? "span-2" : ""} ${className}`.trim()}>
      <span>{label}{required ? <em aria-hidden="true"> *</em> : null}</span>
      <select required={required} {...props}>{children}</select>
      {hint ? <small className="search-select-hint">{hint}</small> : null}
    </label>
  );
}

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
};

export function TextAreaField({ label, hint, required, ...props }: TextAreaFieldProps) {
  return (
    <label className="form-field span-2">
      <span>{label}{required ? <em aria-hidden="true"> *</em> : null}</span>
      <textarea required={required} {...props} />
      {hint ? <small className="search-select-hint">{hint}</small> : null}
    </label>
  );
}

export function CheckboxField({ label, name, value, defaultChecked, hint }: { label: string; name: string; value?: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="master-check-option">
      <input defaultChecked={defaultChecked} name={name} type="checkbox" value={value} />
      <span><strong>{label}</strong>{hint ? <small>{hint}</small> : null}</span>
    </label>
  );
}

export function ChoiceCards({ label, name, value, options, onChange }: { label: string; name: string; value: string; options: Array<{ value: string; label: string; description?: string }>; onChange: (value: string) => void }) {
  return (
    <div className="form-field span-2">
      <span>{label}</span>
      <div className="master-choice-grid">
        {options.map((option) => (
          <label className={value === option.value ? "master-choice selected" : "master-choice"} key={option.value}>
            <input checked={value === option.value} name={name} onChange={() => onChange(option.value)} type="radio" value={option.value} />
            <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function MasterPhotoPicker({ label, hint, file, onChange }: { label: string; hint?: string; file: File | null; onChange: (file: File | null) => void }) {
  const id = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function select(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) {
      onChange(null);
      setError(null);
      return;
    }
    if (!MASTER_IMAGE_TYPES.includes(selected.type)) {
      event.target.value = "";
      onChange(null);
      setError("Usa una imagen JPG, PNG o WebP.");
      return;
    }
    if (selected.size > MASTER_IMAGE_MAX_BYTES) {
      event.target.value = "";
      onChange(null);
      setError("La imagen debe pesar máximo 2 MB.");
      return;
    }
    setError(null);
    onChange(selected);
  }

  function clear() {
    if (inputRef.current) inputRef.current.value = "";
    setError(null);
    onChange(null);
  }

  return (
    <div className="master-photo-field">
      <div className="master-photo-preview">
        {preview ? <img alt={`Vista previa de ${label.toLowerCase()}`} src={preview} /> : <span aria-hidden="true">＋</span>}
      </div>
      <div className="master-photo-copy">
        <strong>{label}</strong>
        <small>{file ? `${file.name} · ${formatFileSize(file.size)}` : hint ?? "JPG, PNG o WebP · máximo 2 MB"}</small>
        <div className="master-photo-actions">
          <label className="ghost-button" htmlFor={id}>{file ? "Cambiar imagen" : "Seleccionar imagen"}</label>
          {file ? <button className="text-button" onClick={clear} type="button">Quitar</button> : null}
        </div>
        <input accept={MASTER_IMAGE_TYPES.join(",")} className="visually-hidden" id={id} onChange={select} ref={inputRef} type="file" />
        {error ? <span className="master-field-error" role="alert">{error}</span> : null}
      </div>
    </div>
  );
}

export function MasterSubmitBar({ saving, error, success }: { saving: boolean; error?: string | null; success?: string | null }) {
  return (
    <div className="master-submit-bar">
      <div className="master-submit-state" aria-live="polite">
        {error ? <span className="bad">{error}</span> : success ? <span className="ok">{success}</span> : <span>Los campos marcados con * son obligatorios.</span>}
      </div>
      <div className="master-submit-actions">
        <Link className="ghost-button" href="/maestros">Cancelar</Link>
        <button className="primary-action" disabled={saving} type="submit">{saving ? "Guardando…" : "Guardar maestro"}</button>
      </div>
    </div>
  );
}

export function MasterEditorHeader({ resource, description }: { resource: string; description: string }) {
  return (
    <header className="master-editor-hero">
      <div>
        <Link className="master-back-link" href="/maestros">← Volver a Maestros</Link>
        <span className="eyebrow">Nuevo registro</span>
        <h2>Nuevo {resource}</h2>
        <p>{description}</p>
      </div>
      <div className="master-editor-badge"><span>01</span><strong>Registro interno</strong><small>Se guarda sin enviar a RNDC</small></div>
    </header>
  );
}

function formatFileSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
