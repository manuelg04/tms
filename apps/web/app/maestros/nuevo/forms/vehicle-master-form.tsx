"use client";

import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { BodyTypeField, DriverField, InsurerField, PartyField, TrailerField, VehicleLineField, type BodyTypePick, type DriverPick, type PartyPick, type TrailerPick, type VehicleLinePick } from "../../../components/fields/lookup-fields";
import { CheckboxField, MasterPhotoPicker, MasterSection, MasterSubmitBar, SelectField, TextAreaField, TextField } from "../../components/master-form-ui";
import { checked, discardUploadedMasterPhotos, optionalText, readableError, requiredText, uploadMasterPhoto, type UploadedVehiclePhoto } from "./master-form-utils";
import { readWorkReferences, WorkReferencesFields } from "./work-references-fields";
import { requestMasterSync } from "../../components/master-sync";

type PhotoSlot = "front" | "left" | "right" | "rear";

export function VehicleMasterForm() {
  const createVehicle = useMutation(api.fleet.createVehicleMaster);
  const generateUploadUrl = useMutation(api.fleet.generateMasterUploadUrl);
  const discardUploads = useMutation(api.fleet.discardMasterUploads);
  const [line, setLine] = useState<VehicleLinePick | null>(null);
  const [bodyType, setBodyType] = useState<BodyTypePick | null>(null);
  const [owner, setOwner] = useState<PartyPick | null>(null);
  const [possessor, setPossessor] = useState<PartyPick | null>(null);
  const [driver, setDriver] = useState<DriverPick | null>(null);
  const [trailer, setTrailer] = useState<TrailerPick | null>(null);
  const [insurer, setInsurer] = useState<{ insurerNit: string; name: string } | null>(null);
  const [liabilityInsurer, setLiabilityInsurer] = useState<{ insurerNit: string; name: string } | null>(null);
  const [vehicleKind, setVehicleKind] = useState("rigido");
  const [photos, setPhotos] = useState<Record<PhotoSlot, File | null>>({ front: null, left: null, right: null, rear: null });
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
    const uploadedPhotos: UploadedVehiclePhoto[] = [];
    try {
      if (!line) throw new Error("Marca y línea es obligatorio. Selecciona una opción del catálogo.");
      if (!bodyType) throw new Error("Carrocería es obligatoria. Selecciona una opción del catálogo.");
      if (!owner) throw new Error("Propietario es obligatorio. Selecciona un tercero existente.");
      if (!possessor) throw new Error("Poseedor es obligatorio. Selecciona un tercero existente.");
      if (!driver) throw new Error("Conductor principal es obligatorio. Selecciona un conductor existente.");
      if (!insurer) throw new Error("Aseguradora SOAT es obligatoria. Selecciona una opción del catálogo.");
      const rndcConfigurationCode = requiredText(data, "rndcConfigurationCode", "Configuración RNDC");
      const configuration = VEHICLE_CONFIGURATIONS.find((option) => option.code === rndcConfigurationCode);
      if (!configuration) throw new Error("Selecciona una configuración RNDC válida.");
      const rndcFuelCode = requiredText(data, "rndcFuelCode", "Combustible RNDC");
      const fuel = FUEL_TYPES.find((option) => option.code === rndcFuelCode);
      if (!fuel) throw new Error("Selecciona un combustible RNDC válido.");
      const input = {
        plate: requiredText(data, "plate", "Placa"),
        make: line.makeName ?? line.makeCode,
        line: line.lineCode,
        lineName: line.lineName,
        rndcMakeCode: line.makeCode,
        modelYear: requiredText(data, "modelYear", "Modelo"),
        repoweredModelYear: optionalText(data, "repoweredModelYear"),
        color: requiredText(data, "color", "Código de color RNDC"),
        bodyType: bodyType.description,
        rndcBodyTypeCode: bodyType.code,
        configuration: configuration.label,
        rndcConfigurationCode,
        fuelType: fuel.label,
        rndcFuelCode,
        linkType: requiredText(data, "linkType", "Tipo de vinculación"),
        engineNumber: requiredText(data, "engineNumber", "N.º motor"),
        serialNumber: optionalText(data, "serialNumber"),
        capacityTn: requiredText(data, "capacityTn", "Capacidad"),
        emptyWeightTn: requiredText(data, "emptyWeightTn", "Peso vacío"),
        affiliatedTo: optionalText(data, "affiliatedTo"),
        technicalInspectionNumber: optionalText(data, "technicalInspectionNumber"),
        technicalInspectionExpiresAt: optionalText(data, "technicalInspectionExpiresAt"),
        emissionsCertificateExpiresAt: optionalText(data, "emissionsCertificateExpiresAt"),
        cargoRegistryNumber: optionalText(data, "cargoRegistryNumber"),
        operationCardNumber: optionalText(data, "operationCardNumber"),
        transitLicenseNumber: requiredText(data, "transitLicenseNumber", "Licencia de tránsito"),
        checkListExpress: checked(data, "checkListExpress"),
        rating: requiredText(data, "rating", "Calificación"),
        ownerThirdPartyId: owner._id,
        possessorThirdPartyId: possessor._id,
        driverId: driver._id,
        defaultTrailerId: vehicleKind === "cabezote" ? trailer?._id : undefined,
        insurerNit: insurer.insurerNit,
        insurerName: insurer.name,
        soatNumber: requiredText(data, "soatNumber", "N.º SOAT"),
        soatExpiresAt: requiredText(data, "soatExpiresAt", "Vencimiento SOAT"),
        liabilityPolicyNumber: optionalText(data, "liabilityPolicyNumber"),
        liabilityInsurerNit: liabilityInsurer?.insurerNit,
        liabilityInsurerName: liabilityInsurer?.name,
        liabilityExpiresAt: optionalText(data, "liabilityExpiresAt"),
        transitAuthority: optionalText(data, "transitAuthority"),
        importDeclarationNumber: optionalText(data, "importDeclarationNumber"),
        publicServiceEntryMethod: optionalText(data, "publicServiceEntryMethod"),
        workReferences: readWorkReferences(data),
        observations: optionalText(data, "observations"),
        gpsOperator: optionalText(data, "gpsOperator"),
        gpsUsername: optionalText(data, "gpsUsername"),
        vehicleKind,
        status: requiredText(data, "status", "Estado") as "active" | "inactive" | "maintenance"
      };
      for (const [slot, file] of Object.entries(photos) as Array<[PhotoSlot, File | null]>) {
        if (!file) continue;
        uploadedPhotos.push({ slot, ...await uploadMasterPhoto(generateUploadUrl, file) });
      }
      const result = await createVehicle({ input, photos: uploadedPhotos.length > 0 ? uploadedPhotos : undefined });
      uploadedPhotos.length = 0;
      setSuccess(outcomeMessage(result.outcome));
      if (result.outcome !== "unchanged") {
        const sync = await requestMasterSync("vehicle", input.plate);
        if (sync.ok) setSuccess(`${outcomeMessage(result.outcome)} ${sync.message}`);
        else setError(`Se guardó en el TMS, pero el RNDC no lo aceptó todavía. ${sync.message}`);
      }
    } catch (caught) {
      await discardUploadedMasterPhotos(discardUploads, uploadedPhotos);
      setError(readableError(caught));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function setPhoto(slot: PhotoSlot, file: File | null) {
    setPhotos((current) => ({ ...current, [slot]: file }));
  }

  return (
    <form className="master-editor-form" onSubmit={submit}>
      <MasterSection description="Identificación principal y clasificación del vehículo." title="Identificación">
        <TextField autoCapitalize="characters" className="mono-input" label="Placa" maxLength={6} name="plate" pattern="[A-Za-z]{3}[0-9]{3}" placeholder="ABC123" required />
        <VehicleLineField onClear={() => setLine(null)} onSelect={setLine} required selected={line} />
        <TextField inputMode="numeric" label="Modelo" maxLength={4} name="modelYear" placeholder="2026" required />
        <TextField inputMode="numeric" label="Repotenciado a" maxLength={4} name="repoweredModelYear" />
        <TextField inputMode="numeric" label="Código de color RNDC" maxLength={5} name="color" pattern="[0-9]{1,5}" placeholder="Ej. 8" required />
        <SelectField defaultValue="rigido" label="Tipo de vehículo" name="vehicleKind" onChange={(event) => {
          setVehicleKind(event.target.value);
          if (event.target.value !== "cabezote") setTrailer(null);
        }} required>
          <option value="rigido">Rígido</option>
          <option value="cabezote">Cabezote</option>
          <option value="liviano">Liviano</option>
        </SelectField>
        <SelectField defaultValue="active" label="Estado" name="status" required>
          <option value="active">Activo</option>
          <option value="maintenance">En mantenimiento</option>
          <option value="inactive">Inactivo</option>
        </SelectField>
      </MasterSection>

      <MasterSection description="Características que determinan la operación y capacidad del vehículo." title="Datos técnicos">
        <SelectField defaultValue="" label="Tipo de vinculación" name="linkType" required>
          <option disabled value="">Seleccionar</option>
          <option value="propio">Propio</option>
          <option value="afiliado">Afiliado</option>
          <option value="tercero">Tercero</option>
          <option value="leasing">Leasing</option>
        </SelectField>
        <BodyTypeField onClear={() => setBodyType(null)} onSelect={setBodyType} required selected={bodyType} />
        <TextField label="N.º motor" name="engineNumber" required />
        <TextField label="N.º serie" name="serialNumber" />
        <TextField inputMode="decimal" label="Peso vacío (t)" min="0.01" name="emptyWeightTn" required step="0.01" />
        <TextField inputMode="decimal" label="Capacidad (t)" min="0.01" name="capacityTn" required step="0.01" />
        <SelectField defaultValue="" key={vehicleKind} label="Configuración RNDC" name="rndcConfigurationCode" required>
          <option disabled value="">Seleccionar</option>
          {VEHICLE_CONFIGURATIONS.filter((option) => option.vehicleKind === vehicleKind).map((option) => <option key={option.code} value={option.code}>{option.code} · {option.label}</option>)}
        </SelectField>
        <SelectField defaultValue="" label="Combustible RNDC" name="rndcFuelCode" required>
          <option disabled value="">Seleccionar</option>
          {FUEL_TYPES.map((option) => <option key={option.code} value={option.code}>{option.code} · {option.label}</option>)}
        </SelectField>
        <TextField label="Afiliado a" name="affiliatedTo" />
      </MasterSection>

      <MasterSection description="Licencias, revisiones y registros vigentes." title="Documentos del vehículo">
        <TextField label="Licencia de tránsito" name="transitLicenseNumber" required />
        <SelectField defaultValue="" label="Calificación" name="rating" required>
          <option disabled value="">Seleccionar</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </SelectField>
        <TextField label="Revisión técnico-mecánica" name="technicalInspectionNumber" />
        <TextField label="Vencimiento técnico-mecánica" name="technicalInspectionExpiresAt" type="date" />
        <TextField label="Vencimiento certificado de gases" name="emissionsCertificateExpiresAt" type="date" />
        <TextField label="Registro Nacional de Carga" name="cargoRegistryNumber" />
        <TextField label="Tarjeta de operación" name="operationCardNumber" />
        <div className="span-2"><CheckboxField label="Check List Express" name="checkListExpress" /></div>
      </MasterSection>

      <MasterSection description="SOAT obligatorio y póliza de responsabilidad civil, cuando aplique." title="Seguros">
        <TextField label="N.º SOAT" name="soatNumber" required />
        <InsurerField insurerName={insurer?.name} label="Aseguradora SOAT" name="insurerNit" nit={insurer?.insurerNit} onClear={() => setInsurer(null)} onSelect={setInsurer} required />
        <TextField label="Vencimiento SOAT" name="soatExpiresAt" required type="date" />
        <TextField label="Póliza de responsabilidad civil" name="liabilityPolicyNumber" />
        <InsurerField insurerName={liabilityInsurer?.name} label="Aseguradora de responsabilidad civil" name="liabilityInsurerNit" nit={liabilityInsurer?.insurerNit} onClear={() => setLiabilityInsurer(null)} onSelect={setLiabilityInsurer} />
        <TextField label="Vencimiento responsabilidad civil" name="liabilityExpiresAt" type="date" />
      </MasterSection>

      <MasterSection description="Selecciona registros existentes; no es necesario volver a escribir sus datos." title="Personas">
        <PartyField label="Propietario" onClear={() => setOwner(null)} onSelect={setOwner} required role="owner" selected={owner} />
        <PartyField label="Poseedor" onClear={() => setPossessor(null)} onSelect={setPossessor} required role="possessor" selected={possessor} />
        <DriverField label="Conductor principal" onClear={() => setDriver(null)} onSelect={setDriver} required selected={driver} />
        {vehicleKind === "cabezote" ? <TrailerField label="Remolque habitual" onClear={() => setTrailer(null)} onSelect={setTrailer} selected={trailer} /> : null}
      </MasterSection>

      <MasterSection optional title="Referencia laboral">
        <WorkReferencesFields />
      </MasterSection>

      <MasterSection optional title="Ministerio de Transporte">
        <TextField label="Organismo de tránsito donde se matriculó" name="transitAuthority" wide />
        <TextField label="Certificado individual de aduana o importación" name="importDeclarationNumber" wide />
        <TextField label="Forma de ingreso al servicio público" name="publicServiceEntryMethod" wide />
      </MasterSection>

      <MasterSection description="Puedes adjuntar una imagen por cada vista." optional title="Fotos del vehículo">
        <div className="master-photo-grid span-2">
          <MasterPhotoPicker file={photos.front} label="Foto frontal" onChange={(file) => setPhoto("front", file)} />
          <MasterPhotoPicker file={photos.left} label="Foto izquierda" onChange={(file) => setPhoto("left", file)} />
          <MasterPhotoPicker file={photos.right} label="Foto derecha" onChange={(file) => setPhoto("right", file)} />
          <MasterPhotoPicker file={photos.rear} label="Foto posterior" onChange={(file) => setPhoto("rear", file)} />
        </div>
        <TextAreaField label="Observaciones" name="observations" rows={4} />
      </MasterSection>

      <MasterSection description="Credenciales no sensibles para identificar el servicio de monitoreo." optional title="Operador GPS">
        <TextField label="Operador GPS" name="gpsOperator" />
        <TextField autoComplete="off" label="Usuario GPS" name="gpsUsername" />
      </MasterSection>

      <MasterSubmitBar error={error} saving={saving} success={success} />
    </form>
  );
}

const VEHICLE_CONFIGURATIONS = [
  { code: "45", label: "Camioneta", vehicleKind: "liviano" },
  { code: "50", label: "Camión rígido de 2 ejes", vehicleKind: "rigido" },
  { code: "51", label: "Camión rígido de 3 ejes", vehicleKind: "rigido" },
  { code: "52", label: "Camión rígido de 4 ejes", vehicleKind: "rigido" },
  { code: "53", label: "Tractocamión de 2 ejes", vehicleKind: "cabezote" },
  { code: "54", label: "Tractocamión de 3 ejes", vehicleKind: "cabezote" },
  { code: "55", label: "Tractocamión de más de 3 ejes", vehicleKind: "cabezote" },
  { code: "56", label: "Camión rígido de más de 4 ejes", vehicleKind: "rigido" }
] as const;

const FUEL_TYPES = [
  { code: "1", label: "Diésel o ACPM" },
  { code: "2", label: "Gasolina" },
  { code: "3", label: "Gas" },
  { code: "4", label: "Gas / gasolina" },
  { code: "5", label: "Eléctrico" }
] as const;

function outcomeMessage(outcome: "created" | "enriched" | "unchanged"): string {
  if (outcome === "created") return "Vehículo creado y disponible para asignaciones.";
  if (outcome === "enriched") return "El vehículo existente fue completado con esta información.";
  return "El vehículo ya estaba registrado con la misma información.";
}
