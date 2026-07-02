import { createHash } from "node:crypto";
import { endpointUrlFor, requireLiveCredentials, wstestUrlFor } from "./config.js";
import { hasRndcDocuments } from "./masterData.js";
import type { RndcConfig, RndcMessageRequest, RndcMessageResponse } from "./types.js";
import {
  buildRndcXml,
  buildSoapEnvelope,
  detectObservacionesQr,
  detectRadicado,
  detectRndcError,
  detectSeguridadQr,
  escapeXml,
  extractSoapReturn,
  isDuplicateAuthorizationError,
  maskSecrets,
  parseXml
} from "./xml.js";

export class RndcClient {
  constructor(private readonly config: RndcConfig) {}

  async sendMessage(request: RndcMessageRequest): Promise<RndcMessageResponse> {
    requireLiveCredentials(this.config);

    const requestXml = buildRndcXml(this.config, request);
    const soapRequest = buildSoapEnvelope(requestXml);
    const endpointUrl = endpointUrlFor(this.config, request);
    const wstestUrl = wstestUrlFor(this.config, request);

    if (this.config.mode === "dry-run") {
      return simulateResponse(this.config, request, requestXml, soapRequest, endpointUrl);
    }

    if (this.config.transport === "wstest") {
      return postWstest(this.config, request, requestXml, soapRequest, wstestUrl);
    }

    const response = await postSoap(endpointUrl, soapRequest, this.config.timeoutMs);
    const soapResponse = await response.text();
    const rndcResponseXml = extractSoapReturn(soapResponse);
    const parsed = safeParse(rndcResponseXml);
    const errorText = detectRndcError(parsed);
    const radicado = detectRadicado(parsed);
    const seguridadQr = detectSeguridadQr(parsed);
    const observacionesQr = detectObservacionesQr(parsed);

    return {
      endpointUrl,
      requestXml: maskSecrets(requestXml),
      soapRequest: maskSecrets(soapRequest),
      soapResponse,
      rndcResponseXml,
      parsed,
      status: response.status,
      ok: isAcceptedResponse(response.ok, request, parsed, radicado, errorText),
      mode: this.config.mode,
      transport: this.config.transport,
      errorText,
      radicado,
      seguridadQr,
      observacionesQr
    };
  }

  async sendRawXml(requestXml: string, procesoId: number): Promise<RndcMessageResponse> {
    requireLiveCredentials(this.config);

    const unmaskedRequestXml = requestXml
      .replace(/<username>[\s\S]*?<\/username>/i, `<username>${escapeXml(this.config.username)}</username>`)
      .replace(/<password>[\s\S]*?<\/password>/i, `<password>${escapeXml(this.config.password)}</password>`);
    const soapRequest = buildSoapEnvelope(unmaskedRequestXml);
    const request: RndcMessageRequest = { tipo: 1, procesoId };
    const endpointUrl = endpointUrlFor(this.config, request);
    const wstestUrl = wstestUrlFor(this.config, request);

    if (this.config.mode === "dry-run") {
      return simulateResponse(this.config, request, unmaskedRequestXml, soapRequest, endpointUrl);
    }

    if (this.config.transport === "wstest") {
      return postWstest(this.config, request, unmaskedRequestXml, soapRequest, wstestUrl);
    }

    const response = await postSoap(endpointUrl, soapRequest, this.config.timeoutMs);
    const soapResponse = await response.text();
    const rndcResponseXml = extractSoapReturn(soapResponse);
    const parsed = safeParse(rndcResponseXml);
    const errorText = detectRndcError(parsed);
    const radicado = detectRadicado(parsed);
    const seguridadQr = detectSeguridadQr(parsed);
    const observacionesQr = detectObservacionesQr(parsed);

    return {
      endpointUrl,
      requestXml: maskSecrets(unmaskedRequestXml),
      soapRequest: maskSecrets(soapRequest),
      soapResponse,
      rndcResponseXml,
      parsed,
      status: response.status,
      ok: isAcceptedResponse(response.ok, request, parsed, radicado, errorText),
      mode: this.config.mode,
      transport: this.config.transport,
      errorText,
      radicado,
      seguridadQr,
      observacionesQr
    };
  }
}

export function buildFailureResponse(config: RndcConfig, request: RndcMessageRequest, error: unknown): RndcMessageResponse {
  const message = error instanceof Error ? error.message : "Unexpected RNDC call failure";

  return {
    endpointUrl: config.transport === "wstest" ? wstestUrlFor(config, request) : endpointUrlFor(config, request),
    requestXml: "",
    soapRequest: "",
    soapResponse: "",
    rndcResponseXml: "",
    parsed: { error: message },
    status: 0,
    ok: false,
    mode: config.mode,
    transport: config.transport,
    errorText: message
  };
}

