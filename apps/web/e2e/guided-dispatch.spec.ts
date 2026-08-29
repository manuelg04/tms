import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const password = readPassword();

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("loading order creation mirrors the Avansat field contract", async ({ page }) => {
  await page.goto("/expedientes/nuevo");

  const orderNumber = page.getByLabel("Nro. de orden de cargue", { exact: true });
  await expect(orderNumber).toBeVisible();
  await expect(orderNumber).toHaveAttribute("readonly", "");
  await expect(orderNumber).toHaveValue(/^\d{9}$/);
  await expect(page.getByLabel("Orden de servicio", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Referencia del cliente", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Sede RNDC remitente", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Sede RNDC destinatario", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Código de mercancía", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Naturaleza de la carga", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Conductor", exact: true })).toHaveCount(0);

  for (const label of [
    "Cliente",
    "Nombre del remitente",
    "Ciudad remitente",
    "Nombre del destinatario",
    "Ciudad destinatario",
    "Placa",
    "Tipo de empaque"
  ]) {
    await expect(page.getByRole("combobox", { name: label, exact: true })).toBeVisible();
  }

  for (const label of [
    "Dirección remitente",
    "Dirección destinatario",
    "Peso (TN)",
    "Volumen (m³)",
    "Cantidad",
    "Mercancía",
    "Campo opcional"
  ]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }

  await expect(page.getByLabel(/^Flete conductor/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Fecha mínima", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fecha máxima", exact: true })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("dispatch queue shows stage RNDC status and one next action without horizontal overflow", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Despachos", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Listado de despachos" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuevo despacho" })).toBeVisible();
  await expect(page.locator(".dispatch-row").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".dispatch-row").first().locator(".rndc-state")).toBeVisible();
  await expect(page.locator(".dispatch-row").first().locator(".queue-next-action")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("base creation hands the operator to the document hub", async ({ page }) => {
  await page.goto("/expedientes/nuevo");
  await fillLoadingOrder(page, `GUIDED-${Date.now()}`);
  const orderNumber = await page.getByLabel("Nro. de orden de cargue", { exact: true }).inputValue();
  await expect(page.locator("#loading-order-title")).toBeVisible();
  await expect(page.getByText("Paso 1 de 5")).toHaveCount(0);
  await page.getByRole("button", { name: "Crear despacho y abrir documentos" }).click();
  await expect(page).toHaveURL(/\/expedientes\/[^/?]+\?stage=orden_cargue/);
  await expect(page.getByRole("region", { name: "Documentos del despacho" })).toBeVisible();
  await expect(documentCard(page, "Vehículo y conductor").getByText("Completado")).toBeVisible();
  await expect(page.getByLabel("Resumen del despacho").getByText(orderNumber, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("loading order is saved before optional dispatch stages", async ({ page }) => {
  await page.goto("/expedientes/nuevo");
  await fillLoadingOrder(page, `EARLY-${Date.now()}`);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page).toHaveURL(/\/expedientes\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Expediente de viaje" })).toBeVisible();
});

test("consignment creation mirrors the Avansat field contract", async ({ page }) => {
  await page.goto("/expedientes/nuevo");
  await fillLoadingOrder(page, `REMESA-${Date.now()}`);
  await page.getByRole("button", { name: "Crear despacho y abrir documentos" }).click();
  const consignmentCard = documentCard(page, "Remesas");
  await consignmentCard.getByRole("button", { name: "Editar" }).click();

  const remesaNumber = page.getByLabel("Nro. de remesa", { exact: true });
  await expect(remesaNumber).toBeVisible();
  await expect(remesaNumber).toHaveAttribute("readonly", "");
  await expect(remesaNumber).toHaveValue(/^\d{5}$/);
  await expect(page.getByLabel("De orden de cargue", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Cliente", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Nro. de orden de cargue", { exact: true })).toBeVisible();

  for (const label of [
    "Remesa municipal",
    "Remesa terrestre de carga",
    "Remesa contado",
    "Remesa contraentrega"
  ]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }

  for (const label of [
    "Agencia",
    "Origen",
    "Destino",
    "Tipo de remesa",
    "Tipo consolidado",
    "Operador GPS RNDC",
    "Remitente",
    "Tipo de identificación remitente",
    "Número de identificación remitente",
    "Dirección remitente",
    "Teléfono remitente",
    "Celular remitente",
    "Latitud cargue",
    "Longitud cargue",
    "Horas pactadas cargue",
    "Destinatario",
    "Tipo de identificación destinatario",
    "Número de identificación destinatario",
    "Dirección destinatario",
    "Teléfono destinatario",
    "Celular destinatario",
    "Latitud descargue",
    "Longitud descargue",
    "Horas pactadas descargue",
    "Valor declarado mercancía",
    "Valor remesa",
    "Nro. manifiesto",
    "% seguro",
    "Tomador del seguro",
    "Aseguradora",
    "Nro. póliza",
    "Unidad de medida",
    "Mercancía",
    "Código de empaque",
    "Naturaleza de la carga",
    "Grupo embalaje envase",
    "Orden de servicio transportador",
    "Observaciones del transportador",
    "Observaciones generales"
  ]) {
    await expect(formControl(page, label)).toBeVisible();
  }

  for (const label of ["Fecha", "Cita de cargue", "Cita de descargue", "Vigencia final"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }

  for (const label of [
    "Remisión 1 número",
    "Remisión 1 cantidad",
    "Remisión 1 clase de bultos",
    "Remisión 1 descripción",
    "Remisión 1 peso",
    "Remisión 1 volumen"
  ]) {
    await expect(formControl(page, label)).toBeVisible();
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("dispatch documents can be completed and emitted in separate sessions", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/expedientes/nuevo");
  await fillLoadingOrder(page, `ASYNC-${Date.now()}`);
  await page.getByRole("button", { name: "Crear despacho y abrir documentos" }).click();
  await expect(page.getByRole("region", { name: "Documentos del despacho" })).toBeVisible();
  const detailUrl = page.url();

  const assignmentCard = documentCard(page, "Vehículo y conductor");
  await expect(assignmentCard.getByText("Completado")).toBeVisible();

  const orderCard = documentCard(page, "Orden de cargue");
  await page.getByLabel("Sede RNDC remitente").fill("1");
  await page.getByLabel("Sede RNDC destinatario").fill("1");
  await page.getByLabel("Código de mercancía").fill("005229");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(orderCard.getByRole("button", { name: "Emitir a RNDC" })).toBeEnabled();
  await orderCard.getByRole("button", { name: "Emitir a RNDC" }).click();
  await expect(orderCard.locator(".status-badge")).toContainText("Autorizado", { timeout: 20_000 });

  const dispatchCode = await page.locator(".dispatch-detail-hero h2").innerText();
  await page.goto("/expedientes");
  await page.getByRole("button", { name: "Más filtros" }).click();
  await page.getByLabel("Filtrar por etapa").selectOption("pending_manifest");
  await expect(page.getByRole("link", { name: dispatchCode, exact: true })).toBeVisible();
  await page.goto(detailUrl);

  await page.request.post("/api/auth/logout");
  await login(page);
  await page.goto(detailUrl);
  await expect(page.getByRole("region", { name: "Documentos del despacho" })).toBeVisible();

  const consignmentCard = documentCard(page, "Remesas");
  await consignmentCard.getByRole("button", { name: "Editar" }).click();
  const remesaNumber = await page.getByLabel("Nro. de remesa", { exact: true }).inputValue();
  await formControl(page, "Valor declarado mercancía").fill("5000000");
  await expect(formControl(page, "Valor declarado mercancía")).toHaveValue("5.000.000");
  await formControl(page, "Valor remesa").fill("400000");
  await formControl(page, "Nro. póliza").fill("POL-ASYNC-1");
  await pickDate(page, "Vigencia final", "Mañana");
  await pickOption(page, "Aseguradora", "seguros", /./);
  await formControl(page, "Remisión 1 número").fill("REM-ASYNC-1");
  await formControl(page, "Remisión 1 cantidad").fill("1");
  await formControl(page, "Unidad de medida").fill("TN");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.goto(detailUrl);
  await documentCard(page, "Remesas").getByRole("button", { name: "Editar" }).click();
  await expect(page.getByLabel("Nro. de remesa", { exact: true })).toHaveValue(remesaNumber);
  await expect(formControl(page, "Valor remesa")).toHaveValue("400.000");

  const manifestCard = documentCard(page, "Manifiesto");
  await manifestCard.getByRole("button", { name: "Editar" }).click();
  await pickDate(page, "Fecha estimada de entrega", "Mañana");
  await page.getByLabel("Tipo de manifiesto").fill("General");
  await page.getByLabel("Valor flete").fill("2500000");
  await expect(page.getByLabel("Neto a pagar")).toHaveValue("2.500.000");
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

test("correction actions stay aligned across document types", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await page.goto("/correcciones");
  await expect(page.locator(".correction-document-row").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".correction-document-header")).toBeVisible();
  const remesaRow = page.locator(".correction-document-row").filter({ has: page.locator(".correction-document-identity > span", { hasText: "Remesa" }) }).first();
  const manifestRow = page.locator(".correction-document-row").filter({ has: page.locator(".correction-document-identity > span", { hasText: "Manifiesto" }) }).first();
  const remesaReview = await remesaRow.getByRole("link", { name: "Revisar acciones" }).boundingBox();
  const manifestReview = await manifestRow.getByRole("link", { name: "Revisar acciones" }).boundingBox();
  const remesaAnnulment = await remesaRow.getByRole("link", { name: "Preparar anulación" }).boundingBox();
  const manifestAnnulment = await manifestRow.getByRole("link", { name: "Preparar anulación" }).boundingBox();
  expect(remesaReview).not.toBeNull();
  expect(manifestReview).not.toBeNull();
  expect(remesaAnnulment).not.toBeNull();
  expect(manifestAnnulment).not.toBeNull();
  expect(Math.abs(remesaReview!.x - manifestReview!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(remesaAnnulment!.x - manifestAnnulment!.x)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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

async function pickOption(page: Page, label: string, term: string, option: string | RegExp, scope: Page | ReturnType<Page["locator"]> = page) {
  const combo = scope.getByRole("combobox", { name: label, exact: true });
  await combo.click();
  await combo.fill(term);
  await page.getByRole("listbox").getByRole("option", { name: option }).first().click();
}

async function pickDate(page: Page, label: string, quick: "Hoy" | "Mañana", withTime = false) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const popover = page.getByRole("dialog").last();
  await popover.getByRole("button", { name: quick, exact: true }).click();
  if (withTime) await popover.getByRole("button", { name: "Listo", exact: true }).click();
}

async function fillLoadingOrder(page: Page, suffix: string) {
  const digits = suffix.replace(/\D/g, "").slice(-6).padStart(6, "0");
  await page.getByRole("combobox", { name: "Cliente", exact: true }).fill(`Cliente ${suffix}`);
  await page.getByRole("combobox", { name: "Nombre del remitente", exact: true }).fill(`Remitente ${suffix}`);
  await page.getByLabel("Número de identificación remitente").fill(`900${digits}`);
  await page.getByLabel("Dirección remitente").fill("Calle 10 # 20-30");
  await pickOption(page, "Ciudad remitente", "Bogota", /Bogota/i);
  await page.getByLabel("Teléfono remitente").fill("6015551234");
  await page.getByRole("combobox", { name: "Nombre del destinatario", exact: true }).fill(`Destinatario ${suffix}`);
  await page.getByLabel("Número de identificación destinatario", { exact: true }).fill(`901${digits}`);
  await page.getByLabel("Dirección destinatario").fill("Carrera 40 # 50-60");
  await pickOption(page, "Ciudad destinatario", "Medellin", /Medellin/i);
  await page.getByLabel("Teléfono destinatario").fill("6045559876");
  await pickOption(page, "Placa", "DEM001", /DEM001/);
  await page.getByLabel(/^Flete conductor/).fill("2500000");
  await page.getByLabel("Mercancía", { exact: true }).fill("Carga seca");
  await page.getByLabel("Peso (TN)").fill("12.5");
  await pickOption(page, "Tipo de empaque", "paquete", /paquete/i);
}

function documentCard(page: Page, title: string) {
  return page.locator(".document-hub-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

function formControl(page: Page, label: string) {
  const name = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: \\$)?$`);
  return page.getByRole("textbox", { name }).or(page.getByRole("combobox", { name })).or(page.getByRole("spinbutton", { name })).first();
}

function readPassword(): string {
  const source = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const match = /^DEMO_AUTH_PASSWORD=(.*)$/m.exec(source);
  if (!match) throw new Error("DEMO_AUTH_PASSWORD is not configured");
  return match[1].trim().replace(/^['\"]|['\"]$/g, "");
}
