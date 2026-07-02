import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

type Row = Record<string, string>;

type DriverInput = {
  document: string;
  documentType?: string;
  name?: string;
  status?: string;
  birthDate?: string;
  sex?: string;
  bloodType?: string;
  address?: string;
  city?: string;
  phone1?: string;
  phone2?: string;
  cellphone?: string;
  licenseNumber?: string;
  licenseCategory?: string;
  licenseExpiresAt?: string;
  eps?: string;
  arp?: string;
  pensionFund?: string;
  hazmatCourse?: string;
  hazmatCourseExpiresAt?: string;
  observations?: string;
};

type VehicleInput = {
  plate: string;
  make?: string;
  line?: string;
  modelYear?: string;
  color?: string;
  bodyType?: string;
  configuration?: string;
  trailer?: string;
  linkType?: string;
  capacityTn?: string;
  emptyWeightTn?: string;
  ownerDocument?: string;
  ownerName?: string;
  ownerCellphone?: string;
  ownerPhone?: string;
  possessorDocument?: string;
  possessorName?: string;
  possessorCellphone?: string;
  possessorPhone?: string;
};

type RelationInput = {
  driverDocument: string;
  vehiclePlate: string;
  matchConfidence?: string;
  matchBasis?: string;
  roles?: string[];
};

type ReportRow = {
  line: number;
  driverDocument: string;
  driverName: string;
  vehiclePlate: string;
  relationStatus: string;
  reason: string;
};

const EXPECTED_COLUMNS = 88;
const BATCH_SIZE = 200;

function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let atFieldStart = true;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
      atFieldStart = true;
    } else {
      current += char;
      atFieldStart = false;
    }
  }

  fields.push(current);
  return fields;
}

function recoverRow(line: string): string[] {
  const cells = parseCsvLine(line, ";");
  while (cells.length > 0 && cells[cells.length - 1] === "") {
    cells.pop();
  }
  return parseCsvLine(cells.join(";"), ",");
}

function clean(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "0000-00-00" || trimmed === "0000-00-00 00:00:00") {
    return undefined;
  }
  return trimmed;
}

function buildDriver(row: Row): DriverInput {
  return {
    document: row.driver_document.trim(),
    documentType: clean(row.driver_document_type),
    name: clean(row.driver_name),
    status: clean(row.driver_status),
    birthDate: clean(row.driver_birth_date),
    sex: clean(row.driver_sex),
    bloodType: clean(row.driver_blood_type),
    address: clean(row.driver_address),
    city: clean(row.driver_city),
    phone1: clean(row.driver_phone_1),
    phone2: clean(row.driver_phone_2),
    cellphone: clean(row.driver_cellphone),
    licenseNumber: clean(row.driver_license_number),
    licenseCategory: clean(row.driver_license_category),
    licenseExpiresAt: clean(row.driver_license_expires_at),
    eps: clean(row.driver_eps),
    arp: clean(row.driver_arp),
    pensionFund: clean(row.driver_pension_fund),
    hazmatCourse: clean(row.driver_hazmat_course),
    hazmatCourseExpiresAt: clean(row.driver_hazmat_course_expires_at),
    observations: clean(row.driver_observations)
  };
}

function buildVehicle(row: Row, plate: string): VehicleInput {
  return {
    plate,
    make: clean(row.vehicle_make),
    line: clean(row.vehicle_line),
    modelYear: clean(row.vehicle_model),
    color: clean(row.vehicle_color),
    bodyType: clean(row.vehicle_body_type),
    configuration: clean(row.vehicle_configuration),
    trailer: clean(row.vehicle_trailer),
    linkType: clean(row.vehicle_link_type),
    capacityTn: clean(row.vehicle_capacity_tn),
    emptyWeightTn: clean(row.vehicle_empty_weight_tn),
    ownerDocument: clean(row.vehicle_owner_document),
    ownerName: clean(row.vehicle_owner_name),
    ownerCellphone: clean(row.vehicle_owner_cellphone),
    ownerPhone: clean(row.vehicle_owner_phone),
    possessorDocument: clean(row.vehicle_possessor_document),
    possessorName: clean(row.vehicle_possessor_name),
    possessorCellphone: clean(row.vehicle_possessor_cellphone),
    possessorPhone: clean(row.vehicle_possessor_phone)
  };
}