async function postWstest(config: RndcConfig, request: RndcMessageRequest, requestXml: string, soapRequest: string, wstestUrl: string): Promise<RndcMessageResponse> {
  const first = await fetch(wstestUrl, { signal: AbortSignal.timeout(config.timeoutMs) });
  const html = await first.text();
  const cookie = first.headers.get("set-cookie")?.split(";")[0] ?? "";
  const viewState = matchInputValue(html, "__VIEWSTATE");
  const generator = matchInputValue(html, "__VIEWSTATEGENERATOR");
  const body = new URLSearchParams();
  body.set("__VIEWSTATE", viewState);
  body.set("__VIEWSTATEGENERATOR", generator);
  body.set("__VIEWSTATEENCRYPTED", "");
  body.set("USUARIO", config.username);
  body.set("PASSWORD", config.password);
  body.set("PROCESOID", String(request.procesoId));
  body.set("NOMBREPROCESO", "");
  body.set("XMLRemesa", requestXml);
  body.set("lbSalida", "");
  body.set("btConsumir", "Consumir Servicio");

  const response = await fetch(wstestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie
    },
    body,
    signal: AbortSignal.timeout(config.timeoutMs)
  });
  const htmlResponse = await response.text();
  const encodedReturn = matchTextareaValue(htmlResponse, "lbSalida");
  const rndcResponseXml = decodeHtml(encodedReturn);
  const storedResponse = rndcResponseXml || `RNDC wstest response did not include lbSalida. HTTP ${response.status}`;
  const parsed = safeParse(rndcResponseXml);
  const errorText = detectRndcError(parsed);
  const radicado = detectRadicado(parsed);
  const seguridadQr = detectSeguridadQr(parsed);
  const observacionesQr = detectObservacionesQr(parsed);

  return {
    endpointUrl: wstestUrl,
    requestXml: maskSecrets(requestXml),
    soapRequest: maskSecrets(soapRequest),
    soapResponse: maskSecrets(storedResponse),
    rndcResponseXml,
    parsed,
    status: response.status,
    ok: isAcceptedResponse(response.ok, request, parsed, radicado, errorText),
    mode: config.mode,
    transport: config.transport,
    errorText,
    radicado,
    seguridadQr,
    observacionesQr
  };
}

async function postSoap(endpointUrl: string, soapRequest: string, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "urn:BPMServicesIntf-IBPMServices#AtenderMensajeRNDC"
      },
      body: soapRequest,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown network error";
    const cause = readCauseMessage(error);
    const suffix = cause && cause !== message ? ` (${cause})` : "";
    throw new Error(`Could not reach RNDC endpoint ${endpointUrl}: ${message}${suffix}`);
  }
}

function simulateResponse(config: RndcConfig, request: RndcMessageRequest, requestXml: string, soapRequest: string, endpointUrl: string): RndcMessageResponse {
  if (Number(request.tipo) !== 1) {
    return simulateQueryResponse(config, request, requestXml, soapRequest, endpointUrl);
  }

  const radicado = makeRadicado(requestXml);
  const seguridadQr = `SEG-${radicado.slice(-8)}`;
  const observacionesQr = request.procesoId === 4 ? "MANIFIESTO AUTORIZADO EN MODO DRY-RUN" : "REGISTRO ACEPTADO EN MODO DRY-RUN";
  const rndcResponseXml = buildSimulatedRndcXml(Number(request.procesoId), radicado, seguridadQr, observacionesQr);
  const parsed = safeParse(rndcResponseXml);

  return {
    endpointUrl,
    requestXml: maskSecrets(requestXml),
    soapRequest: maskSecrets(soapRequest),
    soapResponse: buildSimulatedSoapResponse(rndcResponseXml),
    rndcResponseXml,
    parsed,
    status: 200,
    ok: true,
    mode: config.mode,
    transport: config.transport,
    radicado,
    seguridadQr,
    observacionesQr
  };
}

function simulateQueryResponse(config: RndcConfig, request: RndcMessageRequest, requestXml: string, soapRequest: string, endpointUrl: string): RndcMessageResponse {
  const rndcResponseXml = buildSimulatedQueryXml(request);
  const parsed = safeParse(rndcResponseXml);

  return {
    endpointUrl,
    requestXml: maskSecrets(requestXml),
    soapRequest: maskSecrets(soapRequest),
    soapResponse: buildSimulatedSoapResponse(rndcResponseXml),
    rndcResponseXml,
    parsed,
    status: 200,
    ok: hasRndcDocuments(parsed),
    mode: config.mode,
    transport: config.transport
  };
}

