"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { SearchSelect } from "./search-select";

export type PartyPick = { _id: Id<"thirdParties">; document: string; documentType: string; name: string; city?: string; cityCode?: string; phone?: string; siteCount?: number };
export type SitePick = { _id: Id<"thirdPartySites">; siteCode: string; siteName: string; address?: string; city?: string; cityCode?: string };
export type DivisionPick = { code: string; name: string; isMunicipality: boolean; municipalityName: string; departmentName: string };

const ID_TYPE_LABELS: Record<string, string> = { N: "NIT", C: "CC", E: "CE", P: "Pasaporte" };

export function idTypeLabel(code: string | undefined): string {
  return code ? ID_TYPE_LABELS[code.toUpperCase()] ?? code : "";
}

export function formatDocument(value: string | undefined): string {
  return (value ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function divisionLabel(division: DivisionPick | null | undefined): string {
  if (!division) return "";
  return division.isMunicipality ? `${division.name}, ${division.departmentName}` : `${division.name} (${division.municipalityName}), ${division.departmentName}`;
}

export function PartyField({ className, label, role, required, disabled, selected, typedName, onType, onSelect, onClear, hint }: { className?: string; label: string; role?: "sender" | "recipient" | "owner" | "holder"; required?: boolean; disabled?: boolean; selected?: { name?: string; document?: string; documentType?: string } | null; typedName?: string; onType?: (name: string) => void; onSelect: (party: PartyPick) => void; onClear?: () => void; hint?: string }) {
  const [term, setTerm] = useState("");
  const results = useQuery(api.lookups.partiesSearch, term.trim().length >= 2 ? { term, role } : "skip");
  const selectedLabel = selected?.name ? selected.name : undefined;
  const fallbackHint = selected?.document ? `${idTypeLabel(selected.documentType)} ${formatDocument(selected.document)} · tomado del RNDC` : typedName ? "No está en el RNDC: se registrará con los datos que escribas" : undefined;
  return (
    <SearchSelect
      className={className}
      disabled={disabled}
      emptyText="No hay terceros con ese nombre o documento. Puedes seguir escribiendo el nombre."
      hint={hint ?? fallbackHint}
      label={label}
      onClear={onClear}
      onSearch={(value) => {
        setTerm(value);
        onType?.(value);
      }}
      onSelect={(key) => {
        const party = results?.find((row) => row._id === key);
        if (party) onSelect(party);
      }}
      options={results?.map((party) => ({ key: party._id, title: party.name, badge: `${idTypeLabel(party.documentType)} ${formatDocument(party.document)}`, subtitle: [party.city, party.siteCount ? `${party.siteCount} sede${party.siteCount === 1 ? "" : "s"}` : undefined].filter(Boolean).join(" · ") }))}
      placeholder="Nombre o documento"
      required={required}
      selectedLabel={selectedLabel}
    />
  );
}

export function SiteField({ className = "", label, thirdPartyId, required, disabled, selectedCode, selectedName, onSelect, onClear, onManual }: { className?: string; label: string; thirdPartyId?: Id<"thirdParties"> | null; required?: boolean; disabled?: boolean; selectedCode?: string; selectedName?: string; onSelect: (site: SitePick) => void; onClear?: () => void; onManual?: (code: string) => void }) {
  const [term, setTerm] = useState("");
  const sites = useQuery(api.lookups.partySites, thirdPartyId ? { thirdPartyId } : "skip");
  if (!thirdPartyId) {
    return (
      <label className={`form-field ${className}`}>
        <span>{label}{required ? <em aria-hidden="true"> *</em> : null}</span>
        <input disabled={disabled} inputMode="numeric" onChange={(event) => onManual?.(event.target.value.replace(/\D/g, ""))} placeholder="Código de sede en el RNDC" value={selectedCode ?? ""} />
        <small className="search-select-hint">Elige un tercero del RNDC para ver sus sedes, o escribe el código de sede</small>
      </label>
    );
  }
  const needle = term.trim().toLowerCase();
  const filtered = sites?.filter((site) => !needle || `${site.siteCode} ${site.siteName} ${site.city ?? ""} ${site.address ?? ""}`.toLowerCase().includes(needle));
  const selectedLabel = selectedCode ? `${selectedCode} · ${selectedName ?? "Sede"}` : undefined;
  return (
    <SearchSelect
      className={className}
      disabled={disabled}
      emptyText={sites && sites.length === 0 ? "Este tercero no tiene sedes registradas en el RNDC" : "Ninguna sede coincide"}
      hint={sites ? `${sites.length} sede${sites.length === 1 ? "" : "s"} en el RNDC` : undefined}
      label={label}
      minLength={0}
      onClear={onClear}
      onSearch={setTerm}
      onSelect={(key) => {
        const site = sites?.find((row) => row._id === key);
        if (site) onSelect(site);
      }}
      options={filtered?.map((site) => ({ key: site._id, title: site.siteName, badge: `Sede ${site.siteCode}`, subtitle: [site.address, site.city].filter(Boolean).join(" · ") }))}
      placeholder="Buscar sede"
      required={required}
      selectedLabel={selectedLabel}
    />
  );
}

export function MunicipalityField({ className, label, name, required, disabled, code, onSelect, onClear }: { className?: string; label: string; name: string; required?: boolean; disabled?: boolean; code?: string; onSelect: (division: DivisionPick) => void; onClear?: () => void }) {
  const [term, setTerm] = useState("");
  const results = useQuery(api.lookups.divisionsSearch, term.trim().length >= 2 ? { term } : "skip");
  const current = useQuery(api.lookups.divisionByCode, code ? { code } : "skip");
  const selectedLabel = code ? divisionLabel(current) || code : undefined;
  return (
    <>
      <SearchSelect
        className={className}
        disabled={disabled}
        emptyText="No hay municipios con ese nombre"
        hint={code ? `Código RNDC ${code}` : undefined}
        label={label}
        onClear={onClear}
        onSearch={setTerm}
        onSelect={(key) => {
          const division = results?.find((row) => row.code === key);
          if (division) onSelect(division);
        }}
        options={results?.map((division) => ({ key: division.code, title: division.isMunicipality ? division.name : `${division.name} · ${division.municipalityName}`, subtitle: division.departmentName, badge: division.isMunicipality ? undefined : "Corregimiento" }))}
        placeholder="Nombre del municipio"
        required={required}
        selectedLabel={selectedLabel}
      />
      <input name={name} type="hidden" value={code ?? ""} />
    </>
  );
}

export function PackagingField({ className, label, name, required, disabled, code, description, onSelect, onClear }: { className?: string; label: string; name: string; required?: boolean; disabled?: boolean; code?: string; description?: string; onSelect: (option: { code: string; description: string }) => void; onClear?: () => void }) {
  const [term, setTerm] = useState("");
  const results = useQuery(api.lookups.packagingSearch, { term });
  const known = results?.find((row) => row.code === code);
  const selectedLabel = code ? `${known?.description ?? description ?? "Empaque"} (${code})` : undefined;
  return (
    <>
      <SearchSelect
        className={className}
        disabled={disabled}
        emptyText="No hay empaques con esa descripción"
        label={label}
        minLength={0}
        onClear={onClear}
        onSearch={setTerm}
        onSelect={(key) => {
          const option = results?.find((row) => row.code === key);
          if (option) onSelect(option);
        }}
        options={results?.map((option) => ({ key: option.code, title: option.description, badge: option.code, subtitle: option.fullDescription !== option.description ? option.fullDescription : undefined }))}
        placeholder="Caja, estiba, granel…"
        required={required}
        selectedLabel={selectedLabel}
      />
      <input name={name} type="hidden" value={code ?? ""} />
    </>
  );
}

export function InsurerField({ className, label, name, required, disabled, nit, insurerName, onSelect, onClear }: { className?: string; label: string; name: string; required?: boolean; disabled?: boolean; nit?: string; insurerName?: string; onSelect: (option: { insurerNit: string; name: string }) => void; onClear?: () => void }) {
  const [term, setTerm] = useState("");
  const results = useQuery(api.lookups.insurersSearch, term.trim() ? { term } : "skip");
  const selectedLabel = nit ? `${insurerName ?? "Aseguradora"} · NIT ${formatDocument(nit)}` : undefined;
  return (
    <>
      <SearchSelect
        className={className}
        disabled={disabled}
        emptyText="No hay aseguradoras con ese nombre o NIT"
        label={label}
        onClear={onClear}
        onSearch={setTerm}
        onSelect={(key) => {
          const option = results?.find((row) => row.insurerNit === key);
          if (option) onSelect(option);
        }}
        options={results?.map((option) => ({ key: option.insurerNit, title: option.name, badge: `NIT ${formatDocument(option.insurerNit)}` }))}
        placeholder="Nombre o NIT"
        required={required}
        selectedLabel={selectedLabel}
      />
      <input name={name} type="hidden" value={nit ?? ""} />
    </>
  );
}

export const CARGO_NATURES = [
  { code: "1", label: "Carga normal" },
  { code: "2", label: "Carga extradimensionada" },
  { code: "3", label: "Carga extrapesada" }
];

export function CargoNatureField({ className = "", name, value, required, onChange }: { className?: string; name: string; value?: string; required?: boolean; onChange?: (value: string) => void }) {
  return (
    <label className={`form-field ${className}`}>
      <span>Naturaleza de la carga{required ? <em aria-hidden="true"> *</em> : null}</span>
      <select defaultValue={onChange ? undefined : value ?? "1"} name={name} onChange={onChange ? (event) => onChange(event.target.value) : undefined} value={onChange ? value ?? "1" : undefined}>
        {CARGO_NATURES.map((nature) => <option key={nature.code} value={nature.code}>{nature.label}</option>)}
      </select>
    </label>
  );
}

export function IdTypeField({ className = "", label, name, value, onChange, required }: { className?: string; label: string; name: string; value?: string; onChange?: (value: string) => void; required?: boolean }) {
  return (
    <label className={`form-field ${className}`}>
      <span>{label}{required ? <em aria-hidden="true"> *</em> : null}</span>
      <select name={name} onChange={(event) => onChange?.(event.target.value)} value={value ?? "N"}>
        <option value="N">NIT</option>
        <option value="C">Cédula de ciudadanía</option>
        <option value="E">Cédula de extranjería</option>
        <option value="P">Pasaporte</option>
      </select>
    </label>
  );
}
