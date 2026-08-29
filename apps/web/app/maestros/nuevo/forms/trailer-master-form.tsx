"use client";

import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { BodyTypeField, PartyField, VehicleField, type BodyTypePick, type PartyPick, type VehiclePick } from "../../../components/fields/lookup-fields";
import { MasterPhotoPicker, MasterSection, MasterSubmitBar, SelectField, TextAreaField, TextField } from "../../components/master-form-ui";
import { discardUploadedMasterPhotos, optionalNumber, optionalText, readableError, requiredNumber, requiredText, uploadMasterPhoto, type UploadedMasterPhoto } from "./master-form-utils";

export function TrailerMasterForm() {
  const createTrailer = useMutation(api.fleet.createTrailerMaster);
  const generateUploadUrl = useMutation(api.fleet.generateMasterUploadUrl);
  const discardUploads = useMutation(api.fleet.discardMasterUploads);
  const [owner, setOwner] = useState<PartyPick | null>(null);
  const [vehicle, setVehicle] = useState<VehiclePick | null>(null);
  const [bodyType, setBodyType] = useState<BodyTypePick | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
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
    let uploadedPhoto: UploadedMasterPhoto | undefined;
    try {
      if (!owner) throw new Error("Propietario es obligatorio. Selecciona un tercero existente.");
      if (!bodyType) throw new Error("Carrocería es obligatoria. Selecciona una opción del catálogo.");
      const input = {
        plate: requiredText(data, "plate", "N.º remolque / placa"),
        trailerType: optionalText(data, "trailerType"),
        make: requiredText(data, "make", "Marca"),
        modelYear: requiredText(data, "modelYear", "Modelo"),
        configuration: requiredText(data, "configuration", "Configuración"),
        capacityKg: requiredNumber(data, "capacityTn", "Capacidad") * 1000,
        emptyWeightKg: requiredNumber(data, "emptyWeightTn", "Peso vacío") * 1000,
        widthM: requiredNumber(data, "widthM", "Ancho"),
        heightM: requiredNumber(data, "heightM", "Alto"),
        lengthM: requiredNumber(data, "lengthM", "Largo"),
        rearVolumeM3: optionalNumber(data, "rearVolumeM3", "Volumen posterior"),
        ownerThirdPartyId: owner._id,
        linkedVehicleId: vehicle?._id,
        bodyType: bodyType.code,
        procedureType: optionalText(data, "procedureType"),
        chassisSerial: optionalText(data, "chassisSerial"),
        color: optionalText(data, "color"),
        status: requiredText(data, "status", "Estado") as "available" | "assigned" | "maintenance" | "inactive",
        observations: optionalText(data, "observations")
      };
      uploadedPhoto = photo ? await uploadMasterPhoto(generateUploadUrl, photo) : undefined;
      const result = await createTrailer({ input, photo: uploadedPhoto });
      uploadedPhoto = undefined;
      setSuccess(outcomeMessage(result.outcome));
    } catch (caught) {
      await discardUploadedMasterPhotos(discardUploads, uploadedPhoto ? [uploadedPhoto] : []);
      setError(readableError(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="master-editor-form" onSubmit={submit}>
      <MasterSection description="Número con el que se identificará el equipo en despachos y asignaciones." title="Identificación">
        <TextField autoCapitalize="characters" className="mono-input" label="N.º remolque / placa" maxLength={6} name="plate" pattern="R[0-9]{5}" placeholder="R12345" required />
        <SelectField defaultValue="" label="Tipo de remolque" name="trailerType">
          <option value="">Seleccionar</option>
          <option value="semirremolque">Semirremolque</option>
          <option value="remolque">Remolque</option>
          <option value="remolque_balanceado">Remolque balanceado</option>
          <option value="otro">Otro</option>
        </SelectField>
        <TextField label="Marca" name="make" required />
        <TextField inputMode="numeric" label="Modelo" maxLength={4} name="modelYear" placeholder="2026" required />
        <TextField label="Configuración" name="configuration" placeholder="S2, S3…" required />
        <SelectField defaultValue="available" label="Estado" name="status" required>
          <option value="available">Disponible</option>
          <option value="assigned">Asignado</option>
          <option value="maintenance">En mantenimiento</option>
          <option value="inactive">Inactivo</option>
        </SelectField>
      </MasterSection>

      <MasterSection description="Capacidad y dimensiones declaradas para el equipo." title="Datos técnicos">
        <TextField inputMode="decimal" label="Peso vacío (t)" min="0.01" name="emptyWeightTn" required step="0.01" />
        <TextField inputMode="decimal" label="Capacidad (t)" min="0.01" name="capacityTn" required step="0.01" />
        <TextField inputMode="decimal" label="Ancho (m)" min="0.01" name="widthM" required step="0.01" />
        <TextField inputMode="decimal" label="Alto (m)" min="0.01" name="heightM" required step="0.01" />
        <TextField inputMode="decimal" label="Largo (m)" min="0.01" name="lengthM" required step="0.01" />
        <TextField inputMode="decimal" label="Volumen posterior (m³)" min="0.01" name="rearVolumeM3" step="0.01" />
        <BodyTypeField onClear={() => setBodyType(null)} onSelect={setBodyType} required selected={bodyType} />
        <TextField label="Serie de chasis" name="chassisSerial" />
        <TextField label="Color" name="color" />
        <TextField label="Tipo de trámite" name="procedureType" />
      </MasterSection>

      <MasterSection description="Responsable legal y vehículo al que suele vincularse." title="Propiedad">
        <PartyField label="Propietario" onClear={() => setOwner(null)} onSelect={setOwner} required role="owner" selected={owner} />
        <VehicleField label="Vehículo vinculado" onClear={() => setVehicle(null)} onSelect={setVehicle} selected={vehicle} />
      </MasterSection>

      <MasterSection optional title="Foto y observaciones">
        <div className="span-2"><MasterPhotoPicker file={photo} label="Foto del remolque" onChange={setPhoto} /></div>
        <TextAreaField label="Observaciones" name="observations" rows={4} />
      </MasterSection>

      <MasterSubmitBar error={error} saving={saving} success={success} />
    </form>
  );
}

function outcomeMessage(outcome: "created" | "enriched" | "unchanged"): string {
  if (outcome === "created") return "Remolque creado y disponible para asignaciones.";
  if (outcome === "enriched") return "El remolque existente fue completado con esta información.";
  return "El remolque ya estaba registrado con la misma información.";
}
