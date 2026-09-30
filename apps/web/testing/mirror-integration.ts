import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ConvexHttpClient } from "convex/browser";
import { createRndcApp } from "../../rndc-api/dist/index.js";
import { syncRndcMirror } from "../app/lib/rndc-mirror-sync";
import type { trackingFixture } from "./tracking-fixtures";

export async function mirrorIntegration(
  fixture: Awaited<ReturnType<typeof trackingFixture>>,
) {
  const calls: string[] = [];
  let failing = false;
  const soap = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += String(part);
    calls.push(body);
    const processId = Number(
      /&lt;procesoid&gt;(\d+)&lt;\/procesoid&gt;/.exec(body)?.[1],
    );
    res.setHeader("Content-Type", "text/xml");
    if (failing) {
      res.statusCode = 503;
      res.end("unavailable");
      return;
    }
    if ([9, 32, 28, 29].includes(processId)) {
      res.end(
        `<root><ErrorMSG>Error RNDC11: Documento no encontrado. Tipo:3 Proceso:${processId}</ErrorMSG></root>`,
      );
      return;
    }
    const record = {
      INGRESOID: String(1000 + processId),
      FECHAING: "29/09/2026 11:00:00 a. m.",
      NUMMANIFIESTOCARGA: processId === 4 ? "000044" : "44",
      ...(processId === 3 || processId === 5
        ? { CONSECUTIVOREMESA: "55" }
        : {}),
      ...(processId === 4 || processId === 3 ? { NUMPLACA: "TST001" } : {}),
      ...(processId === 4
        ? {
            FECHAEXPEDICIONMANIFIESTO: "29/09/2026",
            CODMUNICIPIOORIGENMANIFIESTO: "8001000",
            CODMUNICIPIODESTINOMANIFIESTO: "68307000",
            VALORFLETEPACTADOVIAJE: "5440000",
          }
        : {}),
    };
    res.end(
      `<root><documento>${Object.entries(record)
        .map(([key, value]) => `<${key}>${value}</${key}>`)
        .join("")}</documento></root>`,
    );
  });
  await new Promise<void>((resolve) => soap.listen(0, "127.0.0.1", resolve));
  const previous = {
    AUTH_MODE: process.env.AUTH_MODE,
    RNDC_SERVICE_TOKEN: process.env.RNDC_SERVICE_TOKEN,
    RNDC_MIRROR_ENABLED: process.env.RNDC_MIRROR_ENABLED,
    RNDC_MIRROR_ORGANIZATION_ID: process.env.RNDC_MIRROR_ORGANIZATION_ID,
    RNDC_INGEST_KEY: process.env.RNDC_INGEST_KEY,
  };
  process.env.AUTH_MODE = "demo";
  process.env.RNDC_SERVICE_TOKEN =
    "isolated-mirror-service-token-more-than-32-chars";
  process.env.RNDC_MIRROR_ENABLED = "true";
  process.env.RNDC_MIRROR_ORGANIZATION_ID = fixture.organizationId;
  process.env.RNDC_INGEST_KEY = "isolated-mirror-ingest";
  const app = createRndcApp(
    {
      mode: "dry-run",
      username: "isolated-user",
      password: "isolated-password",
      companyRndcNit: "9000000011",
      endpointUrlOverride: `http://127.0.0.1:${(soap.address() as AddressInfo).port}`,
      outputDir: await mkdtemp(join(tmpdir(), "tms-mirror-e2e-")),
    },
    { logger: () => undefined },
  );
  const backend = await new Promise<ReturnType<typeof app.listen>>(
    (resolve) => {
      const server = app.listen(0, "127.0.0.1", () => resolve(server));
    },
  );
  const forward = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${process.env.RNDC_SERVICE_TOKEN}`);
    headers.set("X-TMS-Expected-Mode", "dry-run");
    return await fetch(
      `http://127.0.0.1:${(backend.address() as AddressInfo).port}${path}`,
      { ...init, headers },
    );
  };
  const client = {
    query: fixture.admin.query,
    mutation: fixture.admin.mutation,
  } as unknown as Pick<ConvexHttpClient, "query" | "mutation">;
  const upload: typeof fetch = async (_url, init) => {
    const storageId = await fixture.t.run((ctx) =>
      ctx.storage.store(
        new Blob([String(init?.body)], { type: "application/json" }),
      ),
    );
    return new Response(JSON.stringify({ storageId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return {
    calls,
    fail: () => {
      failing = true;
    },
    refresh: (input: { process: number; from: string; to: string }) =>
      syncRndcMirror(client, "isolated-mirror-ingest", input, forward, upload),
    close: async () => {
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      await new Promise<void>((resolve) => soap.close(() => resolve()));
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
