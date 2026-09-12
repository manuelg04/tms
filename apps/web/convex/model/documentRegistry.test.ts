import assert from "node:assert/strict";
import test from "node:test";
import {
  filterRegistryRows,
  paginateRegistryRows,
  registryCreatedAtLabel,
  type RegistryRow,
} from "./documentRegistry";

function row(
  number: string,
  overrides: Partial<RegistryRow> = {},
): RegistryRow {
  return {
    key: number,
    kind: "orden_cargue",
    number,
    date: "2026-09-12",
    plate: "ABC123",
    customer: "Transportes Bogotá",
    agency: "Centro",
    origin: "Bogotá",
    destination: "Medellín",
    status: "draft",
    statusLabel: "Borrador",
    createdBy: "Operadora",
    createdAt: 1000,
    createdAtLabel: "2026-09-12 14:00:00",
    ...overrides,
  };
}

test("los filtros se aplican al conjunto completo antes de paginar", () => {
  const rows = Array.from({ length: 350 }, (_, index) =>
    row(String(index), {
      createdAt: index,
      plate: index === 299 ? "XYZ999" : "ABC123",
    }),
  );
  const result = paginateRegistryRows(
    filterRegistryRows(rows, { plate: "XYZ999" }),
    1,
    25,
  );
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].number, "299");
});

test("el identificador exacto normaliza ceros y no confunde números ni placas", () => {
  const rows = [row("000000123"), row("1234"), row("456", { plate: "123" })];
  assert.deepEqual(
    filterRegistryRows(rows, { number: "123", numberExact: true }).map(
      (item) => item.number,
    ),
    ["000000123"],
  );
  assert.equal(filterRegistryRows(rows, { number: "123" }).length, 2);
});

test("rango inclusivo, columnas combinadas sin tildes y orden de fecha descendente", () => {
  const rows = [
    row("1", { date: "2026-09-10" }),
    row("2", { date: "2026-09-11" }),
    row("3", { date: "2026-09-12" }),
    row("4", { date: "2026-09-13" }),
    row("5", { destination: "Cali" }),
  ];
  assert.deepEqual(
    filterRegistryRows(rows, {
      dateFrom: "2026-09-10",
      dateTo: "2026-09-12",
      customer: "bogota",
      destination: "medellin",
      createdBy: "operadora",
      status: "borrador",
    }).map((item) => item.number),
    ["3", "2", "1"],
  );
});

test("la fecha de creación se muestra con día y hora de Colombia", () => {
  assert.equal(
    registryCreatedAtLabel(Date.parse("2026-09-12T04:30:00Z")),
    "2026-09-11 23:30:00",
  );
});
