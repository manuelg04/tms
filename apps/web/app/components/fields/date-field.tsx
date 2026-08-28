"use client";

import { useEffect, useId, useRef, useState } from "react";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function splitDateTime(value: string | undefined): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const [date, time = ""] = value.split("T");
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "", time: time.slice(0, 5) };
}

export function formatDateLabel(date: string, time?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return "";
  const label = `${Number(match[3])} ${MONTHS_SHORT[Number(match[2]) - 1]} ${match[1]}`;
  return time ? `${label} · ${time}` : label;
}

function monthGrid(year: number, month: number): Array<string | null> {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= days; day++) cells.push(isoDate(new Date(year, month, day)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function DateField({ className = "", label, name, value, withTime, required, min, onChange }: { className?: string; label: string; name: string; value?: string; withTime?: boolean; required?: boolean; min?: string; onChange?: (value: string) => void }) {
  const id = useId();
  const initial = splitDateTime(value);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time || (withTime ? "08:00" : ""));
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const today = isoDate(new Date());
  const anchor = date || today;
  const [view, setView] = useState({ year: Number(anchor.slice(0, 4)), month: Number(anchor.slice(5, 7)) - 1 });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const serialized = date ? (withTime ? `${date}T${time || "00:00"}` : date) : "";

  function commit(nextDate: string, nextTime: string) {
    setDate(nextDate);
    setTime(nextTime);
    onChange?.(nextDate ? (withTime ? `${nextDate}T${nextTime || "00:00"}` : nextDate) : "");
  }

  function pick(day: string) {
    commit(day, time || "08:00");
    if (!withTime) setOpen(false);
  }

  function shift(delta: number) {
    setView((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  function quick(daysAhead: number) {
    const target = new Date();
    target.setDate(target.getDate() + daysAhead);
    const day = isoDate(target);
    setView({ year: target.getFullYear(), month: target.getMonth() });
    pick(day);
  }

  const cells = monthGrid(view.year, view.month);
  const [hour = "08", minute = "00"] = (time || "08:00").split(":");

  return (
    <div className={`form-field date-field ${className}`} ref={rootRef}>
      <span id={`${id}-label`}>{label}{required ? <em aria-hidden="true"> *</em> : null}</span>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={`${id}-label`}
        className={`date-field-trigger ${date ? "" : "empty"}`}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setFlip(window.innerHeight - rect.bottom < 420 && rect.top > 420);
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span>{date ? formatDateLabel(date, withTime ? time : undefined) : withTime ? "Elegir fecha y hora" : "Elegir fecha"}</span>
        <em aria-hidden="true">▾</em>
      </button>
      <input name={name} type="hidden" value={serialized} />
      {open ? (
        <div className={`date-popover ${flip ? "flip" : ""}`} role="dialog">
          <div className="date-popover-head">
            <button aria-label="Mes anterior" onClick={() => shift(-1)} type="button">‹</button>
            <strong>{MONTHS[view.month]} {view.year}</strong>
            <button aria-label="Mes siguiente" onClick={() => shift(1)} type="button">›</button>
          </div>
          <div className="date-grid" role="grid">
            {WEEKDAYS.map((weekday, index) => <span className="date-weekday" key={`${weekday}-${index}`}>{weekday}</span>)}
            {cells.map((day, index) => day ? (
              <button
                aria-pressed={day === date}
                className={`date-day ${day === date ? "selected" : ""} ${day === today ? "today" : ""}`}
                disabled={Boolean(min && day < min)}
                key={day}
                onClick={() => pick(day)}
                type="button"
              >{Number(day.slice(8, 10))}</button>
            ) : <span key={`empty-${index}`} />)}
          </div>
          {withTime ? (
            <div className="date-time-row">
              <span>Hora</span>
              <select aria-label="Hora" onChange={(event) => commit(date || today, `${event.target.value}:${minute}`)} value={hour}>{HOURS.map((option) => <option key={option} value={option}>{option}</option>)}</select>
              <b>:</b>
              <select aria-label="Minutos" onChange={(event) => commit(date || today, `${hour}:${event.target.value}`)} value={MINUTES.includes(minute) ? minute : minute}>{(MINUTES.includes(minute) ? MINUTES : [minute, ...MINUTES]).map((option) => <option key={option} value={option}>{option}</option>)}</select>
            </div>
          ) : null}
          <div className="date-popover-foot">
            <button onClick={() => quick(0)} type="button">Hoy</button>
            <button onClick={() => quick(1)} type="button">Mañana</button>
            <button className="muted" onClick={() => { commit("", withTime ? "08:00" : ""); setOpen(false); }} type="button">Limpiar</button>
            {withTime ? <button className="primary" onClick={() => setOpen(false)} type="button">Listo</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
