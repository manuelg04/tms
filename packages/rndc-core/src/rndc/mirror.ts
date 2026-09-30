import {
  buildRndcDocumentQuery,
  normalizeRndcQueryRecords,
} from "./queries.js";
import type { RndcMessageResponse } from "./types.js";

export const mirrorProcesses = [3, 4, 5, 6, 9, 32, 28, 29] as const;
export type MirrorProcess = (typeof mirrorProcesses)[number];
export const mirrorVariables: Record<MirrorProcess, string[]> = {
  3: [
    "INGRESOID",
    "FECHAING",
    "CONSECUTIVOREMESA",
    "NUMMANIFIESTOCARGA",
    "NUMPLACA",
    "CANTIDADCARGADA",
  ],
  4: [
    "INGRESOID",
    "FECHAING",
    "NUMMANIFIESTOCARGA",
    "FECHAEXPEDICIONMANIFIESTO",
    "NUMPLACA",
    "NUMPLACAREMOLQUE",
    "NUMIDCONDUCTOR",
    "CODMUNICIPIOORIGENMANIFIESTO",
    "CODMUNICIPIODESTINOMANIFIESTO",
    "VALORFLETEPACTADOVIAJE",
  ],
  5: ["INGRESOID", "FECHAING", "CONSECUTIVOREMESA", "NUMMANIFIESTOCARGA"],
  6: ["INGRESOID", "FECHAING", "NUMMANIFIESTOCARGA"],
  9: ["INGRESOID", "FECHAING", "CONSECUTIVOREMESA"],
  32: ["INGRESOID", "FECHAING", "NUMMANIFIESTOCARGA"],
  28: ["INGRESOID", "FECHAING", "CONSECUTIVOREMESA"],
  29: ["INGRESOID", "FECHAING", "NUMMANIFIESTOCARGA"],
};

export function mirrorWindow(from: string, to: string) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new Error("Usa fechas AAAA-MM-DD.");
    const date = new Date(`${value}T00:00:00Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new Error("Fecha inválida.");
    return date;
  };
  const first = parse(from),
    last = parse(to);
  const days = (last.getTime() - first.getTime()) / 86400000 + 1;
  if (days < 1 || days > 31)
    throw new Error("Consulta entre 1 y 31 días por lote.");
  const exclusiveEnd = new Date(last.getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
  return {
    from,
    to,
    queryFrom: from.replaceAll("-", "/"),
    queryTo: exclusiveEnd.replaceAll("-", "/"),
  };
}

export function buildMirrorQuery(
  companyRndcNit: string,
  process: number,
  from: string,
  to: string,
) {
  if (!mirrorProcesses.includes(process as MirrorProcess))
    throw new Error("Proceso de espejo no permitido.");
  const window = mirrorWindow(from, to);
  return buildRndcDocumentQuery({
    companyRndcNit,
    processId: process,
    variables: mirrorVariables[process as MirrorProcess],
    range: { field: "FECHAING", from: window.queryFrom, to: window.queryTo },
  });
}

export function readMirrorResponse(
  response: RndcMessageResponse,
  from: string,
  to: string,
) {
  mirrorWindow(from, to);
  if (response.status < 200 || response.status >= 300)
    throw new Error("La consulta RNDC no tuvo una respuesta HTTP exitosa.");
  if (
    !response.ok &&
    !/^Error RNDC11: Documento no encontrado\./i.test(response.errorText ?? "")
  )
    throw new Error(response.errorText ?? "RNDC rechazó la consulta.");
  if (!response.ok) return [];
  const records = normalizeRndcQueryRecords(response.parsed);
  return records.filter((record) => {
    const date = mirrorDate(record.FECHAING ?? "");
    if (!record.INGRESOID || !date)
      throw new Error(
        "RNDC devolvió un registro sin radicado o fecha de ingreso válida.",
      );
    return date >= from && date <= to;
  });
}

export function mirrorDate(value: string): string {
  const text = value.trim().slice(0, 10);
  const reversed = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const iso = reversed
    ? `${reversed[3]}-${reversed[2]}-${reversed[1]}`
    : text.replaceAll("/", "-");
  const date = new Date(`${iso}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === iso
    ? iso
    : "";
}
