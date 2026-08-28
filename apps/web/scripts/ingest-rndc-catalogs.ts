import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { RndcCatalogKind } from "../convex/model/rndcCatalogs.js";
import { parseCatalogArgs } from "./lib/rndc-catalog-cli.js";
import {
  assertCatalogPreflightSafe,
  assertCatalogSourceBounds,
  assertDevelopmentConvexTarget,
  importTotalsEqual,
  parseEnvContent,
  verifyCatalogReadback,
  type CatalogReadbackRow,
  type CatalogReadbackSummary
} from "./lib/rndc-catalog-runtime.js";
import {
  parseRndcBodyTypeCatalog,
  parseRndcInsurerCatalog,
  parseRndcPackageCatalog,
  parseRndcVehicleLineCatalog
} from "./lib/rndc-reference-catalogs.js";
import {
  chunkCatalogRows,
  deterministicCatalogRunId,
  hashCatalogBatch,
  hashCatalogManifest,
  prepareBodyTypeRows,
  prepareInsurerRows,
  preparePackageRows,
  prepareVehicleLineRows,
  type PreparedBodyTypeRow,
  type PreparedInsurerRow,
  type PreparedPackageRow,
  type PreparedVehicleLineRow
} from "./lib/rndc-reference-ingestion.js";

const BATCH_SIZE = 100;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

type PreparedCatalogRow =
  | PreparedVehicleLineRow
  | PreparedInsurerRow
  | PreparedPackageRow
  | PreparedBodyTypeRow;

type FileSummary = {
  fileName: string;
  sha256: string;
  catalogDigest: string;
  rowsRead: number;
  normalizedRows: number;
  historicalRows: number;
  batchCount: number;
};

type CatalogSpec = {
  catalog: RndcCatalogKind;
  totalsKey: "vehicleLines" | "insurers" | "packages" | "bodyTypes";
  rows: PreparedCatalogRow[];
  batches: PreparedCatalogRow[][];
  batchHashes: string[];
  expected: CatalogReadbackRow[];
  file: FileSummary;
};

type BatchOutcome = {
  inserted: number;
  updated: number;
  unchanged: number;
  outdated: number;
};

type CatalogOutcome = BatchOutcome & { batchesApplied: number };

type ImportTotals = Record<CatalogSpec["totalsKey"], CatalogOutcome>;

type CoverageCounts = {
  withReference: number;
  resolved: number;
  unresolved: number;
  missingReference: number;
};

type CoverageWithReferences = CoverageCounts & {
  unresolvedReferences: Array<{ reference: string; occurrences: number }>;
};

type CoverageSummary = {
  vehiclesScanned: number;
  vehicleLines: CoverageWithReferences;
  bodyTypes: CoverageWithReferences;
  insurers: CoverageWithReferences;
};

type CatalogPage = {
  items: CatalogReadbackRow[];
  nextCursor: string | null;
  done: boolean;
};

type CoveragePageResult = CoverageCounts & { unresolvedReferences: string[] };

type CoveragePage = {
  vehiclesScanned: number;
  vehicleLines: CoveragePageResult;
  bodyTypes: CoveragePageResult;
  insurers: CoveragePageResult;
  nextCursor: string | null;
  done: boolean;
};

type ImportRunSnapshot = {
  status: "running" | "completed" | "failed";
  totals: ImportTotals;
  failureCode?: string;
};

type StoredVerification = {
  readback: Record<CatalogSpec["totalsKey"], CatalogReadbackSummary>;
  vehicleCoverage: CoverageSummary;
};

function readCatalogFile(filePath: string): { resolvedPath: string; bytes: Buffer } {
  const resolvedPath = path.resolve(filePath);
  const stat = lstatSync(resolvedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Cada ruta debe apuntar directamente a un archivo regular");
  }
  if (stat.size < 1 || stat.size > MAX_FILE_BYTES) {
    throw new Error("Uno de los archivos RNDC está vacío o supera el límite seguro de 25 MB");
  }
  return { resolvedPath, bytes: readFileSync(resolvedPath) };
}

function fileHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileSummary(
  filePath: string,
  bytes: Uint8Array,
  parsed: { rawRows: number; deduplicated: number; rows: unknown[] },
  catalogDigest: string
): FileSummary {
  return {
    fileName: path.basename(filePath),
    sha256: fileHash(bytes),
    catalogDigest,
    rowsRead: parsed.rawRows,
    normalizedRows: parsed.rows.length,
    historicalRows: parsed.deduplicated,
    batchCount: Math.ceil(parsed.rows.length / BATCH_SIZE)
  };
}

function emptyOutcome(): CatalogOutcome {
  return { batchesApplied: 0, inserted: 0, updated: 0, unchanged: 0, outdated: 0 };
}

function emptyCoverage(): CoverageWithReferences {
  return { withReference: 0, resolved: 0, unresolved: 0, missingReference: 0, unresolvedReferences: [] };
}

function addCoverage(target: CoverageWithReferences, page: CoveragePageResult): void {
  if (page.unresolvedReferences.length !== page.unresolved) {
    throw new Error("La página de relaciones no contiene todas sus referencias sin resolver");
  }
  target.withReference += page.withReference;
  target.resolved += page.resolved;
  target.unresolved += page.unresolved;
  target.missingReference += page.missingReference;
  for (const reference of page.unresolvedReferences) {
    const existing = target.unresolvedReferences.find((entry) => entry.reference === reference);
    if (existing) existing.occurrences += 1;
    else target.unresolvedReferences.push({ reference, occurrences: 1 });
  }
}

