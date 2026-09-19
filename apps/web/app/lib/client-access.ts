export const clientAllowedPrefixes = ["/control/bitacora", "/seguridad/estudios", "/configuracion/mi-clave"] as const;

export function clientCanVisit(pathname: string): boolean {
  return clientAllowedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
