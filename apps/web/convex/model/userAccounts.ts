import { ConvexError } from "convex/values";

export type JobTitle = "administrador" | "jefe_seguridad" | "auxiliar_seguridad" | "empresa";
export type AccountRole = "admin" | "operator" | "auditor" | "finance" | "client";

export const jobTitles: readonly JobTitle[] = ["administrador", "jefe_seguridad", "auxiliar_seguridad", "empresa"];

export const jobTitleLabels: Record<JobTitle, string> = {
  administrador: "Superadministrador",
  jefe_seguridad: "Jefe de seguridad",
  auxiliar_seguridad: "Auxiliar de seguridad",
  empresa: "Empresa cliente"
};

export const jobTitleDescriptions: Record<JobTitle, string> = {
  administrador: "Gerencia: ve y gestiona todo, incluidos usuarios y eliminaciones.",
  jefe_seguridad: "Opera la bitácora, los estudios de seguridad y los maestros.",
  auxiliar_seguridad: "Registra reportes, monitorea viajes y realiza estudios de seguridad.",
  empresa: "Consulta en solo lectura los viajes y estudios de su propia empresa."
};

export function rolesForJobTitle(jobTitle: JobTitle): AccountRole[] {
  if (jobTitle === "administrador") return ["admin"];
  if (jobTitle === "empresa") return ["client"];
  return ["operator"];
}

export function requiresCustomer(jobTitle: JobTitle | undefined): boolean {
  return jobTitle === "empresa";
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
