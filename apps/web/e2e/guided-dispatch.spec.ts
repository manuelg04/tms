import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const password = readPassword();

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("dispatch queue shows stage RNDC status and one next action without horizontal overflow", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Despachos" })).toBeVisible();
  await expect(page.getByText("Cola de trabajo", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuevo despacho" })).toBeVisible();
  await expect(page.locator(".dispatch-row").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".dispatch-row").first().locator(".rndc-state")).toBeVisible();
  await expect(page.locator(".dispatch-row").first().locator(".queue-next-action")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("base creation hands the operator to the document hub", async ({ page }) => {
  await page.goto("/expedientes/nuevo");
  await fillLoadingOrder(page, `GUIDED-${Date.now()}`);
  await expect(page.locator("#loading-order-title")).toBeVisible();
  await expect(page.getByText("Paso 1 de 5")).toHaveCount(0);
  await page.getByRole("button", { name: "Crear despacho y abrir documentos" }).click();
  await expect(page).toHaveURL(/\/expedientes\/[^/?]+\?stage=orden_cargue/);
  await expect(page.getByRole("region", { name: "Documentos del despacho" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("loading order is saved before optional dispatch stages", async ({ page }) => {
  await page.goto("/expedientes/nuevo");
  await fillLoadingOrder(page, `EARLY-${Date.now()}`);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page).toHaveURL(/\/expedientes\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Expediente de viaje" })).toBeVisible();
});

test("dispatch documents can be completed and emitted in separate sessions", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/expedientes/nuevo");
  await fillLoadingOrder(page, `ASYNC-${Date.now()}`);
  await page.getByRole("button", { name: "Crear despacho y abrir documentos" }).click();
  await expect(page.getByRole("region", { name: "Documentos del despacho" })).toBeVisible();
  const detailUrl = page.url();

  const assignmentCard = documentCard(page, "Vehículo y conductor");
  await assignmentCard.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Documento del conductor").fill("1000000001");
  await page.getByLabel("Placa del vehículo").fill("DEM001");
  await expect(page.locator("#stage-primary-form .lookup-card small.ok")).toHaveCount(2);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(assignmentCard.getByText("Completado")).toBeVisible();

  const orderCard = documentCard(page, "Orden de cargue");
  await expect(orderCard.getByRole("button", { name: "Emitir a RNDC" })).toBeEnabled();
  await orderCard.getByRole("button", { name: "Emitir a RNDC" }).click();
  await expect(orderCard.locator(".status-badge")).toContainText("Autorizado", { timeout: 20_000 });

  const dispatchCode = await page.locator(".dispatch-detail-hero h2").innerText();
  await page.goto("/expedientes");
  await page.getByLabel("Filtrar por etapa").selectOption("pending_manifest");
  await expect(page.getByRole("link", { name: dispatchCode, exact: true })).toBeVisible();
  await page.goto(detailUrl);

  await page.request.post("/api/auth/logout");
  await login(page);
  await page.goto(detailUrl);
  await expect(page.getByRole("region", { name: "Documentos del despacho" })).toBeVisible();

  const consignmentCard = documentCard(page, "Remesas");
  await consignmentCard.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Valor declarado").fill("5000000");
  await page.getByLabel("Número de póliza").fill("POL-ASYNC-1");
  await page.getByLabel("Vencimiento de póliza").fill("2027-07-13");
  await page.getByLabel("NIT de la aseguradora").fill("900123456");
  await page.getByRole("button", { name: "Guardar cambios" }).click();

  const manifestCard = documentCard(page, "Manifiesto");
  await manifestCard.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Fecha de expedición").fill("2026-07-13");
  await page.getByLabel("Entrega estimada").fill("2026-07-15");
  await page.getByLabel("Tipo de manifiesto").fill("General");
  await page.getByLabel("Flete total").fill("2500000");
  await page.getByLabel("Neto a pagar").fill("2500000");
  await page.getByLabel("Responsable de pago").fill("MTM");
  await page.getByRole("button", { name: "Guardar cambios" }).click();

  await expect(consignmentCard.getByRole("button", { name: "Emitir a RNDC" })).toBeEnabled();
  await consignmentCard.getByRole("button", { name: "Emitir a RNDC" }).click();
  await expect(consignmentCard.locator(".status-badge")).toContainText("Autorizado", { timeout: 20_000 });
  await expect(manifestCard.getByRole("button", { name: "Emitir a RNDC" })).toBeEnabled();
  await manifestCard.getByRole("button", { name: "Emitir a RNDC" }).click();
  await expect(manifestCard.locator(".status-badge")).toContainText("Autorizado", { timeout: 20_000 });
});

test("dispatch detail keeps independent documents and history in one hub", async ({ page }) => {
  await page.locator(".dispatch-row").first().locator(".queue-next-action").click();
  await expect(page.getByRole("heading", { level: 1, name: "Expediente de viaje" })).toBeVisible();
  await expect(page.getByText("Siguiente acción")).toBeVisible();
  await expect(page.getByRole("region", { name: "Documentos del despacho" })).toBeVisible();
  await expect(page.locator(".document-hub-card")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Documentos e historial" })).toBeVisible();
  await expect(page.locator(".next-action-card .primary-action")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("operators can manage official corrections and annulments without structural exceptions", async ({ page }) => {
  const rows = page.locator(".dispatch-row");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  await rows.first().locator(".queue-next-action").click();
  await expect(page.getByRole("heading", { name: "Correcciones, anulaciones y soporte" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Conciliar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Corregir remesa", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Anular documento", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remesa sin orden", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Manifiesto vacío", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Transbordo", exact: true })).toHaveCount(0);
});

test("document navigation exposes stable queues and opens the related dispatch stage", async ({ page }) => {
  await page.goto("/documentos/ordenes");
  await expect(page.getByRole("heading", { level: 1, name: "Órdenes de cargue" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Tipos de documento" }).getByRole("link", { name: "Remesas", exact: true })).toBeVisible();
  const openLink = page.getByRole("link", { name: "Abrir orden" }).first();
  await expect(openLink).toBeVisible({ timeout: 15_000 });
  await openLink.click();
  await expect(page).toHaveURL(/\?stage=orden_cargue#centro-documental$/);
  await expect(page.locator("#centro-documental")).toBeVisible();
});

test("corrections and annulments are visible from the main navigation", async ({ page }) => {
  await page.goto("/correcciones");
  await expect(page.getByRole("heading", { level: 1, name: "Correcciones y anulaciones" })).toBeVisible();
  await expect(page.getByText("Acciones oficiales protegidas", { exact: true })).toBeVisible();
  const reviewLink = page.getByRole("link", { name: "Revisar acciones" }).first();
  await expect(reviewLink).toBeVisible({ timeout: 15_000 });
  await reviewLink.click();
  await expect(page).toHaveURL(/\?panel=correcciones#correcciones$/);
  await expect(page.getByRole("heading", { name: "Correcciones, anulaciones y soporte" })).toBeVisible();
  await page.goto("/correcciones");
  const annulmentLink = page.getByRole("link", { name: "Preparar anulación" }).first();
  await expect(annulmentLink).toBeVisible({ timeout: 15_000 });
  await annulmentLink.click();
  await expect(page).toHaveURL(/\?panel=correcciones&action=annul#correcciones$/);
  await expect(page.getByRole("dialog", { name: "Anular documento" })).toBeVisible();
});

test("administration receives six complete advanced exception forms", async ({ page }) => {
  await page.request.post("/api/auth/logout");
  const response = await page.request.post("/api/auth/login", { data: { email: "admin@mtm.local", password } });
  expect(response.ok()).toBe(true);
  await page.goto("/expedientes");
  const rows = page.locator(".dispatch-row");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  await rows.first().locator(".queue-next-action").click();
  await expect(page.getByRole("heading", { name: "Correcciones, anulaciones y soporte" })).toBeVisible();
  await expect(page.locator(".advanced-action-buttons button")).toHaveCount(6);
  await page.getByRole("button", { name: "Manifiesto vacío", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Crear manifiesto vacío" })).toBeVisible();
  await expect(page.getByLabel("Razón del viaje vacío")).toBeVisible();
  await expect(page.locator('input[name*="gps" i], input[name*="tracking" i], input[name*="control" i]')).toHaveCount(0);
  await expect(page.locator(".advanced-modal-card")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("mobile navigation opens as a compact menu", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  const trigger = page.getByRole("button", { name: "Abrir menú" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator(".sidebar.open")).toBeVisible();
  await expect(page.locator(".sidebar.open").getByRole("link", { name: "Despachos" })).toBeVisible();
  await expect(page.locator(".sidebar.open").getByRole("link", { name: "Órdenes de cargue" })).toBeVisible();
  await expect(page.locator(".sidebar.open").getByRole("link", { name: "Correcciones y anulaciones" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { email: "operador@mtm.local", password }
  });
  expect(response.ok()).toBe(true);
  await page.goto("/expedientes");
}

async function fillLoadingOrder(page: Page, suffix: string) {
  await page.getByLabel("Orden de servicio").fill(`OS-${suffix}`);
  await page.getByLabel("Código del cliente").fill(`CLI-${suffix}`);
  await page.getByLabel("Cliente o razón social").fill(`Cliente ${suffix}`);
  await page.getByLabel("Tipo de identificación", { exact: true }).first().fill("NIT");
  await page.getByLabel("Identificación del cliente").fill(`900${suffix.replace(/\D/g, "").slice(-6)}`);
  await page.getByLabel("Código sede RNDC remitente").fill("1");
  const loading = page.getByRole("group", { name: "Cargue", exact: true });
  await loading.getByLabel("Lugar").fill("Bodega Bogotá");
  await loading.getByLabel("Ciudad").fill("Bogotá");
  await loading.getByLabel("Dirección").fill("Calle 10 # 20-30");
  await loading.getByLabel("Código municipio RNDC").fill("11001000");
  await loading.getByLabel("Cita de cargue").fill("2026-07-14T08:00");
  const unloading = page.getByRole("group", { name: "Descargue", exact: true });
  await unloading.getByLabel("Lugar").fill("Centro Medellín");
  await unloading.getByLabel("Ciudad").fill("Medellín");
  await unloading.getByLabel("Dirección").fill("Carrera 40 # 50-60");
  await unloading.getByLabel("Código municipio RNDC").fill("05001000");
  await unloading.getByLabel("Cita de descargue").fill("2026-07-15T14:00");
  await page.getByLabel("Destinatario", { exact: true }).fill(`Destinatario ${suffix}`);
  await page.getByLabel("Tipo de identificación", { exact: true }).nth(1).fill("NIT");
  await page.getByLabel("Identificación destinatario", { exact: true }).fill("901234567");
  await page.getByLabel("Código sede RNDC destinatario").fill("1");
  await page.getByLabel("Mercancía", { exact: true }).fill("Carga seca");
  await page.getByLabel("Peso total (TN)").fill("12.5");
  await page.getByLabel("Tipo de empaque").fill("PAQUETE");
  await page.getByLabel("Código de mercancía").fill("005229");
  await page.getByLabel("Naturaleza de la carga").fill("1");
}

function documentCard(page: Page, title: string) {
  return page.locator(".document-hub-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

function readPassword(): string {
  const source = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const match = /^DEMO_AUTH_PASSWORD=(.*)$/m.exec(source);
  if (!match) throw new Error("DEMO_AUTH_PASSWORD is not configured");
  return match[1].trim().replace(/^['\"]|['\"]$/g, "");
}
