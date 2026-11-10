export const optionalModules = {
  trafficControl: false
} as const;

const trafficControlPrefixes = ["/control", "/seguridad", "/configuracion/alertas-visuales"] as const;

export function isHiddenModulePath(pathname: string): boolean {
  if (optionalModules.trafficControl) return false;
  return trafficControlPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
