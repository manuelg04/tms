import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../rndc/config.js";
import { buildRndcXml, buildSoapEnvelope, detectRadicado, isDuplicateAuthorizationError, maskSecrets, parseXml } from "../rndc/xml.js";

test("builds an RNDC XML request with required root sections", () => {
  const config = loadConfig({
    username: "USER",
    password: "SECRET",
    companyNit: "900773684",
    companyDv: "9",
    companyRndcNit: "9007736849"
  });

  const xml = buildRndcXml(config, {
    tipo: 1,
    procesoId: 4,
    variables: {
      NUMNITEMPRESATRANSPORTE: "9007736849",
      NUMMANIFIESTOCARGA: "0000001"
    }
  });

  assert.match(xml, /<root>/);
  assert.match(xml, /<acceso>/);
  assert.match(xml, /<solicitud>/);
  assert.match(xml, /<variables>/);
  assert.match(xml, /<procesoid>4<\/procesoid>/);
  assert.match(xml, /<NUMMANIFIESTOCARGA>0000001<\/NUMMANIFIESTOCARGA>/);
  assert.doesNotMatch(maskSecrets(xml), /SECRET/);
  assert.doesNotMatch(maskSecrets(xml), /USER/);
});

test("wraps RNDC XML inside the SOAP request parameter", () => {
  const envelope = buildSoapEnvelope("<root><x>1</x></root>");
  assert.match(envelope, /AtenderMensajeRNDC/);
  assert.match(envelope, /&lt;root&gt;&lt;x&gt;1&lt;\/x&gt;&lt;\/root&gt;/);
});

test("parses an RNDC success response", () => {
  const parsed = parseXml('<?xml version="1.0" encoding="ISO-8859-1" ?><root><ingresoid>123</ingresoid></root>');
  assert.deepEqual(parsed, { root: { ingresoid: "123" } });
});

test("escapes non-ASCII characters as numeric entities for ISO-8859-1 transport", () => {
  const config = loadConfig({
    username: "USER",
    password: "SECRET",
    companyNit: "900773684",
    companyDv: "9",
    companyRndcNit: "9007736849"
  });

  const xml = buildRndcXml(config, {
    tipo: 1,
    procesoId: 11,
    variables: {
      NOMIDTERCERO: "MUÑOZ PEÑA JOSÉ"
    }
  });

  assert.match(xml, /<NOMIDTERCERO>MU&#209;OZ PE&#209;A JOS&#201;<\/NOMIDTERCERO>/);
  assert.doesNotMatch(xml, /Ñ|É/);
});

test("parses an RNDC duplicate response as an existing authorization", () => {
  const parsed = parseXml('<?xml version="1.0" encoding="ISO-8859-1" ?><root><ErrorMSG>DUPLICADO:162475528 Error REM030: El número de Remesa Terrestre de Carga enviado ya fué radicado para esta Empresa de Transporte.</ErrorMSG></root>');

  assert.equal(detectRadicado(parsed), "162475528");
  assert.equal(isDuplicateAuthorizationError("DUPLICADO:162475528 Error REM030: El número de Remesa Terrestre de Carga enviado ya fué radicado para esta Empresa de Transporte."), true);
});
