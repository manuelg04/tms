"use client";

import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { MunicipalityField, type DivisionPick } from "../../../components/fields/lookup-fields";
import { CheckboxField, ChoiceCards, MasterSection, MasterSubmitBar, SelectField, TextAreaField, TextField } from "../../components/master-form-ui";
import { optionalText, readableError, requiredText, values } from "./master-form-utils";

type PersonType = "natural" | "legal";

export function ThirdPartyMasterForm() {
  const createThirdParty = useMutation(api.fleet.createThirdPartyMaster);
  const [personType, setPersonType] = useState<PersonType>("natural");
  const [city, setCity] = useState<DivisionPick | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const savingRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const data = new FormData(event.currentTarget);
    try {
      const roles = values(data, "roles") as ThirdPartyRole[];
      if (roles.length === 0) throw new Error("Selecciona al menos una actividad para el tercero.");
      const result = await createThirdParty({
        input: {
          personType,
          documentType: requiredText(data, "documentType", "Tipo de documento"),
          document: requiredText(data, "document", "N.º documento"),
          firstNames: personType === "natural" ? requiredText(data, "firstNames", "Nombres") : undefined,
          firstLastName: personType === "natural" ? requiredText(data, "firstLastName", "Primer apellido") : undefined,
          secondLastName: personType === "natural" ? optionalText(data, "secondLastName") : undefined,
          legalName: personType === "legal" ? requiredText(data, "legalName", "Razón social") : undefined,
          verificationDigit: personType === "legal" ? requiredText(data, "verificationDigit", "DV") : undefined,
          abbreviation: personType === "legal" ? optionalText(data, "abbreviation") : undefined,
          address: requiredText(data, "address", "Dirección"),
          city: city?.municipalityName ?? city?.name,
          cityCode: requiredText(data, "cityCode", "Ciudad"),
          phone1: requiredText(data, "phone1", "Teléfono 1"),
          phone2: optionalText(data, "phone2"),
          cellphone: optionalText(data, "cellphone"),
          fax: optionalText(data, "fax"),
          website: optionalText(data, "website"),
          email: optionalText(data, "email"),
          taxRegime: requiredText(data, "taxRegime", "Régimen"),
          roles,
          observations: optionalText(data, "observations")
        }
      });
      setSuccess(outcomeMessage(result.outcome));
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="master-editor-form" onSubmit={submit}>
      <MasterSection description="Define si el registro corresponde a una persona o a una empresa." title="Tipo de tercero">
        <ChoiceCards
          label="Naturaleza"
          name="personType"
          onChange={(value) => {
            setPersonType(value as PersonType);
            setError(null);
          }}
          options={[
            { value: "natural", label: "Persona natural", description: "Cédula, extranjería o pasaporte" },
            { value: "legal", label: "Persona jurídica", description: "Empresa identificada con NIT" }
          ]}
          value={personType}
        />
      </MasterSection>

      <MasterSection description={personType === "natural" ? "Identificación y nombres de la persona." : "NIT e información legal de la empresa."} title="Identidad">
        <SelectField defaultValue={personType === "legal" ? "N" : "C"} key={personType} label="Tipo de documento" name="documentType" required>
          {personType === "legal" ? <option value="N">NIT</option> : null}
          {personType === "natural" ? <>
            <option value="C">Cédula de ciudadanía</option>
            <option value="E">Cédula de extranjería</option>
            <option value="P">Pasaporte</option>
          </> : null}
        </SelectField>
        <TextField autoComplete="off" inputMode={personType === "legal" ? "numeric" : undefined} label="N.º documento" name="document" required />
        {personType === "legal" ? <>
          <TextField inputMode="numeric" label="DV" maxLength={1} name="verificationDigit" required />
          <TextField label="Razón social" name="legalName" required wide />
          <TextField label="Abreviatura" name="abbreviation" />
        </> : <>
          <TextField autoComplete="given-name" label="Nombres" name="firstNames" required />
          <TextField autoComplete="family-name" label="Primer apellido" name="firstLastName" required />
          <TextField label="Segundo apellido" name="secondLastName" />
        </>}
      </MasterSection>

      <MasterSection description="Ubicación, contacto y clasificación tributaria." title="Contacto y tributación">
        <MunicipalityField code={city?.code} label="Ciudad" name="cityCode" onClear={() => setCity(null)} onSelect={setCity} required />
        <SelectField defaultValue="" label="Régimen" name="taxRegime" required>
          <option disabled value="">Seleccionar</option>
          <option value="responsable_iva">Responsable de IVA</option>
          <option value="no_responsable_iva">No responsable de IVA</option>
          <option value="gran_contribuyente">Gran contribuyente</option>
          <option value="simple">Régimen SIMPLE</option>
        </SelectField>
        <TextField autoComplete="street-address" label="Dirección" name="address" required wide />
        <TextField autoComplete="tel" inputMode="tel" label="Teléfono 1" name="phone1" required />
        <TextField autoComplete="tel" inputMode="tel" label="Teléfono 2" name="phone2" />
        <TextField autoComplete="tel" inputMode="tel" label="Celular" name="cellphone" />
        <TextField inputMode="tel" label="Fax" name="fax" />
        <TextField autoComplete="url" label="Página web" name="website" placeholder="https://" type="url" />
        <TextField autoComplete="email" label="Correo electrónico" name="email" type="email" />
      </MasterSection>

      <MasterSection description="Un tercero puede cumplir varios roles dentro de la operación." title="Actividades">
        <div className="master-check-grid span-2">
          {ROLE_OPTIONS.map((role) => <CheckboxField hint={role.hint} key={role.value} label={role.label} name="roles" value={role.value} />)}
        </div>
      </MasterSection>

      <MasterSection optional title="Observaciones">
        <TextAreaField label="Notas internas" name="observations" rows={4} />
      </MasterSection>

      <MasterSubmitBar error={error} saving={saving} success={success} />
    </form>
  );
}

type ThirdPartyRole = "driver" | "owner" | "possessor" | "holder" | "sender" | "recipient" | "insured" | "insurance_company" | "transport_company" | "legal_representative" | "commercial" | "consignee" | "employee" | "logistics_operator" | "fiscal_reviewer" | "other";

const ROLE_OPTIONS: Array<{ value: ThirdPartyRole; label: string; hint?: string }> = [
  { value: "owner", label: "Propietario de vehículo" },
  { value: "possessor", label: "Poseedor de vehículo" },
  { value: "holder", label: "Tenedor" },
  { value: "sender", label: "Remitente" },
  { value: "recipient", label: "Destinatario" },
  { value: "consignee", label: "Consignatario" },
  { value: "transport_company", label: "Empresa de transporte" },
  { value: "logistics_operator", label: "Operador logístico" },
  { value: "insurance_company", label: "Compañía de seguros" },
  { value: "insured", label: "Asegurado" },
  { value: "commercial", label: "Comercial" },
  { value: "employee", label: "Empleado" },
  { value: "legal_representative", label: "Representante legal" },
  { value: "fiscal_reviewer", label: "Revisor fiscal" },
  { value: "driver", label: "Conductor" },
  { value: "other", label: "Otro" }
];

function outcomeMessage(outcome: "created" | "enriched" | "unchanged"): string {
  if (outcome === "created") return "Tercero creado y disponible para asignarlo a la operación.";
  if (outcome === "enriched") return "El tercero existente fue completado con esta información.";
  return "El tercero ya estaba registrado con la misma información.";
}
