import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import ExcelJS from "exceljs";
import { trackingBrowser } from "../testing/tracking-browser";

test.use({ actionTimeout: 10_000, navigationTimeout: 30_000 });

test("tracking lists, checkpoint reports, historical map, and visual alarms", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await trackingBrowser(context);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto("/control/seguimiento");
  await expect(
    page.getByRole("heading", { name: "Seguimiento", exact: true }),
  ).toBeVisible();
  const filters = page.getByRole("region", {
    name: "Filtros de búsqueda",
    exact: true,
  });
  await expect(filters.locator("input")).toHaveCount(17);
  const route = page.getByRole("region", {
    name: "Despachos en ruta",
    exact: true,
  });
  await expect(route.getByRole("link")).toHaveCount(2);
  await expect(route.getByRole("link").first()).toHaveText("70002");
  await page.getByRole("button", { name: /Pendientes por llegada/ }).click();
  const pending = page.getByRole("region", {
    name: "Pendientes por llegada",
    exact: true,
  });
  await expect(pending.getByRole("link")).toHaveCount(1);
  await filters.getByLabel("Origen", { exact: true }).fill("santa");
  await expect(route.getByRole("link")).toHaveCount(1);
  await expect(pending.getByRole("link")).toHaveCount(1);
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await route.getByRole("searchbox").fill("no-match");
  await expect(
    route.getByText("No se hallan filas que coincidan con el criterio"),
  ).toBeVisible();
  await expect(pending.getByRole("link")).toHaveCount(1);
  await route.getByRole("searchbox").fill("70001");
  const downloadPromise = page.waitForEvent("download");
  await route.getByRole("button", { name: "Excel" }).click();
  const download = await downloadPromise;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  expect(workbook.worksheets[0].rowCount).toBe(2);
  expect(workbook.worksheets[0].getCell(2, 4).value).toBe("000001");
  await route.getByRole("searchbox").fill("");
  await mkdir("/tmp/tms-tracking-qa", { recursive: true });
  await page.screenshot({
    path: `/tmp/tms-tracking-qa/${testInfo.project.name}-board.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await route.getByRole("link", { name: "70001", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Despacho 70001", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "CIENAGA", exact: true }),
  ).toHaveCount(2);
  const plan = page.getByRole("region", { name: "Plan de ruta", exact: true });
  await expect(plan.getByText("REPORTE GPS", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Interfaz GPS", exact: true }).click();
  await expect(plan.getByText("REPORTE GPS", { exact: true })).toHaveCount(0);
  await expect(page.getByText("1 notas", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Todas", exact: true }).click();
  await page
    .getByRole("button", { name: "FUNDACION (Virtual)", exact: true })
    .click();
  const form = page.getByRole("region", { name: "FUNDACION", exact: true });
  await expect(form.getByLabel("Sitio", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await form.getByLabel("Novedad", { exact: true }).fill("Comentario");
  await form.getByRole("option", { name: /COMENTARIO/i }).click();
  await expect(form.getByLabel("Sitio", { exact: true })).toBeEditable();
  await expect(form.getByLabel("Sitio", { exact: true })).toHaveValue("");
  await expect(form.getByLabel("Tiempo Fecha", { exact: true })).toHaveCount(0);
  await form.getByLabel("Observación", { exact: true }).fill("x".repeat(500));
  await expect(
    form.getByText("Queda(n) 0 Caracter(es) para Escribir", { exact: true }),
  ).toBeVisible();
  await form.getByRole("button", { name: "Borrar", exact: true }).click();
  await expect(form.getByLabel("Observación", { exact: true })).toHaveValue("");
  await form.getByLabel("Novedad", { exact: true }).fill("Retrasado");
  await form.getByRole("option", { name: /RETRASADO/i }).click();
  await form.getByLabel("Tiempo Fecha", { exact: true }).fill("2026-09-05");
  await form.getByLabel("Tiempo Hora", { exact: true }).fill("07:30");
  await form.getByLabel("Sitio", { exact: true }).fill("cienaga");
  await expect(
    form
      .getByRole("listbox", { name: "Sitio", exact: true })
      .getByRole("option"),
  ).toHaveCount(3);
  await form
    .getByRole("listbox", { name: "Sitio", exact: true })
    .getByRole("option")
    .first()
    .click();
  await form
    .getByLabel("Observación", { exact: true })
    .fill("Prueba de seguimiento guardado");
  await page.screenshot({
    path: `/tmp/tms-tracking-qa/${testInfo.project.name}-form.png`,
    fullPage: true,
  });
  await form.getByRole("button", { name: "Aceptar", exact: true }).click();
  await expect(
    page.getByText("Seguimiento registrado.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("2 notas", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Prueba de seguimiento guardado", { exact: true }),
  ).toBeVisible();
  const canvas = page.getByRole("region", {
    name: "Recorrido histórico del vehículo",
    exact: true,
  });
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas.locator("canvas")).toBeVisible();
  const bounds = (await canvas.boundingBox())!;
  await canvas.click({
    position: { x: bounds.width / 2, y: bounds.height / 2 },
  });
  await expect(
    page.getByText("Ubicación: Pereira, Risaralda", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/tms-tracking-qa/${testInfo.project.name}-map.png`,
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Cerrar detalle de posición" })
    .click();
  await page
    .getByRole("button", { name: "Lugar Entrega", exact: true })
    .click();
  const delivery = page.getByRole("region", {
    name: "Lugar Entrega",
    exact: true,
  });
  await expect(delivery.getByLabel("Antes/Sitio")).toHaveValue("S");
  await expect(
    delivery.getByLabel("Antes/Sitio").locator("option"),
  ).toHaveCount(1);
  await expect(delivery.getByLabel("Sitio", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await delivery.getByLabel("Novedad", { exact: true }).fill("Ok");
  await delivery.getByRole("option", { name: /^2-OK/ }).click();
  await delivery.getByRole("button", { name: "Aceptar", exact: true }).click();
  await expect(
    page.getByText("Pendiente por llegada", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "← Seguimiento", exact: true }).click();
  await page
    .locator(".tracking-heading")
    .getByRole("link", { name: "Alertas visuales", exact: true })
    .click();
  await expect(page.getByText("5 registros", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Insertar alarma", exact: true })
    .click();
  await page.getByText("Elegir color", { exact: true }).click();
  await expect(page.locator(".alarm-palette button")).toHaveCount(216);
  await page.getByRole("button", { name: "Color FF0000", exact: true }).click();
  await expect(page.getByLabel("Color", { exact: true })).toHaveValue("FF0000");
  await expect(page.locator(".alarm-palette")).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Borrar", exact: true }).click();
  await expect(page.getByLabel("Color", { exact: true })).toHaveValue("");
  await page.getByLabel("Nombre", { exact: true }).fill("Prueba");
  await page.getByLabel("Tiempo de Alarma", { exact: true }).fill("10");
  await page.getByLabel("Color", { exact: true }).fill("33FF99");
  await page.getByRole("button", { name: "Aceptar", exact: true }).click();
  await expect(page.getByText("6 registros", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Actualizar Prueba", exact: true })
    .click();
  await page.getByLabel("Nombre", { exact: true }).fill("Temporal");
  await page.getByRole("button", { name: "Borrar", exact: true }).click();
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(
    "Prueba",
  );
  await page.getByLabel("Tiempo de Alarma", { exact: true }).fill("15");
  await page.getByRole("button", { name: "Aceptar", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("row").filter({ hasText: "Prueba" }),
  ).toContainText("15 Min");
  await page.getByRole("link", { name: "← Seguimiento", exact: true }).click();
  await expect(
    page.getByText("Prueba = 15 Min", { exact: true }),
  ).toBeVisible();
  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
    await page
      .getByRole("complementary", { name: "Navegacion principal" })
      .getByRole("link", { name: "Alertas visuales", exact: true })
      .click();
  } else
    await page
      .locator(".tracking-heading")
      .getByRole("link", { name: "Alertas visuales", exact: true })
      .click();
  await expect(page.getByText("6 registros", { exact: true })).toBeVisible();
  await expect(page.locator(".mobile-nav-trigger")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.screenshot({
    path: `/tmp/tms-tracking-qa/${testInfo.project.name}-alarms.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Eliminar Prueba", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(page.getByText("6 registros", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Eliminar Prueba", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Eliminar", exact: true })
    .click();
  await expect(page.getByText("5 registros", { exact: true })).toBeVisible();
  expect(
    (await fixture.admin.query(fixture.api.tracking.alarms, {})).alarms.some(
      (alarm) => alarm.name === "Prueba",
    ),
  ).toBe(false);
  expect(
    fixture.mutations.filter((name) => name === "tracking:reportCheckpoint"),
  ).toHaveLength(2);
  expect(fixture.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("auditors can inspect tracking and alarms without editing", async ({
  page,
  context,
}) => {
  const fixture = await trackingBrowser(context, "auditor");
  await page.goto("/control/seguimiento");
  await page.getByRole("link", { name: "70001", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lugar Entrega", exact: true }),
  ).toBeDisabled();
  await page.goto("/configuracion/alertas-visuales");
  await expect(page.getByText("5 registros", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Insertar alarma", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Actualizar/ })).toHaveCount(
    0,
  );
  expect(fixture.errors).toEqual([]);
  expect(fixture.mutations).toEqual([]);
});
