"use client";

import { useState } from "react";
import { useMutation, useQuery } from "../../lib/convex-hooks";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { SearchSelect } from "./search-select";
import { useDebounced } from "../../lib/hooks";

export type CustomerPick = { _id: Id<"customers">; name: string; identificationNumber?: string };

export function CustomerField({ className, label = "Empresa cliente", name = "customerId", required, disabled, selected, allowCreate = true, onSelect, onClear, hint }: { className?: string; label?: string; name?: string; required?: boolean; disabled?: boolean; selected?: CustomerPick | null; allowCreate?: boolean; onSelect: (customer: CustomerPick) => void; onClear?: () => void; hint?: string }) {
  const [term, setTerm] = useState("");
  const query = useDebounced(term.trim(), 200);
  const results = useQuery(api.clientCompanies.search, query.length >= 2 ? { term: query } : "skip");
  const create = useMutation(api.clientCompanies.create);
  const [creating, setCreating] = useState(false);
  const cleanTerm = term.trim();
  const exact = results?.some((row) => row.name.toLocaleLowerCase("es") === cleanTerm.toLocaleLowerCase("es"));
  const canCreate = allowCreate && cleanTerm.length >= 3 && results !== undefined && !exact;
  const options = [
    ...(results?.map((row) => ({ key: row._id as string, title: row.name, subtitle: row.identificationNumber ? `NIT ${row.identificationNumber}` : undefined })) ?? []),
    ...(canCreate ? [{ key: `__create__${cleanTerm}`, title: `Registrar "${cleanTerm}" como empresa nueva`, badge: "Nueva" }] : []),
  ];

  async function choose(key: string) {
    if (key.startsWith("__create__")) {
      const nameToCreate = key.slice("__create__".length);
      setCreating(true);
      try {
        const id = await create({ name: nameToCreate });
        onSelect({ _id: id, name: nameToCreate });
      } finally {
        setCreating(false);
      }
      return;
    }
    const row = results?.find((r) => r._id === key);
    if (row) onSelect({ _id: row._id, name: row.name, identificationNumber: row.identificationNumber });
  }

  return (
    <SearchSelect
      name={name}
      validationValue={selected?._id ?? ""}
      className={className}
      disabled={disabled || creating}
      emptyText={allowCreate ? "Escribe al menos 3 letras para registrar una empresa nueva" : "No hay empresas con ese nombre"}
      hint={hint ?? (selected?.identificationNumber ? `NIT ${selected.identificationNumber}` : undefined)}
      label={label}
      onClear={onClear}
      onSearch={setTerm}
      onSelect={(key) => void choose(key)}
      options={options}
      placeholder="Nombre de la empresa"
      required={required}
      selectedLabel={selected?.name}
    />
  );
}
