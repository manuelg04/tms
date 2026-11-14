import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDocument, isCompanyName, nitCheckDigit, parseAvansatVehicles, planAvansatVehicleLoad, tractorConfiguration } from "./avansat-vehicles.js";

const HEADER = [
  "placa", "vinculado_rndc", "fecha_ultima_vinculacion", "creado_por", "fecha_creacion", "marca", "linea", "modelo", "color", "tipo_vinculacion",
  "tipo_carroceria", "peso_vacio_tn", "capacidad_tn", "configuracion", "configuracion_texto", "soat_numero", "soat_aseguradora", "soat_vence", "remolque",
  "poseedor_nombre", "poseedor_documento", "poseedor_direccion", "poseedor_celular", "poseedor_telefono",
  "propietario_nombre", "propietario_documento", "propietario_direccion", "propietario_celular", "propietario_telefono",
  "conductor_nombre", "conductor_documento", "operador_gps"
];

const TODAY = "2026-11-14";

const base: Record<string, string> = {
  placa: "ABC123",
  vinculado_rndc: "SI",
  fecha_ultima_vinculacion: "2026-11-11 14:36:11",
  fecha_creacion: "2026-11-11 14:36:11",
  marca: "KENWORTH",
  linea: "T800",
  modelo: "2023",
  color: "AZUL",
  tipo_vinculacion: "Terceros",
  tipo_carroceria: "ESTACAS",
  peso_vacio_tn: "7",
  capacidad_tn: "34",
  configuracion: "3S3",
  configuracion_texto: "3 Ejes Semiremolque 3 Ejes",
  soat_numero: "123-456",
  soat_aseguradora: "PREVISORA",
  soat_vence: "2026-12-02",
  remolque: "S80522",
  poseedor_nombre: "ROJAS MORA PEDRO",
  poseedor_documento: "74000001",
  poseedor_direccion: "CR 1 2 3",
  poseedor_celular: "3000000001",
  poseedor_telefono: "3000000001",
  propietario_nombre: "BANCO DE PRUEBA SA",
  propietario_documento: "8600343137",
  propietario_direccion: "KM 2",
  propietario_celular: "",
  propietario_telefono: "3000000002",
  conductor_nombre: "LOPEZ JUAN",
  conductor_documento: "5600001",
  operador_gps: "SATRACK"
};

function file(rows: Array<Record<string, string>>): string {
  return [HEADER.join("\t"), ...rows.map((row) => HEADER.map((column) => row[column] ?? "").join("\t"))].join("\n");
}

describe("documentos de Avansat", () => {
  it("calcula el dígito de verificación del NIT", () => {
    assert.equal(nitCheckDigit("860034313"), "7");
    assert.equal(nitCheckDigit("890903407"), "9");
    assert.equal(nitCheckDigit("860002400"), "2");
  });

  it("reconoce empresas por el nombre y no confunde personas", () => {
    assert.equal(isCompanyName("LOGISTICA Y CARGA S.A.S."), true);
    assert.equal(isCompanyName("JOHN FREDDY BOCANEGRA SILVA S.A.S"), true);
    assert.equal(isCompanyName("BANCO DAVIVIENDA SA"), true);
    assert.equal(isCompanyName("TRANSINVERLOG S.A. S."), true);
    assert.equal(isCompanyName("SALAS ROJAS ANA"), false);
    assert.equal(isCompanyName("SAENZ LEAL EUGENIO"), false);
    assert.equal(isCompanyName("ESPINOSA GAITAN BRAYAN ESNEIDER"), false);
  });

  it("deja el NIT con dígito de verificación y la cédula igual", () => {
    assert.deepEqual(classifyDocument("900218311", "LOGISTICA Y CARGA S.A.S."), { documentType: "N", document: `900218311${nitCheckDigit("900218311")}` });
    assert.deepEqual(classifyDocument("8600343137", "BANCO DAVIVIENDA SA"), { documentType: "N", document: "8600343137" });
    assert.deepEqual(classifyDocument("1052398093", "FLECHAS BONZA OSCAR MAURICIO"), { documentType: "C", document: "1052398093" });
    assert.equal(classifyDocument("12345678", "TRANSPORTES RAROS LTDA").doubtful, "nit_sin_digito_de_verificacion_reconocible");
  });

  it("saca la configuración del cabezote de la configuración combinada", () => {
    assert.equal(tractorConfiguration("3S3"), "3S");
    assert.equal(tractorConfiguration("2s2"), "2S");
    assert.equal(tractorConfiguration("V2"), "V2");
    assert.equal(tractorConfiguration("2"), "2");
    assert.equal(tractorConfiguration(""), undefined);
  });
});