function mergePreferFilled<T extends Record<string, unknown>>(base: T, incoming: T): T {
  const merged = { ...base };
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    if (incoming[key] !== undefined) {
      merged[key] = incoming[key];
    }
  }
  return merged;
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  for (const rawLine of readFileSync(filePath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function toCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const csvPath = args.find((arg) => !arg.startsWith("--"));

  if (!csvPath) {
    console.error("Usage: npm run ingest:fleet -- <csv-path> [--dry-run]");
    process.exit(1);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "../../..");
  loadEnvFile(path.join(repoRoot, ".env"));
  loadEnvFile(path.resolve(scriptDir, "../.env.local"));

  const raw = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r\n|\n|\r/).filter((line) => line.length > 0);
  const header = recoverRow(lines[0]);

  if (header.length !== EXPECTED_COLUMNS) {
    console.error(`Header has ${header.length} columns, expected ${EXPECTED_COLUMNS}`);
    process.exit(1);
  }

  const driversByDocument = new Map<string, DriverInput>();
  const vehiclesByPlate = new Map<string, VehicleInput>();
  const relationsByKey = new Map<string, RelationInput>();
  const reportRows: ReportRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const fields = recoverRow(lines[i]);

    if (fields.length !== EXPECTED_COLUMNS) {
      reportRows.push({
        line: lineNumber,
        driverDocument: "",
        driverName: "",
        vehiclePlate: "",
        relationStatus: "",
        reason: `rejected_bad_column_count_${fields.length}`
      });
      continue;
    }

    const row: Row = {};
    header.forEach((name, index) => {
      row[name] = fields[index];
    });

    const document = (row.driver_document ?? "").trim();
    const plate = (row.vehicle_plate ?? "").trim().toUpperCase();
    const relationStatus = (row.relation_status ?? "").trim();
    const isConfirmed = (row.is_confirmed_driver_vehicle ?? "").trim().toLowerCase() === "true";

    if (!document) {
      reportRows.push({
        line: lineNumber,
        driverDocument: "",
        driverName: (row.driver_name ?? "").trim(),
        vehiclePlate: plate,
        relationStatus,
        reason: "rejected_missing_driver_document"
      });
      continue;
    }

    const driver = buildDriver(row);
    const existingDriver = driversByDocument.get(document);
    driversByDocument.set(document, existingDriver ? mergePreferFilled(existingDriver, driver) : driver);

    if (plate) {
      const vehicle = buildVehicle(row, plate);
      const existingVehicle = vehiclesByPlate.get(plate);
      vehiclesByPlate.set(plate, existingVehicle ? mergePreferFilled(existingVehicle, vehicle) : vehicle);
    }

    if (relationStatus === "no_vehicle_found" || relationStatus === "not_assigned_owner_or_possessor_only") {
      reportRows.push({
        line: lineNumber,
        driverDocument: document,
        driverName: (row.driver_name ?? "").trim(),
        vehiclePlate: plate,
        relationStatus,
        reason: relationStatus
      });
      continue;
    }

    if (!isConfirmed) {
      reportRows.push({
        line: lineNumber,
        driverDocument: document,
        driverName: (row.driver_name ?? "").trim(),
        vehiclePlate: plate,
        relationStatus,
        reason: "not_confirmed"
      });
      continue;
    }

    if (!plate) {
      reportRows.push({
        line: lineNumber,
        driverDocument: document,
        driverName: (row.driver_name ?? "").trim(),
        vehiclePlate: "",
        relationStatus,
        reason: "rejected_confirmed_without_plate"
      });
      continue;
    }

    relationsByKey.set(`${document}::${plate}`, {
      driverDocument: document,
      vehiclePlate: plate,
      matchConfidence: clean(row.match_confidence),
      matchBasis: clean(row.match_basis),
      roles: clean(row.vehicle_role_detected_for_driver)?.split(";").map((role) => role.trim())
    });
  }

  const drivers = [...driversByDocument.values()];
  const vehicles = [...vehiclesByPlate.values()];
  const relations = [...relationsByKey.values()];

  console.log(`Filas de datos: ${lines.length - 1}`);
  console.log(`Conductores unicos: ${drivers.length}`);
  console.log(`Vehiculos unicos: ${vehicles.length}`);
  console.log(`Relaciones confirmadas unicas: ${relations.length}`);
  console.log(`Filas rechazadas o no relacionadas: ${reportRows.length}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(repoRoot, "output", "ingesta");
  mkdirSync(reportDir, { recursive: true });

  const reportCsvPath = path.join(reportDir, `${timestamp}-no-relacionados.csv`);
  const reportHeader = "line,driver_document,driver_name,vehicle_plate,relation_status,reason";
  const reportLines = reportRows.map((r) =>
    [String(r.line), r.driverDocument, r.driverName, r.vehiclePlate, r.relationStatus, r.reason]
      .map(toCsvField)
      .join(",")
  );
  writeFileSync(reportCsvPath, [reportHeader, ...reportLines].join("\n") + "\n", "utf8");
  console.log(`Reporte: ${reportCsvPath}`);

  if (dryRun) {
    console.log("Dry run: no se envio nada a Convex.");
    return;
  }

  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  const ingestKey = process.env.RNDC_INGEST_KEY;

  if (!convexUrl || !ingestKey) {
    console.error("Faltan CONVEX_URL y/o RNDC_INGEST_KEY en el entorno.");
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);
  const totals = {
    driversInserted: 0,
    driversUpdated: 0,
    vehiclesInserted: 0,
    vehiclesUpdated: 0,
    relationsInserted: 0,
    relationsUpdated: 0,
    relationsSkipped: [] as { driverDocument: string; vehiclePlate: string; reason: string }[]
  };

  const driverBatches = chunk(drivers, BATCH_SIZE);
  const vehicleBatches = chunk(vehicles, BATCH_SIZE);
  const relationBatches = chunk(relations, BATCH_SIZE);
  const totalBatches = driverBatches.length + vehicleBatches.length + relationBatches.length;
  let sentBatches = 0;

  async function send(batch: {
    drivers: DriverInput[];
    vehicles: VehicleInput[];
    relations: RelationInput[];
  }): Promise<void> {
    const result = await client.mutation(anyApi.fleet.upsertFleetBatch, { ...batch, ingestKey });
    totals.driversInserted += result.driversInserted;
    totals.driversUpdated += result.driversUpdated;
    totals.vehiclesInserted += result.vehiclesInserted;
    totals.vehiclesUpdated += result.vehiclesUpdated;
    totals.relationsInserted += result.relationsInserted;
    totals.relationsUpdated += result.relationsUpdated;
    totals.relationsSkipped.push(...result.relationsSkipped);
    sentBatches += 1;
    if (sentBatches % 10 === 0 || sentBatches === totalBatches) {
      console.log(`Lotes enviados: ${sentBatches}/${totalBatches}`);
    }
  }

  for (const batch of driverBatches) {
    await send({ drivers: batch, vehicles: [], relations: [] });
  }
  for (const batch of vehicleBatches) {
    await send({ drivers: [], vehicles: batch, relations: [] });
  }
  for (const batch of relationBatches) {
    await send({ drivers: [], vehicles: [], relations: batch });
  }

  const summary = {
    csvPath: path.resolve(csvPath),
    finishedAt: new Date().toISOString(),
    rows: lines.length - 1,
    uniqueDrivers: drivers.length,
    uniqueVehicles: vehicles.length,
    uniqueRelations: relations.length,
    reportedRows: reportRows.length,
    totals
  };

  const summaryPath = path.join(reportDir, `${timestamp}-resumen.json`);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log("Resultado de la ingesta:");
  console.log(`  Conductores: ${totals.driversInserted} nuevos, ${totals.driversUpdated} actualizados`);
  console.log(`  Vehiculos: ${totals.vehiclesInserted} nuevos, ${totals.vehiclesUpdated} actualizados`);
  console.log(`  Relaciones: ${totals.relationsInserted} nuevas, ${totals.relationsUpdated} actualizadas`);
  console.log(`  Relaciones omitidas: ${totals.relationsSkipped.length}`);
  console.log(`Resumen: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
