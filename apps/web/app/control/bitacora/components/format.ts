"use client";

import { useEffect, useState } from "react";

const TZ = "America/Bogota";
const dateFmt = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const longFmt = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export function formatDate(ms: number): string {
  return dateFmt.format(ms).replace(/\./g, "");
}
export function formatTime(ms: number): string {
  return timeFmt.format(ms);
}
export function formatDateTime(ms: number): string {
  return `${formatDate(ms)} · ${formatTime(ms)}`;
}
export function formatLongDate(ms: number): string {
  const text = longFmt.format(ms);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export function dayKey(ms: number): string {
  return dayKeyFmt.format(ms);
}
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours >= 48) return `${Math.floor(hours / 24)} d ${hours % 24} h`;
  if (hours === 0) return `${minutes} min`;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}
export function relativePast(ms: number, now: number): string {
  const diff = now - ms;
  if (diff < 60000) return "hace un momento";
  return `hace ${formatDuration(diff)}`;
}
export function relativeDue(ms: number, now: number): { label: string; state: "ok" | "soon" | "late" } {
  const diff = ms - now;
  if (diff < 0) return { label: `Vencido ${relativePast(ms, now)}`, state: "late" };
  if (diff < 30 * 60000) return { label: `En ${formatDuration(diff)}`, state: "soon" };
  return { label: `En ${formatDuration(diff)}`, state: "ok" };
}
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
export function formatWeight(kg: number): string {
  return `${new Intl.NumberFormat("es-CO").format(kg)} kg`;
}
export const channelLabels: Record<string, string> = {
  llamada: "Llamada telefónica",
  whatsapp: "WhatsApp",
  presencial: "Presencial",
  otro: "Otro medio",
};
export const kindLabels: Record<string, string> = {
  inicio: "Inicio de viaje",
  control: "Reporte de control",
  novedad: "Novedad",
  entrega_parcial: "Entrega parcial",
  entrega: "Entrega final",
};
