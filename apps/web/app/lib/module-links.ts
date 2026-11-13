export type ModuleSlug = "ordenes" | "remesas" | "manifiestos";
export type ModuleAction = "insertar" | "listar" | "actualizar" | "eliminar" | "anular" | "imprimir" | "duplicar";

export type ModuleTarget = {
  viaje?: string;
  remesa?: string;
  doc?: string;
};

export function moduleHref(slug: ModuleSlug, action: ModuleAction, target: ModuleTarget = {}): string {
  const params = new URLSearchParams();
  if (target.viaje) params.set("viaje", target.viaje);
  if (target.remesa) params.set("remesa", target.remesa);
  if (target.doc) params.set("doc", target.doc);
  const query = params.toString();
  return `/documentos/${slug}/${action}${query ? `?${query}` : ""}`;
}

export function fulfillmentHref(expedienteId: string): string {
  return `/expedientes/${expedienteId}?stage=cumplido_inicial#cumplidos`;
}

export function tripHref(expedienteId: string): string {
  return `/expedientes/${expedienteId}`;
}
