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
