"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { SearchSelect } from "../../../components/fields/search-select";

export type PlacePick = { name: string; code?: string };

const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").trim();

export function PlaceField({ label, name, required, routeStops, value, onSelect, onClear, hint }: { label: string; name: string; required?: boolean; routeStops: string[]; value: PlacePick | null; onSelect: (place: PlacePick) => void; onClear: () => void; hint?: string }) {
  const [term, setTerm] = useState("");
  const results = useQuery(api.lookups.divisionsSearch, term.trim().length >= 2 ? { term } : "skip");
  const options = useMemo(() => {
    const needle = norm(term);
    const stops = routeStops
      .filter((stop, index, all) => all.indexOf(stop) === index)
      .filter((stop) => !needle || norm(stop).includes(needle))
      .map((stop, index) => ({ key: `stop:${stop}`, title: stop.split(",")[0].trim(), subtitle: stop.includes(",") ? stop.split(",").slice(1).join(",").trim() : undefined, badge: `Ruta · ${index + 1}` }));
    const stopKeys = new Set(routeStops.map((s) => norm(s.split(",")[0])));
    const municipalities = (results ?? [])
      .filter((row) => row.isMunicipality && !stopKeys.has(norm(row.name)))
      .map((row) => ({ key: `code:${row.code}`, title: row.name.split(",")[0].trim(), subtitle: row.departmentName, badge: undefined }));
    return [...stops, ...municipalities];
  }, [term, routeStops, results]);
  return (
    <SearchSelect
      name={name}
      validationValue={value?.name ?? ""}
      label={label}
      required={required}
      minLength={0}
      placeholder="Escribe el municipio"
      emptyText={term.trim().length < 2 ? "Escribe al menos 2 letras para buscar en el maestro DANE" : "No hay municipios con ese nombre"}
      hint={hint ?? (value?.code ? "Municipio validado con el maestro DANE" : value ? "Punto de control de la ruta" : undefined)}
      options={options}
      selectedLabel={value ? value.name.split(",")[0].trim() + (value.name.includes(",") ? `, ${value.name.split(",").slice(1).join(",").trim()}` : "") : undefined}
      onSearch={setTerm}
      onSelect={(key) => {
        if (key.startsWith("stop:")) {
          onSelect({ name: key.slice(5) });
          return;
        }
        const row = results?.find((r) => `code:${r.code}` === key);
        if (row) onSelect({ name: `${row.name.split(",")[0].trim()}, ${row.departmentName}`, code: row.code });
      }}
      onClear={onClear}
    />
  );
}
