import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import {
  dispatchFiltersFromSearchParams,
  type DispatchFilters
} from "../../../../convex/model/dispatchSearch";
import { canPerform, type DemoUser } from "../../../lib/auth";
import { createConvexToken, getAuthSettings, jsonResponse, readRequestSession } from "../../../lib/auth-server";
import {
  buildExportRows,
  type DispatchExportRecord,
  type ExportKind
} from "../../../lib/exportSchemas";
import { createExportWorkbook } from "../../../lib/exportWorkbook";

const exportKinds = new Set<ExportKind>(["dispatches", "orders", "consignments", "manifests"]);

export async function GET(request: Request): Promise<Response> {
  return await handleDispatchExport(request, loadRecords);
}

export async function handleDispatchExport(
  request: Request,
  loader: (filters: DispatchFilters, user: DemoUser) => Promise<DispatchExportRecord[]>
): Promise<Response> {
  let settings;

  try {
    settings = getAuthSettings();
  } catch {
    return jsonResponse({ error: "La exportación no está configurada." }, 503);
  }

  const user = readRequestSession(request, settings);

  if (!user) {
    return jsonResponse({ error: "Debes iniciar sesión para exportar." }, 401);
  }

  if (!canPerform(user.role, "view_expediente")) {
    return jsonResponse({ error: "No tienes permiso para exportar despachos." }, 403);
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "dispatches";

  if (!exportKinds.has(kind as ExportKind)) {
    return jsonResponse({ error: "El tipo de exportación no es válido." }, 400);
  }

  try {
    const filters = dispatchFiltersFromSearchParams(url.searchParams);
    const records = await loader(filters, user);
    const rows = buildExportRows(kind as ExportKind, records, user.role);
    const workbook = await createExportWorkbook(exportLabel(kind as ExportKind), rows);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
    const body = Uint8Array.from(workbook);
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="mtm-${kind}-${date}.xlsx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "No se pudo generar la exportación." }, 500);
  }
}

async function loadRecords(filters: DispatchFilters, user: DemoUser): Promise<DispatchExportRecord[]> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;

  if (!convexUrl) {
    throw new Error("El almacenamiento de despachos no está configurado.");
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(createConvexToken(user, getAuthSettings()));
  const records: DispatchExportRecord[] = [];
  let cursor: string | null = null;
  let done = false;

  while (!done) {
    const page: { page: unknown[]; continueCursor: string; isDone: boolean } = await client.query(api.dispatchSearch.exportPage, {
      paginationOpts: { cursor, numItems: 200 },
      filters
    });
    records.push(...page.page as DispatchExportRecord[]);
    cursor = page.continueCursor;
    done = page.isDone;

    if (records.length > 100_000) {
      throw new Error("La exportación supera 100.000 despachos. Reduce el rango de fechas.");
    }
  }

  return records;
}

function exportLabel(kind: ExportKind): string {
  return {
    dispatches: "Despachos",
    orders: "Órdenes de cargue",
    consignments: "Remesas",
    manifests: "Manifiestos"
  }[kind];
}
