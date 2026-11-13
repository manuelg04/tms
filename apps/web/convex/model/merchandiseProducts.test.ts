import assert from "node:assert/strict";
import test from "node:test";
import { isMerchandiseCode, matchMerchandiseProduct, merchandiseProductName } from "./merchandiseProducts";

const products = [
  { name: "CARBON", code: "002803" },
  { name: "TORTA DE PALMISTE", code: "001511" },
  { name: "CERAMICA REVESTIMIENTOS", code: "006904" }
];

test("el producto se reconoce sin importar mayúsculas, tildes ni espacios", () => {
  assert.equal(matchMerchandiseProduct(products, "carbón")?.code, "002803");
  assert.equal(matchMerchandiseProduct(products, "  Torta   de palmiste ")?.code, "001511");
  assert.equal(matchMerchandiseProduct(products, "cerámica revestimientos")?.code, "006904");
});

test("un producto que no está en la lista no recibe código inventado", () => {
  assert.equal(matchMerchandiseProduct(products, "CEMENTO GRIS"), undefined);
  assert.equal(matchMerchandiseProduct(products, "CARB"), undefined);
  assert.equal(matchMerchandiseProduct(products, ""), undefined);
});

test("solo se aceptan códigos de mercancía de seis dígitos", () => {
  assert.equal(isMerchandiseCode("002803"), true);
  assert.equal(isMerchandiseCode("2803"), false);
  assert.equal(isMerchandiseCode("00280A"), false);
  assert.equal(isMerchandiseCode(undefined), false);
  assert.equal(merchandiseProductName("  torta  de   soya "), "TORTA DE SOYA");
});

import { rndcProductCandidates } from "./merchandiseCatalog";
import { merchandiseShortName, resolveMerchandise, searchMerchandise, type MerchandiseCandidate } from "./merchandiseSearch";

const own: MerchandiseCandidate[] = [
  { name: "CARBON", code: "002803", source: "own", natureCode: "1", packagingCode: "15", uses: 2699 },
  { name: "GASEOSA", code: "002705", source: "own", uses: 1178 },
  { name: "HARINA DE CARNE", code: "000210", source: "own", uses: 1 }
];
const catalogue = [...own, ...rndcProductCandidates];

test("un producto que MTM nunca ha movido recibe el código de la tabla general", () => {
  assert.equal(resolveMerchandise(catalogue, "cemento")?.code, "002523");
  assert.equal(resolveMerchandise(catalogue, "CEMENTO GRIS")?.code, "002523");
  assert.equal(resolveMerchandise(catalogue, "cemento argos x 50 kg")?.code, "002523");
  assert.equal(resolveMerchandise(catalogue, "acpm")?.code, "002710");
  assert.equal(resolveMerchandise(catalogue, "cerveza")?.code, "002203");
});

test("lo que MTM ya registró manda sobre la tabla general", () => {
  const carbon = resolveMerchandise(catalogue, "carbón");
  assert.equal(carbon?.code, "002803");
  assert.equal(carbon?.source, "own");
  assert.equal(carbon?.packagingCode, "15");
  assert.equal(resolveMerchandise(catalogue, "gaseosas postobon")?.code, "002705");
});

test("la búsqueda tolera errores de tecleo pero no los resuelve sola", () => {
  assert.equal(searchMerchandise(catalogue, "semento", 3)[0]?.code, "002523");
  assert.equal(resolveMerchandise(catalogue, "semento"), undefined);
  assert.equal(resolveMerchandise(catalogue, "xyzqq"), undefined);
  assert.equal(resolveMerchandise(catalogue, "carga general"), undefined);
  assert.equal(resolveMerchandise(catalogue, ""), undefined);
});

test("una palabra suelta no arrastra un producto propio que solo la contiene", () => {
  assert.notEqual(resolveMerchandise(catalogue, "carne")?.code, "000210");
});

test("se puede buscar por el código y el nombre corto cabe en el RNDC", () => {
  assert.equal(searchMerchandise(catalogue, "002523")[0]?.name.startsWith("Cementos"), true);
  assert.equal(merchandiseShortName("Cementos hidráulicos (comprendidos los cementos sin pulverizar)"), "CEMENTOS HIDRÁULICOS");
  assert.equal(merchandiseShortName("x".repeat(90)).length, 60);
});

test("todos los códigos de la tabla general tienen seis dígitos y no se repiten", () => {
  const codes = rndcProductCandidates.map((candidate) => candidate.code);
  assert.equal(codes.every((code) => isMerchandiseCode(code)), true);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(codes.length > 1200, true);
});
