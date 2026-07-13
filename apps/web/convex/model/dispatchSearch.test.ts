import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  applyDispatchFilters,
  dispatchFiltersFromSearchParams,
  dispatchFiltersToSearchParams,
  type DispatchSearchRow
} from "./dispatchSearch.js";

const baseRow: DispatchSearchRow = {
  id: "dispatch-1",
  code: "EXP-0001",
  customerName: "Alimentos del Caribe",
  originCity: "Bogotá",
  destinationCity: "Barranquilla",
  vehiclePlate: "UZN424",
  driverName: "María Pérez",
  stage: "envio_rndc",
  rndcStatus: "Pendiente",
  updatedAt: Date.UTC(2026, 6, 10),
  searchText: "exp-0001 alimentos del caribe bogota barranquilla uzn424 maria perez"
};

test("applies every dispatch filter on the server row shape", () => {
  const rows = [
    baseRow,
    { ...baseRow, id: "dispatch-2", customerName: "Otro cliente", searchText: "dispatch-2 otro cliente", updatedAt: Date.UTC(2026, 5, 1) }
  ];
  const result = applyDispatchFilters(rows, {
    search: "UZN424 María",
    customer: "Alimentos",
    plate: "uzn",
    driver: "Pérez",
    origin: "Bogota",
    destination: "barranquilla",
    stage: "envio_rndc",
    status: "Pendiente",
    from: "2026-07-01",
    to: "2026-07-31"
  });

  assert.deepEqual(result.map((row) => row.id), ["dispatch-1"]);
});

test("keeps the visible newest-first order after filtering", () => {
  const result = applyDispatchFilters([
    { ...baseRow, id: "old", updatedAt: 1 },
    { ...baseRow, id: "new", updatedAt: 3 },
    { ...baseRow, id: "middle", updatedAt: 2 }
  ], {});

  assert.deepEqual(result.map((row) => row.id), ["new", "middle", "old"]);
});

test("serializes and restores filters without empty values", () => {
  const params = dispatchFiltersToSearchParams({
    search: "  EXP-0001  ",
    customer: "",
    stage: "remesas",
    from: "2026-07-01"
  });

  assert.equal(params.toString(), "q=EXP-0001&stage=remesas&from=2026-07-01");
  assert.deepEqual(dispatchFiltersFromSearchParams(params), {
    search: "EXP-0001",
    stage: "remesas",
    from: "2026-07-01"
  });
});

test("filters fifty thousand representative rows within the defined threshold", () => {
  const rows = Array.from({ length: 50_000 }, (_, index) => ({
    ...baseRow,
    id: `dispatch-${index}`,
    code: `EXP-${String(index).padStart(6, "0")}`,
    searchText: `exp-${String(index).padStart(6, "0")} cliente ${index % 10} bogota barranquilla uzn${index % 1000}`,
    customerName: `Cliente ${index % 10}`,
    vehiclePlate: `UZN${index % 1000}`,
    updatedAt: index
  }));
  const startedAt = performance.now();
  const result = applyDispatchFilters(rows, { search: "EXP-049999", customer: "Cliente 9" });
  const elapsed = performance.now() - startedAt;

  assert.equal(result.length, 1);
  assert.ok(elapsed < 500, `Expected less than 500ms, received ${elapsed.toFixed(1)}ms`);
});
