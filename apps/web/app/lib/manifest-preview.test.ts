import assert from "node:assert/strict";
import test from "node:test";
import { manifestPreviewPayload } from "./manifest-preview";
import { fulfillmentHref, moduleHref } from "./module-links";

test("la vista previa del manifiesto usa solo los datos disponibles y no inventa autorización", () => {
  const { payload, missingFields } = manifestPreviewPayload({
    orderNumber: "000000116",
    orderDraft: { sender: { name: "REMITENTE SAS", cityName: "Yumbo" }, recipient: { name: "DESTINO SAS", cityName: "Barranquilla" } },
    manifestNumber: "0000043",
    manifestDraft: { issueDate: "2026-11-13", freightTotal: "4500000" },
    driver: { document: "10000001", name: "CONDUCTOR UNO" },
    vehicle: { plate: "ABC123", configuration: "3S3" },
    trailer: { plate: "R00001" },
    consignments: [{ remesaId: "r1", number: "00069", draft: {}, officialState: "draft" }, { remesaId: "r2", draft: {}, officialState: "draft" }]
  });
  assert.equal(payload.manifestNumber, "0000043");
  assert.equal(payload.remesaNumber, "00069");
  assert.equal((payload.manifestRemesas as unknown[]).length, 1);
  assert.equal((payload.vehicle as Record<string, unknown>).plate, "ABC123");
  assert.equal((payload.vehicle as Record<string, unknown>).trailerPlate, "R00001");
  assert.equal((payload.driver as Record<string, unknown>).id, "10000001");
  assert.equal((payload.money as Record<string, unknown>).freightValue, 4500000);
  assert.equal("manifestAuthorization" in payload, false);
  assert.ok(missingFields.length > 0);
});

test("la vista previa tolera un viaje sin manifiesto preparado", () => {
  const { payload } = manifestPreviewPayload({ consignments: [] });
  assert.equal(payload.manifestNumber, "");
  assert.equal(payload.manifestRemesas, undefined);
});

test("los enlaces llevan a cada documento dentro de su módulo", () => {
  assert.equal(moduleHref("remesas", "insertar", { viaje: "v1" }), "/documentos/remesas/insertar?viaje=v1");
  assert.equal(moduleHref("manifiestos", "imprimir", { viaje: "v1", doc: "d1" }), "/documentos/manifiestos/imprimir?viaje=v1&doc=d1");
  assert.equal(moduleHref("ordenes", "listar"), "/documentos/ordenes/listar");
  assert.equal(fulfillmentHref("v1"), "/expedientes/v1?stage=cumplido_inicial#cumplidos");
});
