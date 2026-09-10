import { ConvexError } from "convex/values";

export type JobTitle = "administrador" | "jefe_seguridad" | "auxiliar_seguridad";
export type AccountRole = "admin" | "operator" | "auditor" | "finance";

export const jobTitles: readonly JobTitle[] = ["administrador", "jefe_seguridad", "auxiliar_seguridad"];

export const jobTitleLabels: Record<JobTitle, string> = {
  administrador: "Administrador",
  jefe_seguridad: "Jefe de seguridad",
  auxiliar_seguridad: "Auxiliar de seguridad"
};

export function rolesForJobTitle(jobTitle: JobTitle): AccountRole[] {
  return jobTitle === "administrador" ? ["admin"] : ["operator"];
}

export function isJobTitle(value: unknown): value is JobTitle {
  return typeof value === "string" && (jobTitles as readonly string[]).includes(value);
}

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ConvexError({ code: "INVALID_ARGUMENT", message: "El correo no es válido" });
  }

  return email;
}

export function normalizeName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");

  if (name.length < 3 || name.length > 120) {
    throw new ConvexError({ code: "INVALID_ARGUMENT", message: "El nombre debe tener entre 3 y 120 caracteres" });
  }

  return name;
}

export function assertPasswordHash(value: string): void {
  if (!/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(value)) {
    throw new ConvexError({ code: "INVALID_ARGUMENT", message: "La contraseña no viene protegida correctamente" });
  }
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) {
    return "La contraseña debe tener al menos 10 caracteres";
  }

  if (password.length > 128) {
    return "La contraseña no puede superar 128 caracteres";
  }

  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "La contraseña debe combinar letras y números";
  }

  return null;
}