describe("parseAvansatVehicles", () => {
  it("convierte una ficha en vehículo, terceros y vínculo con el conductor", () => {
    const result = parseAvansatVehicles(file([base]), { today: TODAY });
    assert.deepEqual(result.vehicles[0], {
      plate: "ABC123",
      make: "KENWORTH",
      lineName: "T800",
      modelYear: "2023",
      bodyType: "ESTACAS",
      configuration: "3S",
      configurationLabel: "3S3 - 3 Ejes Semiremolque 3 Ejes",
      vehicleKind: "cabezote",
      status: "activo",
      trailer: "S80522",
      linkType: "Terceros",
      capacityTn: "34",
      emptyWeightTn: "7",
      ownerDocumentType: "N",
      ownerDocument: "8600343137",
      ownerName: "BANCO DE PRUEBA SA",
      ownerCellphone: undefined,
      ownerPhone: "3000000002",
      possessorDocumentType: "C",
      possessorDocument: "74000001",
      possessorName: "ROJAS MORA PEDRO",
      possessorCellphone: "3000000001",
      possessorPhone: "3000000001",
      insurerName: "PREVISORA",
      soatNumber: "123-456",
      soatExpiresAt: "2026-12-02",
      rndcRegisteredAt: "2026-11-11",
      source: "avansat-vehiculos"
    });
    assert.deepEqual(result.parties.map((party) => [party.documentType, party.document, party.roles]), [["N", "8600343137", ["owner"]], ["C", "74000001", ["possessor"]]]);
    assert.deepEqual(result.relations, [{ driverDocument: "5600001", vehiclePlate: "ABC123", matchConfidence: "high", matchBasis: "avansat_vehicle_driver", roles: ["conductor"] }]);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.stats.registeredInRndc, 1);
  });

  it("no marca como registrado el vehículo que Avansat no ha vinculado y archiva el de SOAT vencido", () => {
    const result = parseAvansatVehicles(file([{ ...base, vinculado_rndc: "NO", fecha_ultima_vinculacion: "", soat_vence: "2026-10-01" }]), { today: TODAY });
    assert.equal(result.vehicles[0].rndcRegisteredAt, undefined);
    assert.equal(result.vehicles[0].status, "archivado");
  });

  it("une al dueño que es poseedor y conductor de su propio vehículo", () => {
    const result = parseAvansatVehicles(
      file([{ ...base, propietario_nombre: "ROJAS MORA PEDRO", propietario_documento: "74000001", conductor_documento: "74000001" }]),
      { today: TODAY }
    );
    assert.deepEqual(result.parties.map((party) => party.roles), [["owner", "possessor"]]);
    assert.deepEqual(result.relations[0].roles, ["conductor", "poseedor", "propietario"]);
  });

  it("rechaza placas inválidas o repetidas y avisa de datos faltantes", () => {
    const result = parseAvansatVehicles(
      file([base, base, { ...base, placa: "R12345" }, { ...base, placa: "XYZ987", conductor_documento: "", remolque: "", poseedor_documento: "" }]),
      { today: TODAY }
    );
    assert.deepEqual(result.rejected.map((row) => [row.line, row.reason]), [[3, "placa_repetida"], [4, "placa_invalida"]]);
    assert.equal(result.vehicles.length, 2);
    assert.equal(result.vehicles[1].possessorDocument, undefined);
    assert.deepEqual(result.warnings.map((warning) => warning.reason), ["sin_documento_o_nombre", "sin_conductor"]);
    assert.equal(result.relations.length, 1);
  });

  it("falla si el archivo no es el de vehículos", () => {
    assert.throws(() => parseAvansatVehicles("placa\tmarca\nABC123\tKENWORTH", { today: TODAY }), /Faltan columnas/);
  });
});

describe("planAvansatVehicleLoad", () => {
  it("crea lo nuevo y a lo existente solo le completa remolque y poseedor vacíos", () => {
    const parsed = parseAvansatVehicles(file([base, { ...base, placa: "DEF456" }, { ...base, placa: "GHI789" }]), { today: TODAY });
    const plan = planAvansatVehicleLoad(parsed, {
      vehicles: new Map([
        ["DEF456", { ownerDocument: "999" }],
        ["GHI789", { trailer: "R00001", ownerDocument: "999", possessorDocument: "888" }]
      ]),
      parties: new Set(["74000001"])
    });
    assert.deepEqual(plan.newVehicles.map((vehicle) => vehicle.plate), ["ABC123"]);
    assert.deepEqual(plan.vehiclePatches, [{
      plate: "DEF456",
      trailer: "S80522",
      possessorDocumentType: "C",
      possessorDocument: "74000001",
      possessorName: "ROJAS MORA PEDRO",
      possessorCellphone: "3000000001",
      possessorPhone: "3000000001"
    }]);
    assert.deepEqual(plan.untouchedVehicles, ["GHI789"]);
    assert.deepEqual(plan.newParties.map((party) => party.document), ["8600343137"]);
    assert.deepEqual(plan.existingParties, ["74000001"]);
    assert.equal(plan.relations.length, 3);
  });
});
