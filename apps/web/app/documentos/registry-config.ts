import type {
  RegistryKind,
  RegistryRow,
} from "../../convex/model/documentRegistry";

export type RegistryAction =
  | "insertar"
  | "listar"
  | "actualizar"
  | "eliminar"
  | "anular"
  | "imprimir"
  | "duplicar";
export type RegistrySection = "ordenes" | "remesas" | "manifiestos";
export type RegistryModule = {
  slug: RegistrySection;
  label: string;
  singular: string;
  numberLabel: string;
  kind: RegistryKind;
  stage: "orden_cargue" | "remesas" | "manifiesto";
  actions: RegistryAction[];
};

export const registryModules: RegistryModule[] = [
  {
    slug: "ordenes",
    label: "Orden de carga",
    singular: "orden de cargue",
    numberLabel: "Nro. Orden Cargue",
    kind: "orden_cargue",
    stage: "orden_cargue",
    actions: [
      "insertar",
      "listar",
      "actualizar",
      "eliminar",
      "anular",
      "imprimir",
    ],
  },
  {
    slug: "remesas",
    label: "Remesas",
    singular: "remesa",
    numberLabel: "Nro. Remesa",
    kind: "remesa",
    stage: "remesas",
    actions: [
      "insertar",
      "listar",
      "actualizar",
      "anular",
      "eliminar",
      "imprimir",
    ],
  },
  {
    slug: "manifiestos",
    label: "Manifiestos",
    singular: "manifiesto",
    numberLabel: "Nro. Manifiesto",
    kind: "manifiesto",
    stage: "manifiesto",
    actions: [
      "insertar",
      "listar",
      "actualizar",
      "anular",
      "imprimir",
      "duplicar",
    ],
  },
];

export const actionLabels: Record<RegistryAction, string> = {
  insertar: "Insertar",
  listar: "Listar",
  actualizar: "Actualizar",
  eliminar: "Eliminar",
  anular: "Anular",
  imprimir: "Imprimir",
  duplicar: "Duplicar",
};

export function registryColumns(
  module: RegistryModule,
): Array<{ key: keyof RegistryRow; label: string }> {
  return [
    { key: "number", label: module.numberLabel },
    { key: "date", label: "Fecha" },
    { key: "plate", label: "Placa" },
    { key: "customer", label: "Cliente" },
    { key: "agency", label: "Agencia" },
    { key: "origin", label: "Origen" },
    ...(module.slug === "ordenes"
      ? []
      : [{ key: "destination" as const, label: "Destino" }]),
    { key: "status", label: "Estado" },
    { key: "createdBy", label: "Creado por" },
    { key: "createdAtLabel", label: "Fecha Creación" },
  ];
}
