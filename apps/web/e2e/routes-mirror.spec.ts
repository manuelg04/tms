import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { trackingBrowser } from "../testing/tracking-browser";
import { mirrorIntegration } from "../testing/mirror-integration";
test.use({ actionTimeout: 10000, navigationTimeout: 30000 });

test("migrate catalogue, copy route, assign schedule, query mirror and retain records after failure", async ({
  page,
  context,
}, info) => {
  test.setTimeout(150000);
  const fixture = await trackingBrowser(context),
    integration = await mirrorIntegration(fixture),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await context.route("**/api/rndc/mirror", async (route) => {
    try {
      const result = await integration.refresh(route.request().postDataJSON());
      await fixture.invalidate();
      await route.fulfill({ json: { ok: true, ...result } });
    } catch (error) {
      await route.fulfill({
        status: 502,
        json: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  });
  const point = {
    code: "74",
    name: "BARRANQUILLA",
    city: "BARRANQUILLA",
    cityCode: "8001000",
    controller: "Controlador de prueba",
    address: "Llamada al conductor",
    phone: "",
    virtual: true,
    active: true,
  };
  const catalogue = {
    version: 1,
    points: [point, { ...point, code: "10089" }],
    routes: [
      {
        code: "803",
        origin: "BARRANQUILLA",
        originCode: "8001000",
        destination: "GIRON",
        destinationCode: "68307000",
        via: "SAN ALBERTO",
        active: true,
        stops: [
          { key: "first", pointCode: "74", minutes: 40 },
          { key: "repeat", pointCode: "74", minutes: 80 },
          { key: "delivery", pointCode: "9999", minutes: 1700 },
        ],
      },
    ],
  };
  await mkdir("/tmp/tms-migration-qa", { recursive: true });
  try {
    await page.goto("/rutas");
    await expect(
      page.getByRole("heading", {
        name: "Rutas y puestos de control",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Archivo JSON del catálogo").setInputFiles({
      name: "catalogue.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(catalogue)),
    });
    await page
      .getByRole("button", { name: "Importar catálogo revisado" })
      .click();
    await expect(page.getByRole("status")).toContainText("3 guardados");
    await page.getByLabel("Archivo JSON del catálogo").setInputFiles({
      name: "catalogue.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(catalogue)),
    });
    await page
      .getByRole("button", { name: "Importar catálogo revisado" })
      .click();
    await expect(page.getByRole("status")).toContainText("3 sin cambios");
    await page
      .getByRole("tab", { name: "Puestos de control", exact: true })
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await page.getByRole("tab", { name: "Rutas", exact: true }).click();
    await page
      .getByRole("button", { name: "Copiar ruta", exact: true })
      .click();
    const editor = page.getByRole("region", { name: "Datos de la ruta" });
    await editor.getByLabel("Código de ruta", { exact: true }).fill("804");
    await editor.getByLabel("Vía", { exact: true }).fill("COPIA DE PRUEBA");
    await editor
      .getByRole("button", { name: "Guardar ruta", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Ruta guardada");
    await page.reload();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await page.screenshot({
      path: `/tmp/tms-migration-qa/${info.project.name}-catalogue.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await fixture.t.run(async (ctx) => {
      const dispatch = await ctx.db.get("trackingDispatches", fixture.ids[0]);
      await ctx.db.patch("trackingDispatches", fixture.ids[0], {
        summary: { ...dispatch!.summary, origin: "BARRANQUILLA" },
      });
    });
    await page.goto(`/control/seguimiento/${fixture.ids[0]}`);
    await expect(
      page.getByRole("heading", { name: "Despacho 70001", exact: true }),
    ).toBeVisible();
    const assignment = page.getByRole("region", {
      name: "Asignación del plan de ruta",
    });
    await assignment
      .getByLabel("Ruta", { exact: true })
      .selectOption({ label: "803 · BARRANQUILLA — GIRON VÍA SAN ALBERTO" });
    await assignment
      .getByLabel("Fecha y hora de salida")
      .fill("2026-09-29T22:30");
    await assignment
      .getByRole("button", { name: "Asignar plan de ruta", exact: true })
      .click();
    await expect(assignment.getByRole("status")).toContainText(
      "Plan de ruta asignado",
    );
    await page.reload();
    await expect(assignment).toContainText("2026-10-01 02:50");
    const persisted = await fixture.admin.query(fixture.api.tracking.detail, {
      dispatchId: fixture.ids[0],
    });
    expect(persisted.checkpoints).toHaveLength(3);
    expect(persisted.reports).toHaveLength(2);
    await page.screenshot({
      path: `/tmp/tms-migration-qa/${info.project.name}-plan.png`,
      fullPage: true,
    });
    await page.goto("/documentos/espejo");
    await expect(
      page.getByRole("heading", { name: "Espejo RNDC", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Ingreso RNDC desde").fill("2026-09-01");
    await page.getByLabel("Hasta", { exact: true }).fill("2026-09-29");
    await page
      .getByRole("button", { name: "Actualizar todos", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "4 registros consultados",
      { timeout: 60000 },
    );
    await page.getByRole("button", { name: "000044", exact: true }).click();
    const detail = page.getByRole("region", {
      name: "Detalle del documento RNDC",
    });
    await expect(detail).toContainText("Cumplidos de remesas");
    await expect(detail).toContainText("Cumplidos de manifiestos");
    await expect(
      detail.getByRole("link", { name: "Descargar evidencia de consulta" }),
    ).toBeVisible();
    await page.screenshot({
      path: `/tmp/tms-migration-qa/${info.project.name}-mirror.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await detail
      .getByLabel("Código de despacho", { exact: true })
      .fill("70004");
    await detail
      .getByRole("button", { name: "Abrir seguimiento de este manifiesto" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Despacho 70004", exact: true }),
    ).toBeVisible();
    const newPlan = page.getByRole("region", {
      name: "Asignación del plan de ruta",
    });
    await newPlan
      .getByLabel("Ruta", { exact: true })
      .selectOption({ label: "803 · BARRANQUILLA — GIRON VÍA SAN ALBERTO" });
    await newPlan.getByLabel("Fecha y hora de salida").fill("2026-09-29T08:00");
    await newPlan
      .getByRole("button", { name: "Asignar plan de ruta", exact: true })
      .click();
    await expect(newPlan.getByRole("status")).toContainText(
      "Plan de ruta asignado",
    );
    await expect(newPlan).toContainText("radicado 1004");
    await page.goto("/documentos/espejo");
    await page.getByLabel("Ingreso RNDC desde").fill("2026-09-01");
    await page.getByLabel("Hasta", { exact: true }).fill("2026-09-29");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "000044", exact: true }),
    ).toBeVisible();
    integration.fail();
    await page
      .getByRole("button", { name: "Consultar manifiestos", exact: true })
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "000044", exact: true }),
    ).toBeVisible();
    expect(
      integration.calls.every((c) => c.includes("&lt;tipo&gt;3&lt;/tipo&gt;")),
    ).toBe(true);
    expect(fixture.errors).toEqual([]);
    expect(errors.filter((e) => !e.includes("502"))).toEqual([]);
  } finally {
    await integration.close();
  }
});

test("auditor sees catalogue and mirror without mutation or synchronization controls", async ({
  page,
  context,
}) => {
  const fixture = await trackingBrowser(context, "auditor");
  await page.goto("/rutas");
  await expect(
    page.getByRole("heading", {
      name: "Rutas y puestos de control",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Insertar/ })).toHaveCount(0);
  await expect(page.getByLabel("Archivo JSON del catálogo")).toHaveCount(0);
  await page.goto("/documentos/espejo");
  await expect(
    page.getByRole("heading", { name: "Espejo RNDC", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Actualizar todos" }),
  ).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