async function readCatalog(client: ConvexHttpClient, ingestKey: string, catalog: RndcCatalogKind): Promise<CatalogReadbackRow[]> {
  const items: CatalogReadbackRow[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  while (true) {
    const page = (await client.query(anyApi.rndcReferenceCatalogs.catalogVerificationPage, {
      ingestKey,
      catalog,
      cursor,
      limit: 200
    })) as CatalogPage;
    items.push(...page.items);
    if (page.done) return items;
    if (!page.nextCursor || cursors.has(page.nextCursor)) {
      throw new Error("La paginación de verificación del catálogo no avanzó");
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

async function readAllCatalogs(
  client: ConvexHttpClient,
  ingestKey: string,
  specs: CatalogSpec[]
): Promise<Map<RndcCatalogKind, CatalogReadbackRow[]>> {
  const pages = await Promise.all(specs.map(async (spec) => [spec.catalog, await readCatalog(client, ingestKey, spec.catalog)] as const));
  return new Map(pages);
}

async function readVehicleCoverage(client: ConvexHttpClient, ingestKey: string): Promise<CoverageSummary> {
  const summary: CoverageSummary = {
    vehiclesScanned: 0,
    vehicleLines: emptyCoverage(),
    bodyTypes: emptyCoverage(),
    insurers: emptyCoverage()
  };
  const cursors = new Set<string>();
  let cursor: string | null = null;
  while (true) {
    const page = (await client.query(anyApi.rndcReferenceCatalogs.vehicleRelationshipCoveragePage, {
      ingestKey,
      cursor,
      limit: 50
    })) as CoveragePage;
    summary.vehiclesScanned += page.vehiclesScanned;
    addCoverage(summary.vehicleLines, page.vehicleLines);
    addCoverage(summary.bodyTypes, page.bodyTypes);
    addCoverage(summary.insurers, page.insurers);
    if (page.done) {
      summary.vehicleLines.unresolvedReferences.sort((left, right) => left.reference.localeCompare(right.reference));
      summary.bodyTypes.unresolvedReferences.sort((left, right) => left.reference.localeCompare(right.reference));
      summary.insurers.unresolvedReferences.sort((left, right) => left.reference.localeCompare(right.reference));
      return summary;
    }
    if (!page.nextCursor || cursors.has(page.nextCursor)) {
      throw new Error("La paginación de relaciones de vehículos no avanzó");
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

async function verifyStoredState(
  client: ConvexHttpClient,
  ingestKey: string,
  specs: CatalogSpec[]
): Promise<StoredVerification> {
  const after = await readAllCatalogs(client, ingestKey, specs);
  const readback = {} as Record<CatalogSpec["totalsKey"], CatalogReadbackSummary>;
  for (const spec of specs) {
    readback[spec.totalsKey] = verifyCatalogReadback(spec.expected, after.get(spec.catalog) ?? []);
  }
  return { readback, vehicleCoverage: await readVehicleCoverage(client, ingestKey) };
}

async function getImportRun(
  client: ConvexHttpClient,
  ingestKey: string,
  importRunId: string
): Promise<ImportRunSnapshot | null> {
  return (await client.query(anyApi.rndcReferenceCatalogs.getImport, { ingestKey, importRunId })) as ImportRunSnapshot | null;
}

function safeDiagnostic(error: unknown, sensitiveValues: string[]): { name: string; message: string } {
  const name = error instanceof Error ? error.name : "Error";
  let message = error instanceof Error ? error.message : "La ingesta terminó con un error desconocido";
  for (const value of sensitiveValues) {
    if (value) message = message.replaceAll(value, "[REDACTED]");
  }
  message = message
    .replace(/https?:\/\/\S+/g, "[URL]")
    .replace(/\/Users\/[^/\s]+/g, "[USER_HOME]")
    .slice(0, 2000);
  return { name, message };
}

function writeReport(reportDir: string, timestamp: string, report: unknown): string {
  mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${timestamp}-maestros-rndc.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

function writeCompletedReport(reportDir: string, timestamp: string, report: unknown): string | undefined {
  try {
    return writeReport(reportDir, timestamp, report);
  } catch {
    console.warn("La ingesta quedó completada en el servidor, pero no fue posible guardar el reporte local.");
    return undefined;
  }
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const timestamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(webRoot, "../..");
  const reportDir = path.join(repoRoot, "output", "ingesta");
  let ingestKey = "";
  let importRunId = "";
  let client: ConvexHttpClient | undefined;
  let totals: ImportTotals | undefined;
  let storedVerification: StoredVerification | undefined;
  let readbackVerificationPassed = false;
  let certificationVerificationPassed = false;
  let replayedBatches = 0;
  let stage: "source" | "batch" | "verification" | "completion" | "reporting" = "source";
  let baseReport: Record<string, unknown> = { schemaVersion: 1, startedAt: startedAt.toISOString() };

  try {
    const options = parseCatalogArgs(process.argv.slice(2));
    const vehicleFile = readCatalogFile(options.vehicleLinesPath);
    const insurerFile = readCatalogFile(options.insurersPath);
    const packageFile = readCatalogFile(options.packagesPath);
    const bodyFile = readCatalogFile(options.bodyTypesPath);

    const vehicleParsed = parseRndcVehicleLineCatalog(vehicleFile.bytes);
    const insurerParsed = parseRndcInsurerCatalog(insurerFile.bytes);
    const packageParsed = parseRndcPackageCatalog(packageFile.bytes);
    const bodyParsed = parseRndcBodyTypeCatalog(bodyFile.bytes);

    const vehicleRows = prepareVehicleLineRows(vehicleParsed.rows);
    const insurerRows = prepareInsurerRows(insurerParsed.rows);
    const packageRows = preparePackageRows(packageParsed.rows);
    const bodyRows = prepareBodyTypeRows(bodyParsed.rows);

    const vehicleBatches = chunkCatalogRows(vehicleRows, BATCH_SIZE);
    const insurerBatches = chunkCatalogRows(insurerRows, BATCH_SIZE);
    const packageBatches = chunkCatalogRows(packageRows, BATCH_SIZE);
    const bodyBatches = chunkCatalogRows(bodyRows, BATCH_SIZE);
    const vehicleBatchHashes = vehicleBatches.map((rows) => hashCatalogBatch("vehicle_line", rows));
    const insurerBatchHashes = insurerBatches.map((rows) => hashCatalogBatch("insurer", rows));
    const packageBatchHashes = packageBatches.map((rows) => hashCatalogBatch("packaging", rows));
    const bodyBatchHashes = bodyBatches.map((rows) => hashCatalogBatch("body_type", rows));

    const specs: CatalogSpec[] = [
      {
        catalog: "vehicle_line",
        totalsKey: "vehicleLines",
        rows: vehicleRows,
        batches: vehicleBatches,
        batchHashes: vehicleBatchHashes,
        expected: vehicleRows.map((row) => ({
          key: row.makeCode,
          secondaryKey: row.lineCode,
          sourceRegisteredAt: row.sourceRegisteredAt,
          contentHash: row.contentHash
        })),
        file: fileSummary(
          vehicleFile.resolvedPath,
          vehicleFile.bytes,
          vehicleParsed,
          hashCatalogManifest("vehicle_line", vehicleBatchHashes)
        )
      },
      {
        catalog: "insurer",
        totalsKey: "insurers",
        rows: insurerRows,
        batches: insurerBatches,
        batchHashes: insurerBatchHashes,
        expected: insurerRows.map((row) => ({
          key: row.insurerNit,
          sourceRegisteredAt: row.sourceRegisteredAt,
          contentHash: row.contentHash
        })),
        file: fileSummary(
          insurerFile.resolvedPath,
          insurerFile.bytes,
          insurerParsed,
          hashCatalogManifest("insurer", insurerBatchHashes)
        )
      },
      {
        catalog: "packaging",
        totalsKey: "packages",
        rows: packageRows,
        batches: packageBatches,
        batchHashes: packageBatchHashes,
        expected: packageRows.map((row) => ({
          key: row.code,
          sourceRegisteredAt: row.sourceRegisteredAt,
          contentHash: row.contentHash
        })),
        file: fileSummary(
          packageFile.resolvedPath,
          packageFile.bytes,
          packageParsed,
          hashCatalogManifest("packaging", packageBatchHashes)
        )
      },
      {
        catalog: "body_type",
        totalsKey: "bodyTypes",
        rows: bodyRows,
        batches: bodyBatches,
        batchHashes: bodyBatchHashes,
        expected: bodyRows.map((row) => ({
          key: row.code,
          sourceRegisteredAt: row.sourceRegisteredAt,
          contentHash: row.contentHash
        })),
        file: fileSummary(
          bodyFile.resolvedPath,
          bodyFile.bytes,
          bodyParsed,
          hashCatalogManifest("body_type", bodyBatchHashes)
        )
      }
    ];

    const files = {
      vehicleLines: specs[0].file,
      insurers: specs[1].file,
      packages: specs[2].file,
      bodyTypes: specs[3].file
    };
    assertCatalogSourceBounds(files);
    baseReport = {
      schemaVersion: 1,
      startedAt: startedAt.toISOString(),
      mode: options.apply ? "apply" : "dry-run",
      target: options.apply ? "pending-development-validation" : "local-only",
      files
    };

    console.log("Validación local completa para los cuatro maestros RNDC.");
    for (const spec of specs) {
      console.log(`${spec.file.fileName}: ${spec.file.rowsRead} filas, ${spec.file.normalizedRows} vigentes, ${spec.file.historicalRows} históricas.`);
    }

    if (!options.apply) {
      const reportPath = writeReport(reportDir, timestamp, {
        ...baseReport,
        status: "validated",
        finishedAt: new Date().toISOString()
      });
      console.log("Simulación terminada: no se escribió nada en Convex.");
      console.log(`Reporte: ${reportPath}`);
      return;
    }

    const webEnv = parseEnvContent(readFileSync(path.join(webRoot, ".env.local"), "utf8"));
    const deployment = process.env.CONVEX_DEPLOYMENT ?? webEnv.CONVEX_DEPLOYMENT ?? "";
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? webEnv.NEXT_PUBLIC_CONVEX_URL ?? "";
    ingestKey = process.env.RNDC_INGEST_KEY ?? webEnv.RNDC_INGEST_KEY ?? "";
    if (!deployment || !convexUrl || !ingestKey) {
      throw new Error("Falta la configuración local requerida para la ingesta de desarrollo");
    }
    assertDevelopmentConvexTarget(deployment, convexUrl);
    baseReport = {
      ...baseReport,
      target: { environment: "development", deployment },
      serverGate: "development-only"
    };

    client = new ConvexHttpClient(convexUrl);
    console.log("Ejecutando preflight de conflictos en Convex desarrollo.");
    const before = await readAllCatalogs(client, ingestKey, specs);
    for (const spec of specs) {
      assertCatalogPreflightSafe(spec.expected, before.get(spec.catalog) ?? []);
    }

    stage = "batch";
    let clientRunId = deterministicCatalogRunId(files);
    let begin = (await client.mutation(anyApi.rndcReferenceCatalogs.beginImport, {
      ingestKey,
      clientRunId,
      files
    })) as { importRunId: string; status: string; replayed: boolean };
    if (begin.status === "failed") {
      clientRunId = randomUUID();
      begin = (await client.mutation(anyApi.rndcReferenceCatalogs.beginImport, {
        ingestKey,
        clientRunId,
        files
      })) as { importRunId: string; status: string; replayed: boolean };
    }
    importRunId = begin.importRunId;
    if (begin.status === "completed") {
      stage = "verification";
      storedVerification = await verifyStoredState(client, ingestKey, specs);
      readbackVerificationPassed = true;
      stage = "completion";
      await client.mutation(anyApi.rndcReferenceCatalogs.completeImport, { ingestKey, importRunId });
      const completedRun = await getImportRun(client, ingestKey, importRunId);
      if (!completedRun || completedRun.status !== "completed") {
        throw new Error("La corrida recuperada no conserva su certificación de servidor");
      }
      certificationVerificationPassed = true;
      stage = "reporting";
      const reportPath = writeCompletedReport(reportDir, timestamp, {
        ...baseReport,
        status: "completed",
        verificationStatus: "passed",
        readbackVerificationStatus: "passed",
        serverCertificationStatus: "passed",
        importRunId,
        resumed: true,
        replayedBatches: 0,
        totals: completedRun.totals,
        ...storedVerification,
        finishedAt: new Date().toISOString()
      });
      console.log("La misma ingesta ya estaba completada; se verificó sin volver a escribir lotes.");
      if (reportPath) console.log(`Reporte: ${reportPath}`);
      return;
    }
    if (begin.status !== "running") {
      throw new Error("Convex no dejó una corrida recuperable para la ingesta");
    }

    writeReport(reportDir, timestamp, {
      ...baseReport,
      status: "running",
      importRunId,
      resumed: begin.replayed,
      finishedAt: undefined
    });

    totals = {
      vehicleLines: emptyOutcome(),
      insurers: emptyOutcome(),
      packages: emptyOutcome(),
      bodyTypes: emptyOutcome()
    };
    for (const spec of specs) {
      for (const [batchIndex, rows] of spec.batches.entries()) {
        const result = (await client.mutation(anyApi.rndcReferenceCatalogs.upsertBatch, {
          ingestKey,
          importRunId,
          batchIndex,
          batchHash: spec.batchHashes[batchIndex],
          payload: { catalog: spec.catalog, rows }
        })) as BatchOutcome & { replayed: boolean };
        const appliedRows = result.inserted + result.updated + result.unchanged + result.outdated;
        if (appliedRows !== rows.length) {
          throw new Error("La confirmación de un lote no coincide con las filas enviadas");
        }
        if (result.replayed) replayedBatches += 1;
        const total = totals[spec.totalsKey];
        total.batchesApplied += 1;
        total.inserted += result.inserted;
        total.updated += result.updated;
        total.unchanged += result.unchanged;
        total.outdated += result.outdated;
        if ((batchIndex + 1) % 20 === 0 || batchIndex + 1 === spec.batches.length) {
          console.log(`${spec.file.fileName}: ${batchIndex + 1}/${spec.batches.length} lotes confirmados.`);
        }
      }
    }

    stage = "verification";
    console.log("Leyendo nuevamente los catálogos y verificando relaciones.");
    storedVerification = await verifyStoredState(client, ingestKey, specs);
    readbackVerificationPassed = true;

    stage = "completion";
    await client.mutation(anyApi.rndcReferenceCatalogs.completeImport, { ingestKey, importRunId });
    const completedRun = await getImportRun(client, ingestKey, importRunId);
    if (!completedRun || completedRun.status !== "completed" || !importTotalsEqual(completedRun.totals, totals)) {
      throw new Error("La lectura final de la corrida no coincide con las confirmaciones de lotes");
    }
    certificationVerificationPassed = true;

    stage = "reporting";
    const reportPath = writeCompletedReport(reportDir, timestamp, {
      ...baseReport,
      status: "completed",
      verificationStatus: "passed",
      readbackVerificationStatus: "passed",
      serverCertificationStatus: "passed",
      importRunId,
      resumed: begin.replayed,
      replayedBatches,
      totals,
      ...storedVerification,
      finishedAt: new Date().toISOString()
    });
    console.log("Ingesta completada y verificada en Convex desarrollo.");
    if (reportPath) console.log(`Reporte: ${reportPath}`);
  } catch (error) {
    const failureCode =
      stage === "source"
        ? "SOURCE_VALIDATION_FAILED"
        : stage === "batch"
          ? "BATCH_APPLY_FAILED"
          : stage === "verification" || stage === "completion"
            ? "VERIFICATION_FAILED"
            : "INTERNAL_ERROR";
    let authoritativeRun: ImportRunSnapshot | null = null;
    if (importRunId && ingestKey && client) {
      try {
        authoritativeRun = await getImportRun(client, ingestKey, importRunId);
      } catch {
      }
      if (!authoritativeRun || authoritativeRun.status === "running") {
        try {
          await client.mutation(anyApi.rndcReferenceCatalogs.failImport, { ingestKey, importRunId, failureCode });
        } catch {
        }
        authoritativeRun = null;
        try {
          authoritativeRun = await getImportRun(client, ingestKey, importRunId);
        } catch {
        }
      }
      if (authoritativeRun?.status === "completed" && readbackVerificationPassed && !certificationVerificationPassed) {
        try {
          await client.mutation(anyApi.rndcReferenceCatalogs.completeImport, { ingestKey, importRunId });
          const certifiedRun = await getImportRun(client, ingestKey, importRunId);
          if (certifiedRun?.status === "completed" && (!totals || importTotalsEqual(certifiedRun.totals, totals))) {
            authoritativeRun = certifiedRun;
            certificationVerificationPassed = true;
          }
        } catch {
        }
      }
    }
    const diagnostic = safeDiagnostic(error, [ingestKey]);
    const authoritativeStatus = authoritativeRun?.status ?? (importRunId ? "unknown" : "failed");
    const verificationPassed = readbackVerificationPassed && certificationVerificationPassed;
    let reportPath: string | undefined;
    try {
      reportPath = writeReport(reportDir, timestamp, {
        ...baseReport,
        status: authoritativeStatus,
        verificationStatus: verificationPassed ? "passed" : stage === "source" || stage === "batch" ? "not-run" : "failed",
        readbackVerificationStatus: readbackVerificationPassed ? "passed" : stage === "source" || stage === "batch" ? "not-run" : "failed",
        serverCertificationStatus: certificationVerificationPassed ? "passed" : authoritativeStatus === "completed" ? "unverified" : "not-completed",
        importRunId: importRunId || undefined,
        failureCode: authoritativeStatus === "completed" ? undefined : authoritativeRun?.failureCode ?? failureCode,
        totals: authoritativeRun?.totals ?? totals,
        replayedBatches,
        ...storedVerification,
        diagnostic,
        finishedAt: new Date().toISOString()
      });
    } catch {
    }
    if (authoritativeStatus === "completed" && verificationPassed) {
      console.warn("El servidor confirmó la ingesta; una comprobación o salida local posterior no terminó correctamente.");
      console.warn(diagnostic.message);
      if (reportPath) console.warn(`Reporte: ${reportPath}`);
      return;
    }
    if (authoritativeStatus === "completed") {
      console.error("La corrida sigue certificada en el servidor, pero la verificación de lectura actual falló.");
    }
    console.error(diagnostic.message);
    if (reportPath) console.error(`Reporte: ${reportPath}`);
    process.exitCode = 1;
  }
}

void main();
