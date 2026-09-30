import { randomInt } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export type DispatchFleet = {
  senderDocument: string;
  senderName: string;
  recipientDocument: string;
  recipientName: string;
  driverDocument: string;
  driverName: string;
  plate: string;
};

export async function createDispatchFleet(page: Page): Promise<DispatchFleet> {
  const suffix = randomInt(0, 100_000).toString().padStart(5, "0");
  const senderDocument = `999${randomInt(0, 1_000_000).toString().padStart(6, "0")}`;
  const recipientDocument = `19${randomInt(0, 50_000_000).toString().padStart(8, "0")}`;
  const driverDocument = `19${randomInt(50_000_000, 100_000_000).toString().padStart(8, "0")}`;
  const fleet: DispatchFleet = {
    senderDocument,
    senderName: `Remitente QA ${suffix} SAS`,
    recipientDocument,
    recipientName: `Destinataria ${suffix} Prueba Despacho`,
    driverDocument,
    driverName: `Conductor ${suffix} Prueba Despacho`,
    plate: `ZQ${String.fromCharCode(65 + randomInt(0, 26))}${randomInt(0, 1_000).toString().padStart(3, "0")}`
  };

  await page.goto("/maestros/nuevo/tercero");
  await page.getByRole("radio", { name: /Persona jurídica/ }).check();
  await fillField(page, "document", senderDocument);
  await fillField(page, "verificationDigit", colombianVerificationDigit(senderDocument));
  await fillField(page, "legalName", fleet.senderName);
  await selectSearchOption(page, "Ciudad", "Bogota", undefined);
  await page.getByRole("combobox", { name: "Régimen", exact: true }).selectOption("responsable_iva");
  await fillField(page, "address", "Carrera 50 20-30");
  await fillField(page, "phone1", "6017000000");
  await page.getByRole("checkbox", { name: "Propietario de vehículo", exact: true }).check();
  await page.getByRole("checkbox", { name: "Remitente", exact: true }).check();
  await saveRegistered(page, "Tercero creado y disponible para asignarlo a la operación.");

  await page.goto("/maestros/nuevo/tercero");
  await fillField(page, "document", recipientDocument);
  await fillField(page, "firstNames", `Destinataria ${suffix}`);
  await fillField(page, "firstLastName", "Prueba");
  await fillField(page, "secondLastName", "Despacho");
  await selectSearchOption(page, "Ciudad", "Medellin", undefined);
  await page.getByRole("combobox", { name: "Régimen", exact: true }).selectOption("no_responsable_iva");
  await fillField(page, "address", "Calle 30 40-50");
  await fillField(page, "phone1", "6044000000");
  await page.getByRole("checkbox", { name: "Destinatario", exact: true }).check();
  await page.getByRole("checkbox", { name: "Poseedor de vehículo", exact: true }).check();
  await saveRegistered(page, "Tercero creado y disponible para asignarlo a la operación.");

  await page.goto("/maestros/nuevo/conductor");
  await fillField(page, "document", driverDocument);
  await fillField(page, "firstNames", `Conductor ${suffix}`);
  await fillField(page, "firstLastName", "Prueba");
  await fillField(page, "secondLastName", "Despacho");
  await fillField(page, "birthDate", "1988-03-10");
  await page.getByRole("combobox", { name: "Sexo", exact: true }).selectOption("M");
  await page.getByRole("combobox", { name: "RH", exact: true }).selectOption("O+");
  await page.getByRole("combobox", { name: "Calificación", exact: true }).selectOption("A");
  await fillField(page, "address", "Calle 80 15-20");
  await selectSearchOption(page, "Ciudad", "Bogota", undefined);
  await fillField(page, "phone1", "6016000000");
  await fillField(page, "cellphone", "3000000000");
  await page.getByRole("combobox", { name: "Operador móvil", exact: true }).selectOption("Claro");
  await fillField(page, "licenseNumber", `LIC-${suffix}`);
  await page.getByRole("combobox", { name: "Categoría", exact: true }).selectOption("C3");
  await fillField(page, "licenseExpiresAt", "2030-12-31");
  await fillField(page, "workReferences.0.company", "Transportes Referencia QA");
  await fillField(page, "workReferences.0.contactName", "Contacto QA");
  await fillField(page, "workReferences.0.phone", "6016000001");
  await page.getByRole("checkbox", { name: "Empleado", exact: true }).check();
  await saveRegistered(page, "Conductor creado y disponible para asignaciones.");

  await page.goto("/maestros/nuevo/vehiculo");
  await fillField(page, "plate", fleet.plate);
  await selectSearchOption(page, "Marca y línea", "169", /FREIGHTLINER/i);
  await fillField(page, "modelYear", "2024");
  await fillField(page, "color", "8");
  await page.getByRole("combobox", { name: "Tipo de vinculación", exact: true }).selectOption("propio");
  await selectSearchOption(page, "Carrocería", "285", /PLATAFORMA CON ESTACAS DESMONTABLES/i);
  await fillField(page, "engineNumber", `MOTOR-${suffix}`);
  await fillField(page, "serialNumber", `SERIE-${suffix}`);
  await fillField(page, "emptyWeightTn", "5.2");
  await fillField(page, "capacityTn", "10");
  await page.getByRole("combobox", { name: "Configuración RNDC", exact: true }).selectOption("50");
  await page.getByRole("combobox", { name: "Combustible RNDC", exact: true }).selectOption("1");
  await fillField(page, "transitLicenseNumber", `LT-${suffix}`);
  await page.getByRole("combobox", { name: "Calificación", exact: true }).selectOption("A");
  await fillField(page, "soatNumber", `SOAT-${suffix}`);
  await selectSearchOption(page, "Aseguradora SOAT", "8600095786", /SEGUROS DEL ESTADO/i);
  await fillField(page, "soatExpiresAt", "2028-12-31");
  await selectSearchOption(page, "Propietario", senderDocument, fleet.senderName);
  await selectSearchOption(page, "Poseedor", recipientDocument, fleet.recipientName);
  await selectSearchOption(page, "Conductor principal", driverDocument, fleet.driverName);
  await saveRegistered(page, "Vehículo creado y disponible para asignaciones.");

  return fleet;
}

async function fillField(page: Page, name: string, value: string) {
  await page.locator(`[name="${name}"]`).fill(value);
}

async function saveRegistered(page: Page, message: string) {
  await page.getByRole("button", { name: "Guardar maestro", exact: true }).click();
  await expect(page.getByText(message)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("quedó registrado en el RNDC.")).toBeVisible({ timeout: 45_000 });
}

async function selectSearchOption(page: Page, label: string, term: string, expected: string | RegExp | undefined) {
  await page.getByRole("combobox", { name: label, exact: true }).fill(term);
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible({ timeout: 15_000 });
  const option = expected ? listbox.getByRole("option").filter({ hasText: expected }).first() : listbox.getByRole("option").first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
}

function colombianVerificationDigit(document: string): string {
  const weights = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3];
  const offset = weights.length - document.length;
  const sum = [...document].reduce((total, digit, index) => total + Number(digit) * weights[index + offset], 0);
  const remainder = sum % 11;
  return String(remainder < 2 ? remainder : 11 - remainder);
}
