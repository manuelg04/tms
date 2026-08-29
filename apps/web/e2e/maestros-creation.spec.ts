import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const password = readPassword();

const resources = [
  {
    label: "conductor",
    path: "/maestros/nuevo/conductor",
    sections: ["Identidad", "Licencia de conducción", "Seguridad social", "Referencia laboral"]
  },
  {
    label: "tercero",
    path: "/maestros/nuevo/tercero",
    sections: ["Tipo de tercero", "Identidad", "Actividades"]
  },
  {
    label: "remolque",
    path: "/maestros/nuevo/remolque",
    sections: ["Identificación", "Datos técnicos", "Propiedad"]
  },
  {
    label: "vehículo",
    path: "/maestros/nuevo/vehiculo",
    sections: ["Identificación", "Datos técnicos", "Seguros", "Personas"]
  }
] as const;

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("Maestros exposes dedicated creation links for all four resources", async ({ page }) => {
  await page.goto("/maestros");

  for (const resource of resources) {
    const link = page.getByRole("link", { name: `Registrar ${resource.label}`, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", resource.path);
  }
});

for (const resource of resources) {
  test(`${resource.label} creation workspace exposes its business sections and a local save action`, async ({ page }) => {
    await page.goto(resource.path);

    await expect(page).toHaveURL(new RegExp(`${resource.path}$`));
    await expect(page.getByRole("heading", { name: new RegExp(`Registrar ${resource.label}`, "i") })).toBeVisible();

    for (const section of resource.sections) {
      await expect(page.getByRole("group", { name: section, exact: true })).toBeVisible();
    }

    const save = page.locator("form button[type='submit']");
    await expect(save).toHaveCount(1);
    await expect(save).toContainText(/guardar/i);
    await expect(save).not.toContainText(/RNDC/i);
  });
}

test("third-party identity follows the selected person type", async ({ page }) => {
  await page.goto("/maestros/nuevo/tercero");

  await expect(page.getByRole("textbox", { name: "Nombres", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Razón social", exact: true })).toHaveCount(0);

  await page.getByRole("radio", { name: /Persona jurídica/ }).check();

  await expect(page.getByRole("textbox", { name: "Razón social", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "DV", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Nombres", exact: true })).toHaveCount(0);
});

test("vehicle only asks for a default trailer when it can pull one", async ({ page }) => {
  await page.goto("/maestros/nuevo/vehiculo");

  await expect(page.getByText("Remolque habitual", { exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Tipo de vehículo", exact: true }).selectOption("cabezote");
  await expect(page.getByText("Remolque habitual", { exact: true })).toBeVisible();
});

test("vehicle captures the official RNDC codes needed for a later registration", async ({ page }) => {
  await page.goto("/maestros/nuevo/vehiculo");

  await expect(page.getByRole("combobox", { name: "Configuración RNDC", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Combustible RNDC", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Código de color RNDC", exact: true })).toHaveAttribute("pattern", "[0-9]{1,5}");
});

for (const path of ["/maestros/nuevo/conductor", "/maestros/nuevo/vehiculo"]) {
  test(`${path} allows adding and removing work references`, async ({ page }) => {
    await page.goto(path);

    await expect(page.getByRole("group", { name: "Referencia laboral 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Agregar referencia", exact: true }).click();
    await expect(page.getByRole("group", { name: "Referencia laboral 2", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Quitar referencia 2", exact: true }).click();
    await expect(page.getByRole("group", { name: "Referencia laboral 2", exact: true })).toHaveCount(0);
  });
}

test("all four creation workspaces fit a mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const resource of resources) {
    await page.goto(resource.path);
    await expect(page.getByRole("heading", { name: new RegExp(`Registrar ${resource.label}`, "i") })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), resource.path).toBe(true);
  }
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
