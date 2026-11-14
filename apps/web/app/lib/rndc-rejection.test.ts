import assert from "node:assert/strict";
import { test } from "node:test";
import { explainRejection, rejectedDocuments, rejectionCode } from "./rndc-rejection";

test("explains known RNDC rejections in plain words", () => {
  const manifest = explainRejection("Error MAN330: La información registrada en las observaciones o recomendaciones supera los 500 caracteres.");
  assert.equal(manifest.code, "MAN330");
  assert.match(manifest.action, /500 caracteres/);
  assert.match(explainRejection("error rem503 falta una de las coordenadas").message, /sede del destinatario/);
  assert.equal(rejectionCode("sin código"), undefined);
});

test("keeps the RNDC text when the code is not known", () => {
  const guide = explainRejection("Error REM999:   algo   nuevo");
  assert.equal(guide.code, "REM999");
  assert.equal(guide.message, "Error REM999: algo nuevo");
  assert.match(explainRejection("").message, /sin dar detalle/);
});

test("lists only unresolved rejections and says whether they can be edited", () => {
  const rows = rejectedDocuments([
    { _id: "d1", kind: "remesa", number: "90001", officialState: "draft", errorText: "Error REM502", expedienteRemesaId: "r1" },
    { _id: "d2", kind: "manifiesto", number: "0900001", officialState: "authorized", errorText: "Error MAN330" },
    { _id: "d3", kind: "manifiesto", number: "0900002", officialState: "pending", errorText: "Error MAN330" },
    { _id: "d4", kind: "remesa", number: "90002", officialState: "draft" }
  ]);
  assert.deepEqual(rows.map((row) => [row.documentId, row.editable]), [["d1", true], ["d3", false]]);
  assert.equal(rows[0].remesaId, "r1");
});
