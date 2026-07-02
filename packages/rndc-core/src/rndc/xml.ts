import { XMLParser } from "fast-xml-parser";
import type { RndcConfig, RndcMessageRequest, RndcRawXml, RndcScalar, RndcXmlRecord, RndcXmlValue } from "./types.js";

export function rawXml(xml: string): RndcRawXml {
  return { kind: "rawXml", xml };
}

export function buildRndcXml(config: RndcConfig, request: RndcMessageRequest): string {
  const sections = [
    "<root>",
    "<acceso>",
    tag("username", config.username),
    tag("password", config.password),
    "</acceso>",
    "<solicitud>",
    tag("tipo", request.tipo),
    tag("procesoid", request.procesoId),
    "</solicitud>"
  ];

  if (request.variables) {
    const xml = typeof request.variables === "string" ? request.variables : recordToXml(request.variables);
    sections.push("<variables>", xml, "</variables>");
  }

  if (request.documento) {
    sections.push("<documento>", recordToXml(request.documento), "</documento>");
  }

  if (request.documentorango) {
    sections.push("<documentorango>", recordToXml(request.documentorango), "</documentorango>");
  }

  sections.push("</root>");
  return `<?xml version='1.0' encoding='ISO-8859-1' ?>\n${sections.join("\n")}`;
}

export function buildSoapEnvelope(requestXml: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:BPMServicesIntf-IBPMServices">',
    "<soapenv:Header/>",
    "<soapenv:Body>",
    '<urn:AtenderMensajeRNDC soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    `<Request xsi:type="xsd:string">${escapeXml(requestXml)}</Request>`,
    "</urn:AtenderMensajeRNDC>",
    "</soapenv:Body>",
    "</soapenv:Envelope>"
  ].join("");
}

export function extractSoapReturn(soapResponse: string): string {
  const match = soapResponse.match(/<return(?:\s[^>]*)?>([\s\S]*?)<\/return>/i);
  return match ? decodeXmlEntities(match[1].trim()) : soapResponse;
}

export function parseXml(xml: string): unknown {
  const parser = new XMLParser({
    ignoreAttributes: false,
    ignoreDeclaration: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true
  });
  return parser.parse(xml);
}

export function maskSecrets(value: string): string {
  return value
    .replace(/<username>[\s\S]*?<\/username>/gi, "<username>***</username>")
    .replace(/<password>[\s\S]*?<\/password>/gi, "<password>***</password>")
    .replace(/&lt;username&gt;[\s\S]*?&lt;\/username&gt;/gi, "&lt;username&gt;***&lt;/username&gt;")
    .replace(/&lt;password&gt;[\s\S]*?&lt;\/password&gt;/gi, "&lt;password&gt;***&lt;/password&gt;")
    .replace(/(name=["']USUARIO["'][^>]*value=["'])[^"']*(["'])/gi, "$1***$2")
    .replace(/(value=["'])[^"']*(["'][^>]*name=["']USUARIO["'])/gi, "$1***$2")
    .replace(/(name=["']PASSWORD["'][^>]*value=["'])[^"']*(["'])/gi, "$1***$2")
    .replace(/(value=["'])[^"']*(["'][^>]*name=["']PASSWORD["'])/gi, "$1***$2");
}

export function detectRndcError(parsed: unknown): string | undefined {
  const direct = findFirstText(parsed, [
    "ErrorMSG",
    "ERRORMSG",
    "error",
    "mensajeerror",
    "mensajerror",
    "descripcionerror",
    "mensaje"
  ]);

  if (direct && !looksLikeSuccessMessage(direct)) {
    return direct;
  }

  return undefined;
}

export function detectRadicado(parsed: unknown): string | undefined {
  return findFirstText(parsed, [
    "ingresoid",
    "INGRESOID",
    "ingresoidmanifiesto",
    "INGRESOIDMANIFIESTO",
    "ingresoidremesa",
    "INGRESOIDREMESA",
    "radicado",
    "RADICADO",
    "numradicacion",
    "NUMRADICACION"
  ]) ?? detectDuplicateAuthorization(findFirstText(parsed, [
    "ErrorMSG",
    "ERRORMSG",
    "error",
    "mensajeerror",
    "mensajerror",
    "descripcionerror",
    "mensaje"
  ]));
}

export function detectSeguridadQr(parsed: unknown): string | undefined {
  return findFirstText(parsed, ["seguridadqr", "SEGURIDADQR"]);
}

export function detectObservacionesQr(parsed: unknown): string | undefined {
  return findFirstText(parsed, ["observacionesqr", "OBSERVACIONESQR"]);
}

export function escapeXml(value: RndcScalar): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replace(/[\u0080-\uffff]/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function isDuplicateAuthorizationError(value: string | undefined): boolean {
  return Boolean(detectDuplicateAuthorization(value));
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function recordToXml(record: RndcXmlRecord): string {
  return Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([name, value]) => renderValue(name, value))
    .join("\n");
}

function renderValue(name: string, value: RndcXmlValue): string {
  if (isRawXml(value)) {
    return value.xml;
  }

  return tag(name, value as RndcScalar);
}

function tag(name: string, value: RndcScalar): string {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function isRawXml(value: RndcXmlValue): value is RndcRawXml {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "rawXml";
}

function findFirstText(value: unknown, names: string[]): string | undefined {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return findInValue(value, wanted);
}

function findInValue(value: unknown, wanted: Set<string>): string | undefined {
  if (value === null || value === undefined || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findInValue(item, wanted);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  for (const [key, child] of Object.entries(value)) {
    if (wanted.has(key.toLowerCase()) && isTextValue(child)) {
      return String(child);
    }

    const found = findInValue(child, wanted);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function isTextValue(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function looksLikeSuccessMessage(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("exitos") || normalized.includes("satisfactor");
}

function detectDuplicateAuthorization(value: string | undefined): string | undefined {
  return value?.match(/DUPLICADO:(\d+)/i)?.[1];
}
