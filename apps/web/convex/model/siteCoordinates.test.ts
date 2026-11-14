import assert from "node:assert/strict";
import test from "node:test";
import { hasSiteCoordinates, preferredSite, rankSites, siteAlternatives, siteCoordinateWarnings, tripIsMonitored, type SiteRecord } from "./siteCoordinates";

const sites: SiteRecord[] = [
  { document: "9001234567", siteCode: "0", siteName: "PRINCIPAL", cityCode: "11001000", city: "BOGOTA BOGOTA D. C.", latitude: "4.710735", longitude: "-74.073311" },
  { document: "9001234567", siteCode: "6", siteName: "BODEGA", cityCode: "68547000", city: "PIEDECUESTA SANTANDER" },
  { document: "9001234567", siteCode: "26", siteName: "PLANTA", cityCode: "68547000", city: "PIEDECUESTA SANTANDER", latitude: "6.995415", longitude: "-73.071613" },
  { document: "9001234567", siteCode: "4", siteName: "OFICINA", cityCode: "11001000", city: "BOGOTA BOGOTA D. C." },
  { document: "9001234567", siteCode: "27", siteName: "CEDI", cityCode: "11001000", city: "BOGOTA BOGOTA D. C.", latitude: "4.62457505", longitude: "-74.1139187163" },
  { document: "800111222", siteCode: "0", siteName: "UNICA", cityCode: "5001000", city: "MEDELLIN ANTIOQUIA" }
];
const own = sites.filter((site) => site.document === "9001234567");
const route = { origin: { code: "11001000", city: "BOGOTA" }, destination: { code: "68547000", city: "PIEDECUESTA" } };

test("una sede tiene coordenadas solo si trae latitud y longitud validas", () => {
  assert.equal(hasSiteCoordinates({ latitude: "6.995415", longitude: "-73.071613" }), true);
  assert.equal(hasSiteCoordinates({ latitude: "6,995415", longitude: "-73,071613" }), true);
  assert.equal(hasSiteCoordinates({ latitude: "6.995415" }), false);
  assert.equal(hasSiteCoordinates({ latitude: " ", longitude: " " }), false);
  assert.equal(hasSiteCoordinates({ latitude: "0", longitude: "0" }), false);
  assert.equal(hasSiteCoordinates(undefined), false);
});

test("ordena primero las sedes del municipio que tienen coordenadas", () => {
  assert.deepEqual(rankSites(own, { code: "68547000" }).map((site) => site.siteCode), ["26", "6", "0", "27", "4"]);
  assert.deepEqual(rankSites(own).map((site) => site.siteCode), ["0", "26", "27", "4", "6"]);
  assert.deepEqual(rankSites(own, { city: "Piedecuesta Santander" }).map((site) => site.siteCode).slice(0, 2), ["26", "6"]);
});

test("prefiere la sede del municipio que si tiene coordenadas", () => {
  assert.equal(preferredSite(own, { code: "68547000" })?.siteCode, "26");
  assert.equal(preferredSite(own, { code: "11001000" }), undefined);
  assert.equal(preferredSite(own, { code: "76001000" }), undefined);
  assert.equal(preferredSite(own), undefined);
  assert.equal(preferredSite([own[1]], { code: "11001000" })?.siteCode, "6");
  assert.equal(preferredSite([own[1], own[3]], { code: "68547000" })?.siteCode, "6");
});

test("propone las sedes con coordenadas del mismo municipio", () => {
  assert.deepEqual(siteAlternatives(own, own[1]).map((site) => site.siteCode), ["26"]);
  assert.deepEqual(siteAlternatives(own, own[3], { code: "11001000" }).map((site) => site.siteCode), ["0", "27"]);
  assert.deepEqual(siteAlternatives(own, own[2]), []);
});

test("avisa cuando la sede del remitente o del destinatario no tiene coordenadas y hay monitoreo", () => {
  const warnings = siteCoordinateWarnings(
    { sender: { identificationNumber: "9001234567", siteCode: "4" }, recipient: { identificationNumber: "9001234567", siteCode: "6" } },
    route,
    sites,
    true
  );
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /La sede 4 · OFICINA del remitente no tiene coordenadas/);
  assert.match(warnings[0], /REM502/);
  assert.match(warnings[0], /Estas sedes quedan en el mismo municipio y sí las tienen: 0 · PRINCIPAL, 27 · CEDI/);
  assert.match(warnings[1], /La sede 6 · BODEGA del destinatario/);
  assert.match(warnings[1], /REM503/);
  assert.match(warnings[1], /La sede 26 · PLANTA queda en el mismo municipio y sí las tiene/);
});

test("no avisa si la sede tiene coordenadas o el viaje no lleva monitoreo", () => {
  const parties = { sender: { identificationNumber: "9001234567", siteCode: "0" }, recipient: { identificationNumber: "9001234567", siteCode: "26" } };
  assert.deepEqual(siteCoordinateWarnings(parties, route, sites, true), []);
  assert.deepEqual(siteCoordinateWarnings({ sender: { identificationNumber: "9001234567", siteCode: "6" } }, route, sites, false), []);
  assert.deepEqual(siteCoordinateWarnings({ sender: { identificationNumber: "9001234567" } }, route, sites, true), []);
});

test("avisa tambien cuando el TMS no conoce la sede o no hay otra con coordenadas", () => {
  const [unknown] = siteCoordinateWarnings({ sender: { identificationNumber: "700999888", siteCode: "0" } }, route, sites, true);
  assert.match(unknown, /La sede 0 del remitente no tiene coordenadas/);
  assert.match(unknown, /hay que registrarle las coordenadas antes de emitir/);
  const [single] = siteCoordinateWarnings({ recipient: { identificationNumber: "800111222", siteCode: "0" } }, { origin: {}, destination: { code: "5001000" } }, sites, true);
  assert.match(single, /La sede 0 · UNICA del destinatario/);
  assert.match(single, /Si ya las tiene en el RNDC puedes emitir/);
});

test("el viaje lleva monitoreo salvo que el manifiesto quede sin empresa de GPS", () => {
  assert.equal(tripIsMonitored(undefined), true);
  assert.equal(tripIsMonitored(null), true);
  assert.equal(tripIsMonitored({ monitoringCompanyNit: "8300596993" }), true);
  assert.equal(tripIsMonitored({ monitoringCompanyNit: " " }), false);
  assert.equal(tripIsMonitored({}), false);
});
