export type CatalogReadbackRow = {
  key: string;
  secondaryKey?: string;
  sourceRegisteredAt: string;
  contentHash: string;
};

export type CatalogReadbackSummary = {
  inputRows: number;
  storedRows: number;
  matched: number;
  superseded: number;
  extras: number;
};

export type ImportOutcomeShape = {
  batchesApplied: number;
  inserted: number;
  updated: number;
  unchanged: number;
  outdated: number;
};

export type ImportTotalsShape = Record<"vehicleLines" | "insurers" | "packages" | "bodyTypes", ImportOutcomeShape>;

export type CatalogSourceBounds = Record<
  "vehicleLines" | "insurers" | "packages" | "bodyTypes",
  { normalizedRows: number; batchCount: number }
>;

export function parseEnvContent(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

export function assertDevelopmentConvexTarget(deployment: string, convexUrl: string): void {
  if (!deployment.startsWith("dev:")) {
    throw new Error("La carga solo está permitida contra un despliegue Convex de desarrollo");
  }
  const deploymentName = deployment.slice(4);
  if (!/^[a-z0-9-]+$/.test(deploymentName)) {
    throw new Error("El identificador del despliegue Convex de desarrollo no es válido");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(convexUrl);
  } catch {
    throw new Error("La URL de Convex no es válida");
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== `${deploymentName}.convex.cloud`) {
    throw new Error("La URL de Convex no corresponde al despliegue de desarrollo declarado");
  }
}

export function verifyCatalogReadback(
  expectedRows: CatalogReadbackRow[],
  storedRows: CatalogReadbackRow[]
): CatalogReadbackSummary {
  const expected = uniqueRows(expectedRows, "entrada");
  const stored = uniqueRows(storedRows, "almacenada");
  let matched = 0;
  let superseded = 0;

  for (const [identity, expectedRow] of expected) {
    const storedRow = stored.get(identity);
    const readableIdentity = identity.replace("\u0000", ":");
    if (!storedRow) {
      throw new Error(`A la verificación de lectura le falta la llave ${readableIdentity}`);
    }
    if (storedRow.sourceRegisteredAt < expectedRow.sourceRegisteredAt) {
      throw new Error(`La lectura de la llave ${readableIdentity} quedó en una versión anterior`);
    }
    if (storedRow.sourceRegisteredAt > expectedRow.sourceRegisteredAt) {
      superseded += 1;
      continue;
    }
    if (storedRow.contentHash !== expectedRow.contentHash) {
      throw new Error(`La llave ${readableIdentity} tiene contenido diferente para la misma fecha`);
    }
    matched += 1;
  }

  return {
    inputRows: expected.size,
    storedRows: stored.size,
    matched,
    superseded,
    extras: stored.size - expected.size
  };
}

export function assertCatalogPreflightSafe(
  expectedRows: CatalogReadbackRow[],
  storedRows: CatalogReadbackRow[]
): void {
  const expected = uniqueRows(expectedRows, "entrada");
  const stored = uniqueRows(storedRows, "almacenada");
  for (const [identity, expectedRow] of expected) {
    const storedRow = stored.get(identity);
    if (
      storedRow &&
      storedRow.sourceRegisteredAt === expectedRow.sourceRegisteredAt &&
      storedRow.contentHash !== expectedRow.contentHash
    ) {
      throw new Error(`El preflight encontró contenido diferente para la llave ${identity.replace("\u0000", ":")}`);
    }
  }
}

export function importTotalsEqual(left: ImportTotalsShape, right: ImportTotalsShape): boolean {
  const catalogs: Array<keyof ImportTotalsShape> = ["vehicleLines", "insurers", "packages", "bodyTypes"];
  const fields: Array<keyof ImportOutcomeShape> = [
    "batchesApplied",
    "inserted",
    "updated",
    "unchanged",
    "outdated"
  ];
  return catalogs.every((catalog) => fields.every((field) => left[catalog][field] === right[catalog][field]));
}

export function assertCatalogSourceBounds(files: CatalogSourceBounds): void {
  const bounds: Record<keyof CatalogSourceBounds, { minimum: number; maximum: number; maximumBatches: number }> = {
    vehicleLines: { minimum: 18000, maximum: 40000, maximumBatches: 400 },
    insurers: { minimum: 100, maximum: 2000, maximumBatches: 100 },
    packages: { minimum: 25, maximum: 1000, maximumBatches: 50 },
    bodyTypes: { minimum: 90, maximum: 1000, maximumBatches: 50 }
  };
  for (const catalog of Object.keys(bounds) as Array<keyof CatalogSourceBounds>) {
    const file = files[catalog];
    const bound = bounds[catalog];
    if (
      !Number.isInteger(file.normalizedRows) ||
      !Number.isInteger(file.batchCount) ||
      file.normalizedRows < bound.minimum ||
      file.normalizedRows > bound.maximum ||
      file.batchCount < Math.ceil(file.normalizedRows / 200) ||
      file.batchCount > bound.maximumBatches
    ) {
      throw new Error(`El maestro global ${catalog} está fuera de los límites seguros esperados`);
    }
  }
}

function uniqueRows(rows: CatalogReadbackRow[], label: string): Map<string, CatalogReadbackRow> {
  const unique = new Map<string, CatalogReadbackRow>();
  for (const row of rows) {
    const identity = row.secondaryKey === undefined ? row.key : `${row.key}\u0000${row.secondaryKey}`;
    if (unique.has(identity)) {
      throw new Error(`La lectura ${label} contiene una llave duplicada`);
    }
    unique.set(identity, row);
  }
  return unique;
}
