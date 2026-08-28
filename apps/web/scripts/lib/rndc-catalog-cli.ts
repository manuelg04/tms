import path from "node:path";

export type CatalogCliOptions = {
  vehicleLinesPath: string;
  insurersPath: string;
  packagesPath: string;
  bodyTypesPath: string;
  apply: boolean;
};

export function parseCatalogArgs(argv: string[]): CatalogCliOptions {
  let vehicleLinesPath = "";
  let insurersPath = "";
  let packagesPath = "";
  let bodyTypesPath = "";
  let apply = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--vehicle-lines") {
      if (vehicleLinesPath) throw new Error("Ruta repetida: --vehicle-lines");
      vehicleLinesPath = argv[++index] ?? "";
    } else if (arg === "--insurers") {
      if (insurersPath) throw new Error("Ruta repetida: --insurers");
      insurersPath = argv[++index] ?? "";
    } else if (arg === "--packages") {
      if (packagesPath) throw new Error("Ruta repetida: --packages");
      packagesPath = argv[++index] ?? "";
    } else if (arg === "--body-types") {
      if (bodyTypesPath) throw new Error("Ruta repetida: --body-types");
      bodyTypesPath = argv[++index] ?? "";
    } else if (arg === "--apply") apply = true;
    else throw new Error(`Argumento desconocido: ${arg}`);
  }

  if (!vehicleLinesPath || !insurersPath || !packagesPath || !bodyTypesPath) {
    throw new Error("Faltan rutas obligatorias para los cuatro catálogos RNDC");
  }

  const resolvedPaths = [vehicleLinesPath, insurersPath, packagesPath, bodyTypesPath].map((filePath) => path.resolve(filePath));
  if (new Set(resolvedPaths).size !== resolvedPaths.length) {
    throw new Error("Cada catálogo requiere un archivo diferente");
  }

  return { vehicleLinesPath, insurersPath, packagesPath, bodyTypesPath, apply };
}
