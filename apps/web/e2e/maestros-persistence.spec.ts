import { randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const password = readPassword();
const conceptImage = fileURLToPath(new URL("../../../docs/design/2026-07-09-expediente-detail-concept.png", import.meta.url));

test("persists the four operational masters, their relationships and an idempotent retry without RNDC traffic", async ({ context, page }, testInfo) => {
  test.setTimeout(240_000);
  const rndcRequests: string[] = [];
  const rndcHealthRequests: string[] = [];
  const data = makeRunData();

  await context.route("**/api/rndc/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/rndc/health") {
      rndcHealthRequests.push(route.request().url());
      await route.continue();
      return;
    }
    rndcRequests.push(route.request().url());
    await route.abort();
  });
  await login(page);
  await testInfo.attach("master-keys", {
    body: Buffer.from(JSON.stringify({
      ownerDocument: data.ownerDocument,
      naturalDocument: data.naturalDocument,
      trailerPlate: data.trailerPlate,
      vehiclePlate: data.vehiclePlate
    }, null, 2)),
    contentType: "application/json"
  });

  await test.step("create a legal owner and prove an exact retry is unchanged", async () => {
    await page.goto("/maestros/nuevo/tercero");
    await page.getByRole("radio", { name: /Persona jurídica/ }).check();
    await fillField(page, "document", data.ownerDocument);
    await fillField(page, "verificationDigit", data.ownerVerificationDigit);
    await fillField(page, "legalName", data.ownerName);
    await fillField(page, "abbreviation", `QA ${data.suffix}`);
    await selectSearchOption(page, "Ciudad", "Bogota", undefined, "municipio Bogotá para el propietario");
    await page.getByRole("combobox", { name: "Régimen", exact: true }).selectOption("responsable_iva");
    await fillField(page, "address", data.ownerAddress);
    await fillField(page, "phone1", data.ownerPhone);
    await page.getByRole("checkbox", { name: "Propietario de vehículo", exact: true }).check();
    await saveAndExpect(page, "Tercero creado y disponible para asignarlo a la operación.");
    await saveAndExpect(page, "El tercero ya estaba registrado con la misma información.");
  });

  await test.step("create a natural sender", async () => {
    await page.goto("/maestros/nuevo/tercero");
    await fillField(page, "document", data.naturalDocument);
    await fillField(page, "firstNames", data.firstNames);
    await fillField(page, "firstLastName", data.firstLastName);
    await fillField(page, "secondLastName", data.secondLastName);
    await selectSearchOption(page, "Ciudad", "Bogota", undefined, "municipio Bogotá para el remitente");
    await page.getByRole("combobox", { name: "Régimen", exact: true }).selectOption("no_responsable_iva");
    await fillField(page, "address", data.naturalAddress);
    await fillField(page, "phone1", data.naturalPhone);
    await fillField(page, "cellphone", data.naturalCellphone);
    await page.getByRole("checkbox", { name: "Remitente", exact: true }).check();
    await saveAndExpect(page, "Tercero creado y disponible para asignarlo a la operación.");
  });

  await test.step("create a driver on the natural party and accumulate operational roles", async () => {
    await page.goto("/maestros/nuevo/conductor");
    await fillField(page, "document", data.naturalDocument);
    await fillField(page, "firstNames", data.firstNames);
    await fillField(page, "firstLastName", data.firstLastName);
    await fillField(page, "secondLastName", data.secondLastName);
    await fillField(page, "birthDate", "1990-06-15");
    await page.getByRole("combobox", { name: "Sexo", exact: true }).selectOption("F");
    await page.getByRole("combobox", { name: "RH", exact: true }).selectOption("O+");
    await page.getByRole("combobox", { name: "Calificación", exact: true }).selectOption("A");
    await fillField(page, "address", data.naturalAddress);
    await selectSearchOption(page, "Ciudad", "Bogota", undefined, "municipio Bogotá para el conductor");
    await fillField(page, "phone1", data.naturalPhone);
    await fillField(page, "cellphone", data.naturalCellphone);
    await page.getByRole("combobox", { name: "Operador móvil", exact: true }).selectOption("Claro");
    await fillField(page, "licenseNumber", data.licenseNumber);
    await page.getByRole("combobox", { name: "Categoría", exact: true }).selectOption("C3");
    await fillField(page, "licenseExpiresAt", "2030-12-31");
    await fillField(page, "workReferences.0.company", "Transportes Referencia QA");
    await fillField(page, "workReferences.0.contactName", "Contacto QA");
    await fillField(page, "workReferences.0.phone", data.naturalPhone);
    await page.getByRole("checkbox", { name: "Propietario", exact: true }).check();
    await page.getByRole("checkbox", { name: "Poseedor", exact: true }).check();
    await page.getByRole("checkbox", { name: "Empleado", exact: true }).check();
    await saveAndExpect(page, "Conductor creado y disponible para asignaciones.");
  });

  await test.step("create a trailer and persist tonne inputs as kilograms", async () => {
    await page.goto("/maestros/nuevo/remolque");
    await fillField(page, "plate", data.trailerPlate);
    await page.getByRole("combobox", { name: "Tipo de remolque", exact: true }).selectOption("semirremolque");
    await fillField(page, "make", "RANDON");
    await fillField(page, "modelYear", "2026");
    await fillField(page, "configuration", "S3");
    await fillField(page, "emptyWeightTn", "8.25");
    await fillField(page, "capacityTn", "34.75");
    await fillField(page, "widthM", "2.6");
    await fillField(page, "heightM", "4.1");
    await fillField(page, "lengthM", "13.6");
    await fillField(page, "rearVolumeM3", "92.5");
    await selectSearchOption(page, "Carrocería", "285", /PLATAFORMA CON ESTACAS DESMONTABLES/i, "carrocería RNDC 285 para el remolque");
    await selectSearchOption(page, "Propietario", data.ownerDocument, new RegExp(escapeRegExp(data.ownerName), "i"), "tercero jurídico propietario recién creado");
    await page.getByRole("group", { name: "Foto y observaciones", exact: true }).locator("input[type='file']").setInputFiles(conceptImage);
    await expect(page.getByRole("img", { name: "Vista previa de foto del remolque", exact: true })).toBeVisible();
    await saveAndExpect(page, "Remolque creado y disponible para asignaciones.");
  });

  await test.step("create a vehicle with catalogs and every required relationship", async () => {
    await page.goto("/maestros/nuevo/vehiculo");
    await fillField(page, "plate", data.vehiclePlate);
    await selectSearchOption(page, "Marca y línea", "169", /FREIGHTLINER/i, "línea RNDC de la marca 169 FREIGHTLINER");
    await fillField(page, "modelYear", "2026");
    await fillField(page, "color", "8");
    await page.getByRole("combobox", { name: "Tipo de vehículo", exact: true }).selectOption("cabezote");
    await page.getByRole("combobox", { name: "Tipo de vinculación", exact: true }).selectOption("propio");
    await selectSearchOption(page, "Carrocería", "285", /PLATAFORMA CON ESTACAS DESMONTABLES/i, "carrocería RNDC 285 para el vehículo");
    await fillField(page, "engineNumber", `MOTOR-${data.suffix}`);
    await fillField(page, "serialNumber", `SERIE-${data.suffix}`);
    await fillField(page, "emptyWeightTn", "7.4");
    await fillField(page, "capacityTn", "18.5");
    await page.getByRole("combobox", { name: "Configuración RNDC", exact: true }).selectOption("54");
    await page.getByRole("combobox", { name: "Combustible RNDC", exact: true }).selectOption("1");
    await fillField(page, "transitLicenseNumber", data.transitLicense);
    await page.getByRole("combobox", { name: "Calificación", exact: true }).selectOption("A");
    await fillField(page, "soatNumber", data.soatNumber);
    await selectSearchOption(page, "Aseguradora SOAT", "8600095786", /SEGUROS DEL ESTADO/i, "aseguradora RNDC SEGUROS DEL ESTADO");
    await fillField(page, "soatExpiresAt", "2028-12-31");
    await selectSearchOption(page, "Propietario", data.ownerDocument, new RegExp(escapeRegExp(data.ownerName), "i"), "propietario jurídico del vehículo");
    await selectSearchOption(page, "Poseedor", data.naturalDocument, new RegExp(escapeRegExp(data.naturalName), "i"), "poseedor natural enriquecido por el conductor");
    await selectSearchOption(page, "Conductor principal", data.naturalDocument, new RegExp(escapeRegExp(data.naturalName), "i"), "conductor recién creado");
    await selectSearchOption(page, "Remolque habitual", data.trailerPlate, new RegExp(data.trailerPlate), "remolque recién creado");
    await saveAndExpect(page, "Vehículo creado y disponible para asignaciones.");
  });

  await test.step("read every persisted master and its reactive relationships", async () => {
    await page.goto("/maestros");
    await page.reload();

    await page.getByRole("button", { name: "Terceros", exact: true }).click();
    await page.getByLabel("Filtrar terceros por identificación", { exact: true }).fill(data.ownerDocument);
    const ownerRow = await visibleDesktopRow(page, "Listado de terceros", data.ownerDocument);
    await expect(ownerRow).toContainText(data.ownerName);
    await expect(ownerRow).toContainText("Propietario");

    await page.getByLabel("Filtrar terceros por identificación", { exact: true }).fill(data.naturalDocument);
    const naturalRow = await visibleDesktopRow(page, "Listado de terceros", data.naturalDocument);
    await expect(naturalRow).toContainText(data.naturalName);
    for (const role of ["Remitente", "Conductor", "Propietario", "Poseedor", "Empleado"]) {
      await expect(naturalRow).toContainText(role);
    }

    await page.getByRole("button", { name: "Conductores", exact: true }).click();
    await page.getByLabel("Filtrar conductores por documento", { exact: true }).fill(data.naturalDocument);
    const driverRow = await visibleDesktopRow(page, "Listado de conductores", data.naturalDocument);
    await expect(driverRow).toContainText(data.naturalName);
    await expect(driverRow.locator("td").nth(3)).toHaveText("1");
    await driverRow.click();
    const driverDetail = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: data.naturalName, exact: true }) });
    await expect(driverDetail).toContainText(`${data.licenseNumber} · C3`);
    await expect(driverDetail).toContainText(data.vehiclePlate);

    await page.getByRole("button", { name: "Remolques", exact: true }).click();
    await page.getByLabel("Filtrar remolques por placa", { exact: true }).fill(data.trailerPlate);
    const trailerRow = await visibleDesktopRow(page, "Listado de remolques", data.trailerPlate);
    await expect(trailerRow).toContainText("34,75 t");
    await expect(trailerRow).toContainText(data.ownerName);
    await trailerRow.click();
    const trailerDetail = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: `Remolque ${data.trailerPlate}`, exact: true }) });
    await expect(trailerDetail).toContainText("8,25 t");
    await expect(trailerDetail).toContainText("2,6 × 4,1 × 13,6 m");
    await expect(trailerDetail).toContainText("2026-07-09-expediente-detail-concept.png");

    await page.getByRole("button", { name: "Vehículos", exact: true }).click();
    await page.getByLabel("Filtrar vehiculos por placa", { exact: true }).fill(data.vehiclePlate);
    const vehicleRow = await visibleDesktopRow(page, "Listado de vehículos", data.vehiclePlate);
    await expect(vehicleRow).toContainText(data.ownerName);
    await expect(vehicleRow).toContainText(data.naturalName);
    await expect(vehicleRow.locator("td").nth(5)).toHaveText("1");
    await vehicleRow.click();
    const vehicleDetail = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: data.vehiclePlate, exact: true }) });
    await expect(vehicleDetail).toContainText(data.trailerPlate);
    await expect(vehicleDetail).toContainText(data.soatNumber);
    await expect(vehicleDetail).toContainText("SEGUROS DEL ESTADO");
    await expect(vehicleDetail).toContainText(data.ownerName);
    await expect(vehicleDetail).toContainText(data.naturalName);
    await expect(vehicleDetail).toContainText("18.5");
    await expect(vehicleDetail).toContainText("7.4");
  });

  await testInfo.attach("rndc-requests", {
    body: Buffer.from(JSON.stringify(rndcRequests, null, 2)),
    contentType: "application/json"
  });
  await testInfo.attach("rndc-health-requests", {
    body: Buffer.from(JSON.stringify(rndcHealthRequests, null, 2)),
    contentType: "application/json"
  });
  expect(rndcRequests, "master creation and read-back must never call the RNDC API").toEqual([]);
});

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { email: "operador@mtm.local", password }
  });
  expect(response.ok()).toBe(true);
}

