import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const password = readPassword();

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("vehicle master shows kind, status and SOAT from the RNDC maestro", async ({ page }) => {
  await page.goto("/maestros");
  await page.getByRole("button", { name: "Vehiculos" }).click();
  await page.getByPlaceholder("Filtrar por placa").fill("KZL702");

  const row = page.locator(".master-desktop-table tr, .master-mobile-card").filter({ hasText: "KZL702" }).filter({ visible: true }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText("Cabezote · 3S");
  await expect(row).toContainText(/Activo · SOAT \d{4}-\d{2}-\d{2}/);

  await row.click();
  const detail = page.locator("section.panel", { hasText: "Conductores asociados" });
  await expect(detail.getByText("3S - Tractocamión de 3 ejes")).toBeVisible();
  await expect(detail.getByText(/SEGUROS DEL ESTADO/)).toBeVisible();
  await expect(detail.getByText("Registrado en RNDC")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { email: "operador@mtm.local", password }
  });
  expect(response.ok()).toBe(true);
}

function readPassword(): string {
  const source = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const match = /^DEMO_AUTH_PASSWORD=(.*)$/m.exec(source);
  if (!match) throw new Error("DEMO_AUTH_PASSWORD is not configured");
  return match[1].trim().replace(/^['\"]|['\"]$/g, "");
}
