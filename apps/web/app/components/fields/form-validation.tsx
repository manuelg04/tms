"use client";

import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ComponentProps, type FormEvent, type HTMLAttributes, type ReactNode, type Ref } from "react";

type FieldIssue = { name: string; message: string; label?: string };
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const FieldIssues = createContext<FieldIssue[]>([]);
const controlSelector = 'input:not([type="hidden"]), select, textarea, button[aria-haspopup="dialog"]';

export class FormValidationError extends Error {
  constructor(public field: string, message = "Completa este campo.") {
    super(message);
  }
}

function fieldName(field: HTMLElement): string {
  return field.dataset.fieldName || field.querySelector<Control>("[name]")?.name || "";
}

function fieldLabel(field: HTMLElement): string {
  return field.dataset.fieldLabel || field.querySelector(":scope > span")?.textContent?.replace(/\s*\*$/, "").trim() || field.querySelector(controlSelector)?.getAttribute("aria-label") || fieldName(field);
}

function collectIssues(form: HTMLFormElement): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const field of form.querySelectorAll<HTMLElement>("[data-form-field]")) {
    const control = field.querySelector<Control>(controlSelector);
    if (!control || control.matches(":disabled, [readonly]")) continue;
    const name = fieldName(field);
    const label = fieldLabel(field);
    const raw = field.dataset.fieldValue ?? control.value ?? "";
    const required = field.dataset.fieldRequired === "true" || control.required;
    let message = "";
    if (required && !raw.trim()) message = "Completa este campo.";
    else if (control.validity && !control.validity.valid) {
      if (control.validity.valueMissing) message = "Completa este campo.";
      else if (control.validity.rangeUnderflow) message = `El valor mínimo es ${(control as HTMLInputElement).min}.`;
      else if (control.validity.rangeOverflow) message = `El valor máximo es ${(control as HTMLInputElement).max}.`;
      else if (control.validity.badInput || control.validity.stepMismatch) message = "Ingresa un número válido con la precisión indicada.";
      else message = control.validationMessage;
    }
    if (message) issues.push({ name, label, message });
  }
  const data = new FormData(form);
  const minDate = String(data.get("minLoadingDate") ?? "");
  const maxDate = String(data.get("maxLoadingDate") ?? "");
  if (minDate && maxDate && maxDate < minDate) issues.push({ name: "maxLoadingDate", label: "Fecha máxima", message: "La fecha máxima no puede ser anterior a la fecha mínima." });
  return issues;
}

function focusField(form: HTMLFormElement, name: string) {
  const field = Array.from(form.querySelectorAll<HTMLElement>("[data-form-field]")).find((item) => fieldName(item) === name);
  const control = field?.querySelector<HTMLElement>(controlSelector);
  field?.scrollIntoView({ behavior: "instant", block: "center" });
  control?.focus({ preventScroll: true });
}

export function FormField({ as: Tag = "label", children, name, label, required, value, className = "", ref, ...props }: HTMLAttributes<HTMLElement> & { as?: "label" | "div"; name?: string; label?: string; required?: boolean; value?: string; ref?: Ref<HTMLElement> }) {
  const issues = useContext(FieldIssues);
  const fieldRef = useRef<HTMLElement | null>(null);
  const errorId = useId();
  const resolvedName = name || (fieldRef.current ? fieldName(fieldRef.current) : "");
  const issue = issues.find((item) => item.name === resolvedName);

  useLayoutEffect(() => {
    const control = fieldRef.current?.querySelector<HTMLElement>(controlSelector);
    if (!control) return;
    if (fieldRef.current && !control.hasAttribute("aria-label") && !control.hasAttribute("aria-labelledby")) control.setAttribute("aria-label", fieldLabel(fieldRef.current));
    const description = control.getAttribute("aria-describedby")?.split(" ").filter((id) => id !== errorId) ?? [];
    if (issue) {
      control.setAttribute("aria-invalid", "true");
      description.push(errorId);
    } else {
      control.removeAttribute("aria-invalid");
    }
    if (description.length) control.setAttribute("aria-describedby", description.join(" "));
    else control.removeAttribute("aria-describedby");
  }, [issue, errorId, children]);

  return <Tag {...props} className={`form-field ${className}${issue ? " has-error" : ""}`} data-form-field="" data-field-name={name} data-field-label={label} data-field-required={required} data-field-value={value} ref={(element: HTMLElement | null) => {
    fieldRef.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  }}>{children}{issue ? <small className="field-validation-error" id={errorId}>{issue.message}</small> : null}</Tag>;
}

export function ValidatedForm({ children, onSubmit, ref, ...props }: Omit<ComponentProps<"form">, "onSubmit"> & { onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>; children: ReactNode }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const submitting = useRef(false);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [error, setError] = useState("");

  function showIssues(next: FieldIssue[], form: HTMLFormElement) {
    setIssues(next);
    if (next.length) requestAnimationFrame(() => focusField(form, next[0].name));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    setError("");
    const next = collectIssues(form);
    showIssues(next, form);
    if (next.length) return;
    submitting.current = true;
    try {
      await onSubmit(event);
    } catch (cause) {
      if (cause instanceof FormValidationError) {
        const field = Array.from(form.querySelectorAll<HTMLElement>("[data-form-field]")).find((item) => fieldName(item) === cause.field);
        showIssues([{ name: cause.field, label: field ? fieldLabel(field) : undefined, message: cause.message }], form);
      } else {
        setError(cause instanceof Error ? cause.message : "No fue posible guardar. Intenta de nuevo.");
        requestAnimationFrame(() => form.querySelector<HTMLElement>(".form-validation-summary")?.focus());
      }
    } finally {
      submitting.current = false;
    }
  }

  function refreshIssues() {
    if (!issues.length) return;
    requestAnimationFrame(() => {
      if (!formRef.current) return;
      const next = collectIssues(formRef.current);
      setIssues((current) => next.filter((issue) => current.some((previous) => previous.name === issue.name)));
    });
  }

  return <FieldIssues.Provider value={issues}><form {...props} noValidate onSubmit={(event) => void submit(event)} onChangeCapture={refreshIssues} onClickCapture={refreshIssues} ref={(element) => {
    formRef.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  }}>{children}{issues.length || error ? <div className="form-error form-validation-summary" role="alert" tabIndex={-1}>
    {issues.length ? <><strong>Revisa los campos resaltados antes de guardar.</strong><ul>{issues.map((issue) => <li key={issue.name}><button type="button" onClick={() => formRef.current && focusField(formRef.current, issue.name)}>{issue.label ?? "Revisar campo"}: {issue.message}</button></li>)}</ul></> : error}
  </div> : null}</form></FieldIssues.Provider>;
}