async function fillField(page: Page, name: string, value: string) {
  await page.locator(`[name="${name}"]`).fill(value);
}

async function saveAndExpect(page: Page, message: string) {
  await page.getByRole("button", { name: "Guardar maestro", exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 45_000 });
}

async function selectSearchOption(page: Page, label: string, term: string, expected: string | RegExp | undefined, description: string) {
  const input = page.getByRole("combobox", { name: label, exact: true });
  await input.fill(term);
  const listbox = page.getByRole("listbox");
  await expect(listbox, `El selector de ${description} no abrió resultados`).toBeVisible({ timeout: 15_000 });
  const option = expected
    ? listbox.getByRole("option").filter({ hasText: expected }).first()
    : listbox.getByRole("option").first();
  await expect(option, `El deployment dev no devolvió ${description}; no se inventaron IDs`).toBeVisible({ timeout: 15_000 });
  await option.click();
}

async function visibleDesktopRow(page: Page, regionName: string, key: string) {
  const region = page.getByRole("region", { name: regionName, exact: true });
  const row = region.locator(".master-desktop-table tbody tr").filter({ hasText: key }).first();
  await expect(row, `El registro ${key} no apareció en ${regionName}`).toBeVisible({ timeout: 20_000 });
  return row;
}

function makeRunData() {
  const suffix = randomBytes(4).toString("hex").toUpperCase().slice(0, 5);
  const ownerDocument = `900${randomInt(0, 1_000_000).toString().padStart(6, "0")}`;
  const naturalDocument = `10${randomInt(0, 100_000_000).toString().padStart(8, "0")}`;
  const firstNames = `Laura ${suffix}`;
  const firstLastName = "Prueba";
  const secondLastName = "Persistencia";
  return {
    suffix,
    ownerDocument,
    ownerVerificationDigit: colombianVerificationDigit(ownerDocument),
    ownerName: `Transportes QA ${suffix} SAS`,
    ownerAddress: `Carrera 50 20-${randomInt(10, 99)}`,
    ownerPhone: `6017${randomInt(0, 1_000_000).toString().padStart(6, "0")}`,
    naturalDocument,
    firstNames,
    firstLastName,
    secondLastName,
    naturalName: `${firstNames} ${firstLastName} ${secondLastName}`,
    naturalAddress: `Calle 80 15-${randomInt(10, 99)}`,
    naturalPhone: `6016${randomInt(0, 1_000_000).toString().padStart(6, "0")}`,
    naturalCellphone: `300${randomInt(0, 10_000_000).toString().padStart(7, "0")}`,
    licenseNumber: `LIC-${suffix}`,
    trailerPlate: `R${randomInt(0, 100_000).toString().padStart(5, "0")}`,
    vehiclePlate: `${randomLetters(3)}${randomInt(0, 1_000).toString().padStart(3, "0")}`,
    transitLicense: `LT-${suffix}`,
    soatNumber: `SOAT-${suffix}`
  };
}

function randomLetters(length: number): string {
  return Array.from({ length }, () => String.fromCharCode(65 + randomInt(0, 26))).join("");
}

function colombianVerificationDigit(document: string): string {
  const weights = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3];
  const offset = weights.length - document.length;
  const sum = [...document].reduce((total, digit, index) => total + Number(digit) * weights[index + offset], 0);
  const remainder = sum % 11;
  return String(remainder < 2 ? remainder : 11 - remainder);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readPassword(): string {
  const source = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const match = /^DEMO_AUTH_PASSWORD=(.*)$/m.exec(source);
  if (!match) throw new Error("DEMO_AUTH_PASSWORD is not configured");
  return match[1].trim().replace(/^['\"]|['\"]$/g, "");
}