function buildSimulatedQueryXml(request: RndcMessageRequest): string {
  const procesoId = Number(request.procesoId);
  const document = request.documento ?? {};

  if (procesoId === 11) {
    const idType = cleanQueryLiteral(String(document.CODTIPOIDTERCERO ?? "C"));
    const id = String(document.NUMIDTERCERO ?? "123456789");
    return [
      '<?xml version="1.0" encoding="ISO-8859-1" ?>',
      "<root>",
      "<documento>",
      `<CODTIPOIDTERCERO>${escapeXml(idType)}</CODTIPOIDTERCERO>`,
      `<NUMIDTERCERO>${escapeXml(id)}</NUMIDTERCERO>`,
      "<NOMIDTERCERO>CONDUCTOR RNDC DRY RUN</NOMIDTERCERO>",
      "<PRIMERAPELLIDOIDTERCERO>LOCAL</PRIMERAPELLIDOIDTERCERO>",
      "<NUMCELULARPERSONA>3000000000</NUMCELULARPERSONA>",
      "<CODMUNICIPIORNDC>11001000</CODMUNICIPIORNDC>",
      "<CODCATEGORIALICENCIACONDUCCION>C3</CODCATEGORIALICENCIACONDUCCION>",
      `<NUMLICENCIACONDUCCION>LC${escapeXml(id)}</NUMLICENCIACONDUCCION>`,
      "<FECHAVENCIMIENTOLICENCIA>31/12/2030</FECHAVENCIMIENTOLICENCIA>",
      "</documento>",
      "</root>"
    ].join("\n");
  }

  if (procesoId === 12) {
    const plate = cleanQueryLiteral(String(document.NUMPLACA ?? "ABC123")).toUpperCase();
    return [
      '<?xml version="1.0" encoding="ISO-8859-1" ?>',
      "<root>",
      "<documento>",
      `<NUMPLACA>${escapeXml(plate)}</NUMPLACA>`,
      "<CODCONFIGURACIONUNIDADCARGA>55</CODCONFIGURACIONUNIDADCARGA>",
      "<NUMIDPROPIETARIO>123456789</NUMIDPROPIETARIO>",
      "<NUMIDTENEDOR>123456789</NUMIDTENEDOR>",
      "<CAPACIDADUNIDADCARGA>34000</CAPACIDADUNIDADCARGA>",
      "<NUMSEGUROSOAT>SOAT-DRY-RUN</NUMSEGUROSOAT>",
      "<FECHAVENCIMIENTOSOAT>31/12/2030</FECHAVENCIMIENTOSOAT>",
      "</documento>",
      "</root>"
    ].join("\n");
  }

  return [
    '<?xml version="1.0" encoding="ISO-8859-1" ?>',
    "<root>",
    "<documento>",
    "<resultado>CONSULTA RNDC DRY-RUN</resultado>",
    "</documento>",
    "</root>"
  ].join("\n");
}

function isAcceptedResponse(responseOk: boolean, request: RndcMessageRequest, parsed: unknown, radicado: string | undefined, errorText: string | undefined): boolean {
  if (!responseOk) {
    return false;
  }

  if (errorText && !isDuplicateAuthorizationError(errorText)) {
    return false;
  }

  if (Number(request.tipo) === 1) {
    return Boolean(radicado);
  }

  return hasRndcDocuments(parsed);
}

function cleanQueryLiteral(value: string): string {
  return value.replace(/^'+|'+$/g, "");
}

function buildSimulatedRndcXml(procesoId: number, radicado: string, seguridadQr: string, observacionesQr: string): string {
  const extra = procesoId === 4 ? `<ingresoidmanifiesto>${radicado}</ingresoidmanifiesto>` : procesoId === 3 ? `<ingresoidremesa>${radicado}</ingresoidremesa>` : "";

  return [
    '<?xml version="1.0" encoding="ISO-8859-1" ?>',
    "<root>",
    `<ingresoid>${radicado}</ingresoid>`,
    extra,
    `<seguridadqr>${seguridadQr}</seguridadqr>`,
    `<observacionesqr>${observacionesQr}</observacionesqr>`,
    "</root>"
  ].filter(Boolean).join("\n");
}

function buildSimulatedSoapResponse(rndcResponseXml: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">',
    "<SOAP-ENV:Body>",
    "<return>",
    escapeForSoapReturn(rndcResponseXml),
    "</return>",
    "</SOAP-ENV:Body>",
    "</SOAP-ENV:Envelope>"
  ].join("");
}

function makeRadicado(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  const numeric = BigInt(`0x${hash.slice(0, 12)}`) % 100000000n;
  return `9${numeric.toString().padStart(8, "0")}`;
}

function escapeForSoapReturn(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function safeParse(xml: string): unknown {
  try {
    return parseXml(xml);
  } catch {
    return { raw: xml };
  }
}

function matchInputValue(html: string, name: string): string {
  return html.match(new RegExp(`name="${escapeRegExp(name)}"[^>]*value="([^"]*)"`, "i"))?.[1] ?? "";
}

function matchTextareaValue(html: string, name: string): string {
  const marker = `<textarea name="${name}"`;
  const start = html.indexOf(marker);
  if (start === -1) {
    return "";
  }

  const openEnd = html.indexOf(">", start);
  if (openEnd === -1) {
    return "";
  }

  const close = html.indexOf("</textarea>", openEnd + 1);
  if (close === -1) {
    return "";
  }

  return html.slice(openEnd + 1, close).trim();
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readCauseMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("cause" in error)) {
    return undefined;
  }

  const cause = (error as { cause?: unknown }).cause;

  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "string") {
    return cause;
  }

  return undefined;
}
