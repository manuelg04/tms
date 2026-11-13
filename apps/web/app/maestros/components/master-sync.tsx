"use client";

import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { MASTER_SYNC_STATE_LABELS, type MasterSyncKind, type MasterSyncState } from "../../../convex/model/masterSync";

export type MasterSyncSummaryView = { state: MasterSyncState; updatedAt?: number; error?: string };

export type MasterSyncOutcome = { ok: boolean; state: "registered" | "rejected" | "uncertain"; message: string };

export async function requestMasterSync(kind: MasterSyncKind, key: string, force = false): Promise<MasterSyncOutcome> {
  try {
    const response = await fetch("/api/rndc/masters/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, key, force })
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; state?: string; label?: string; error?: string; skipped?: boolean };
    const label = result.label ?? key;
    if (response.ok && result.state === "registered") {
      return { ok: true, state: "registered", message: result.skipped ? `${label} ya estaba registrado en el RNDC.` : `${label} quedó registrado en el RNDC.` };
    }
    if (response.status === 202 || result.state === "uncertain") {
      return { ok: false, state: "uncertain", message: `${label}: ${result.error ?? "el RNDC no confirmó el registro; se reintentará al transmitir el despacho."}` };
    }
    return { ok: false, state: "rejected", message: `${label}: ${result.error ?? "el RNDC rechazó el registro."}` };
  } catch (error) {
    return { ok: false, state: "uncertain", message: error instanceof Error ? error.message : "No fue posible contactar el servicio RNDC." };
  }
}

export function MasterSyncBadge({ summary }: { summary: MasterSyncSummaryView | undefined }) {
  if (!summary) return <span className="sync-badge pending">—</span>;
  return <span className={`sync-badge ${summary.state}`} title={summary.error ?? undefined}>{MASTER_SYNC_STATE_LABELS[summary.state]}</span>;
}

export function MasterSyncAction({ kind, keyValue, summary, onDone, compact }: { kind: MasterSyncKind; keyValue: string; summary: MasterSyncSummaryView | undefined; onDone?: (outcome: MasterSyncOutcome) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const label = summary?.state === "registered" ? "Reenviar al RNDC" : summary?.state === "rejected" ? "Reintentar registro RNDC" : "Registrar en RNDC";
  async function run(event: React.MouseEvent) {
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const outcome = await requestMasterSync(kind, keyValue, summary?.state === "registered");
      onDone?.(outcome);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className={compact ? "text-button" : "ghost-button"} disabled={busy} onClick={run} type="button">
      {busy ? "Enviando…" : compact && summary?.state === "registered" ? "Reenviar" : label}
    </button>
  );
}

export type OwnershipPick = { _id: Id<"thirdParties">; document: string; documentType: string; name: string; phone?: string; cityCode?: string };

export type OwnershipSyncOutcome = { ok: boolean; message: string; owner?: OwnershipPick; possessor?: OwnershipPick; syncedAt?: number; vehicleUpdated?: boolean };

export function formatOwnershipSync(value: number | undefined): string | undefined {
  return value ? new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }) : undefined;
}

export async function requestOwnershipSync(plate: string): Promise<OwnershipSyncOutcome> {
  const cleanPlate = plate.trim().toUpperCase();
  if (!/^[A-Z0-9]{5,7}$/.test(cleanPlate)) return { ok: false, message: "Escribe primero la placa del vehículo." };
  try {
    const response = await fetch("/api/rndc/masters/ownership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plate: cleanPlate })
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; owner?: OwnershipPick; possessor?: OwnershipPick; syncedAt?: number; vehicleUpdated?: boolean };
    if (response.ok && result.ok) {
      const names = [result.owner ? `propietario ${result.owner.name}` : null, result.possessor ? `poseedor ${result.possessor.name}` : null].filter(Boolean).join(" y ");
      return { ok: true, message: `${cleanPlate}: el RNDC devolvió ${names}.`, owner: result.owner, possessor: result.possessor, syncedAt: result.syncedAt, vehicleUpdated: result.vehicleUpdated };
    }
    return { ok: false, message: `${cleanPlate}: ${result.error ?? "no se pudo consultar el RNDC."}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No fue posible contactar el servicio RNDC." };
  }
}

export function OwnershipSyncAction({ plate, onDone, label = "Sincronizar con RNDC" }: { plate: string | (() => string); onDone?: (outcome: OwnershipSyncOutcome) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  async function run(event: React.MouseEvent) {
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      onDone?.(await requestOwnershipSync(typeof plate === "function" ? plate() : plate));
    } finally {
      setBusy(false);
    }
  }
  return <button className="ghost-button" disabled={busy} onClick={run} type="button">{busy ? "Consultando el RNDC…" : label}</button>;
}
