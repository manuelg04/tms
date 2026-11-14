import test from "node:test";
import assert from "node:assert/strict";
import {
  consignmentRouteBlockers,
  manifestRouteBlockers,
  routeDifferences,
  routeLabel,
  sameMunicipality,
  siteRouteBlockers,
  tripRoute
} from "./tripRoute";

const bogota = { cityName: "BOGOTA", municipalityCode: "11001000" };
const piedecuesta = { cityName: "PIEDECUESTA", municipalityCode: "68547000" };
const customer = { name: "CLIENTE DEMO", identificationNumber: "860000001" };
const order = {
  sender: { ...customer, siteCode: "27", ...bogota },
  recipient: { ...customer, siteCode: "0", ...bogota },
  loading: { address: "CRA 1", ...bogota },
  unloading: { address: "CRA 2", ...bogota }
};

test("the trip route follows the order until a remesa corrects it", () => {
  assert.equal(routeLabel(tripRoute(order, [])), "BOGOTA → BOGOTA");
  assert.equal(routeLabel(tripRoute(order, [{}])), "BOGOTA → BOGOTA");
  const corrected = { recipient: { siteCode: "26", ...piedecuesta }, unloading: piedecuesta };
  const route = tripRoute(order, [corrected]);
  assert.equal(routeLabel(route), "BOGOTA → PIEDECUESTA");
  assert.equal(route.destination.code, "68547000");
  assert.equal(sameMunicipality(route), false);
});

test("stored manifest cities are only a fallback when nothing else is known", () => {
  const fallback = { origin: { code: "11001000", city: "BOGOTA" }, destination: { code: "68547000", city: "PIEDECUESTA" } };
  assert.equal(routeLabel(tripRoute(null, [], fallback)), "BOGOTA → PIEDECUESTA");
  assert.equal(tripRoute({ loading: { cityName: "Bogotá" }, unloading: { cityName: "Piedecuesta" } }, [], fallback).destination.code, "68547000");
  assert.equal(tripRoute(order, [], fallback).destination.code, "11001000");
});

test("zones of the same municipality count as the same municipality", () => {
  assert.equal(sameMunicipality({ origin: { code: "11001000" }, destination: { code: "11001002" } }), true);
  assert.equal(sameMunicipality({ origin: { code: "11001000" }, destination: { code: "68547000" } }), false);
  assert.equal(sameMunicipality({ origin: { city: "Bogotá" }, destination: { city: "BOGOTA" } }), true);
});

test("a road remesa with the same origin and destination is blocked unless it is municipal", () => {
  assert.match(consignmentRouteBlockers({ consignmentClass: "terrestre_carga" }, order)[0], /mismo municipio \(BOGOTA\)/);
  assert.deepEqual(consignmentRouteBlockers({ consignmentClass: "municipal" }, order), []);
  assert.deepEqual(consignmentRouteBlockers({ consignmentClass: "terrestre_carga", recipient: piedecuesta, unloading: piedecuesta }, order), []);
});

test("an intermunicipal manifest is blocked when origin equals destination", () => {
  const route = tripRoute(order, []);
  assert.equal(manifestRouteBlockers({ operationScope: "intermunicipal", manifestType: "G" }, route).length, 1);
  assert.equal(manifestRouteBlockers({ operationScope: "municipal", manifestType: "G" }, route).length, 1);
  assert.deepEqual(manifestRouteBlockers({ operationScope: "municipal", manifestType: "U" }, route), []);
  assert.deepEqual(manifestRouteBlockers({ operationScope: "intermunicipal", manifestType: "G" }, tripRoute(order, [{ unloading: piedecuesta, recipient: piedecuesta }])), []);
});

test("the unloading municipality must be the one of the recipient site", () => {
  const sites = [
    { document: "860000001", siteCode: "27", cityCode: "11001000", city: "BOGOTA" },
    { document: "860000001", siteCode: "26", cityCode: "68547000", city: "PIEDECUESTA" }
  ];
  const wrong = siteRouteBlockers(
    { sender: order.sender, recipient: { ...customer, siteCode: "26" } },
    { origin: { code: "11001000", city: "BOGOTA" }, destination: { code: "11001000", city: "BOGOTA" } },
    sites
  );
  assert.equal(wrong.length, 1);
  assert.match(wrong[0], /sede 26 del destinatario queda en PIEDECUESTA.*descargue es BOGOTA/);
  assert.deepEqual(
    siteRouteBlockers(
      { sender: order.sender, recipient: { ...customer, siteCode: "26" } },
      { origin: { code: "11001000", city: "BOGOTA" }, destination: { code: "68547000", city: "PIEDECUESTA" } },
      sites
    ),
    []
  );
  assert.deepEqual(siteRouteBlockers({ recipient: { ...customer, siteCode: "99" } }, { origin: {}, destination: { code: "11001000" } }, sites), []);
});

test("differences between drafts and emitted documents are reported", () => {
  const bogotaBogota = tripRoute(order, []);
  const bogotaPiedecuesta = tripRoute(order, [{ unloading: piedecuesta, recipient: piedecuesta }]);
  assert.deepEqual(routeDifferences([{ label: "La orden de cargue", route: bogotaBogota, emitted: false }, { label: "La remesa 90001", route: bogotaBogota, emitted: false }]), []);
  const notices = routeDifferences([
    { label: "La orden de cargue", route: bogotaPiedecuesta, emitted: false },
    { label: "El manifiesto", route: bogotaBogota, emitted: true }
  ]);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /El manifiesto ya quedó con BOGOTA → BOGOTA y la orden de cargue dice BOGOTA → PIEDECUESTA/);
});
