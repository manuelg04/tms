import Link from "next/link";
import { fulfillmentHref, moduleHref, tripHref, type ModuleSlug } from "../../lib/module-links";
import { StatusBadge } from "../status-badge";
import type { DocumentHubItem } from "./document-hub";

const slugByKey: Record<string, ModuleSlug | undefined> = {
  order: "ordenes",
  consignments: "remesas",
  manifest: "manifiestos",
};

export type TripDocumentLink = {
  key: string;
  title: string;
  number?: string;
  state: string;
  href: string;
  exists: boolean;
};

export function tripDocumentLinks(items: DocumentHubItem[], expedienteId: string, remesaCount: number): TripDocumentLink[] {
  return items.flatMap((item) => {
    if (item.key === "assignment") return [];
    const slug = slugByKey[item.key];
    const exists = item.key === "consignments" ? remesaCount > 0 : item.key === "fulfillment" ? true : Boolean(item.number);
    const href = slug
      ? moduleHref(slug, exists ? (item.canEdit ? "actualizar" : "listar") : "insertar", { viaje: expedienteId })
      : fulfillmentHref(expedienteId);
    return [{ key: item.key, title: item.title, number: item.number, state: item.state, href, exists }];
  });
}

export function nextTripStep(items: DocumentHubItem[], expedienteId: string, remesaCount: number): { label: string; href: string } | null {
  const official = (key: string) => {
    const item = items.find((candidate) => candidate.key === key);
    return item ? item.state === "authorized" || item.state === "fulfilled" : false;
  };
  const annulled = (key: string) => items.find((candidate) => candidate.key === key)?.state === "annulled";
  if (annulled("manifest") && annulled("order")) return null;
  if (!official("order")) return { label: "Terminar la orden de cargue", href: moduleHref("ordenes", "actualizar", { viaje: expedienteId }) };
  if (!official("consignments")) return { label: remesaCount > 0 ? "Terminar la remesa" : "Crear la remesa", href: moduleHref("remesas", remesaCount > 0 ? "actualizar" : "insertar", { viaje: expedienteId }) };
  if (!official("manifest")) {
    const manifest = items.find((candidate) => candidate.key === "manifest");
    return { label: manifest?.number ? "Terminar el manifiesto" : "Crear el manifiesto", href: moduleHref("manifiestos", manifest?.number ? "actualizar" : "insertar", { viaje: expedienteId }) };
  }
  if (items.find((candidate) => candidate.key === "fulfillment")?.state !== "fulfilled") return { label: "Registrar los cumplidos", href: fulfillmentHref(expedienteId) };
  return null;
}

export function TripDocumentStrip({ items, expedienteId, remesaCount, current, code }: { items: DocumentHubItem[]; expedienteId: string; remesaCount: number; current?: string; code: string }) {
  const links = tripDocumentLinks(items, expedienteId, remesaCount);
  return (
    <nav className="trip-strip" aria-label="Documentos de este viaje">
      <span className="trip-strip-label">Documentos de este viaje</span>
      <ol>
        {links.map((link) => (
          <li key={link.key}>
            <Link aria-current={link.key === current ? "true" : undefined} className={link.key === current ? "current" : ""} href={link.href}>
              <span className="trip-strip-title">{link.title}</span>
              <strong>{link.exists ? link.number ?? "Sin número" : "Sin crear"}</strong>
              {!link.exists ? <em>Crear</em> : link.key === "fulfillment" && link.state === "draft" ? null : <StatusBadge internal={link.key === "order"} status={link.state} />}
            </Link>
          </li>
        ))}
      </ol>
      <Link className="trip-strip-open" href={tripHref(expedienteId)}>Ver viaje {code}</Link>
    </nav>
  );
}
