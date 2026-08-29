"use client";

import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { MunicipalityField, type DivisionPick } from "../../../components/fields/lookup-fields";
import { CheckboxField, MasterPhotoPicker, MasterSection, MasterSubmitBar, SelectField, TextAreaField, TextField } from "../../components/master-form-ui";
import { checked, discardUploadedMasterPhotos, optionalText, readableError, requiredText, uploadMasterPhoto, type UploadedMasterPhoto } from "./master-form-utils";
import { readWorkReferences, WorkReferencesFields } from "./work-references-fields";

export function DriverMasterForm() {
  const createDriver = useMutation(api.fleet.createDriverMaster);
  const generateUploadUrl = useMutation(api.fleet.generateMasterUploadUrl);
  const discardUploads = useMutation(api.fleet.discardMasterUploads);
  const [city, setCity] = useState<DivisionPick | null>(null);
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
      const emergencyName = optionalText(data, "emergencyContactName");
      const emergencyPhone = optionalText(data, "emergencyContactPhone");
      if (Boolean(emergencyName) !== Boolean(emergencyPhone)) throw new Error("Completa el nombre y el teléfono del contacto de emergencia.");
      const input = {
        documentType: requiredText(data, "documentType", "Tipo de documento"),
        document: requiredText(data, "document", "N.º documento"),
        firstNames: requiredText(data, "firstNames", "Nombres"),
        firstLastName: requiredText(data, "firstLastName", "Primer apellido"),
        secondLastName: optionalText(data, "secondLastName"),
        birthDate: requiredText(data, "birthDate", "Fecha de nacimiento"),
        sex: optionalText(data, "sex"),
        bloodType: requiredText(data, "bloodType", "RH"),
        address: requiredText(data, "address", "Dirección"),
        city: city?.municipalityName ?? city?.name,
        cityCode: requiredText(data, "cityCode", "Ciudad"),
        phone1: requiredText(data, "phone1", "Teléfono 1"),
        phone2: optionalText(data, "phone2"),
        cellphone: requiredText(data, "cellphone", "Celular"),
        mobileOperator: optionalText(data, "mobileOperator"),
        rating: requiredText(data, "rating", "Calificación"),
        licenseNumber: requiredText(data, "licenseNumber", "Número de licencia"),
        licenseCategory: requiredText(data, "licenseCategory", "Categoría"),
        licenseExpiresAt: requiredText(data, "licenseExpiresAt", "Vencimiento de licencia"),
        eps: optionalText(data, "eps"),
        arp: optionalText(data, "arp"),
        pensionFund: optionalText(data, "pensionFund"),
        crewCardNumber: optionalText(data, "crewCardNumber"),
        crewCardExpiresAt: optionalText(data, "crewCardExpiresAt"),
        hazmatCourse: optionalText(data, "hazmatCourse"),
        hazmatCourseExpiresAt: optionalText(data, "hazmatCourseExpiresAt"),
        emergencyContact: emergencyName && emergencyPhone ? { name: emergencyName, phone: emergencyPhone } : undefined,
        workReferences: readWorkReferences(data),
        activities: {
          owner: checked(data, "activityOwner"),
          possessor: checked(data, "activityPossessor"),
          employee: checked(data, "activityEmployee")
        },
        observations: optionalText(data, "observations")
      };
      uploadedPhoto = photo ? await uploadMasterPhoto(generateUploadUrl, photo) : undefined;
      const result = await createDriver({ input, photo: uploadedPhoto });
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
      <MasterSection description="Documento e información personal del conductor." title="Identidad">
        <SelectField defaultValue="C" label="Tipo de documento" name="documentType" required>
          <option value="C">Cédula de ciudadanía</option>
          <option value="E">Cédula de extranjería</option>
          <option value="P">Pasaporte</option>
        </SelectField>
        <TextField autoComplete="off" inputMode="numeric" label="N.º documento" name="document" required />
        <TextField autoComplete="given-name" label="Nombres" name="firstNames" required />
        <TextField autoComplete="family-name" label="Primer apellido" name="firstLastName" required />
        <TextField label="Segundo apellido" name="secondLastName" />
        <TextField label="Fecha de nacimiento" name="birthDate" required type="date" />
        <SelectField defaultValue="" label="Sexo" name="sex">
          <option value="">Seleccionar</option>
          <option value="M">Masculino</option>
          <option value="F">Femenino</option>
          <option value="O">Otro</option>
        </SelectField>
        <SelectField defaultValue="" label="RH" name="bloodType" required>
          <option disabled value="">Seleccionar</option>
          {BLOOD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </SelectField>
        <SelectField defaultValue="" label="Calificación" name="rating" required>
          <option disabled value="">Seleccionar</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </SelectField>
      </MasterSection>

      <MasterSection description="Datos para ubicar al conductor y mantener su ficha operativa." title="Contacto">
        <TextField autoComplete="street-address" label="Dirección" name="address" required wide />
        <MunicipalityField code={city?.code} label="Ciudad" name="cityCode" onClear={() => setCity(null)} onSelect={setCity} required />
        <TextField autoComplete="tel" inputMode="tel" label="Teléfono 1" name="phone1" required />
        <TextField autoComplete="tel" inputMode="tel" label="Teléfono 2" name="phone2" />
        <TextField autoComplete="tel" inputMode="tel" label="Celular" name="cellphone" required />
        <SelectField defaultValue="" label="Operador móvil" name="mobileOperator">
          <option value="">Seleccionar</option>
          <option value="Claro">Claro</option>
          <option value="Movistar">Movistar</option>
          <option value="Tigo">Tigo</option>
          <option value="WOM">WOM</option>
          <option value="Otro">Otro</option>
        </SelectField>
      </MasterSection>

      <MasterSection description="Documento habilitante para conducir." title="Licencia de conducción">
        <TextField label="Número de licencia" name="licenseNumber" required />
        <SelectField defaultValue="" label="Categoría" name="licenseCategory" required>
          <option disabled value="">Seleccionar</option>
          {LICENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
        </SelectField>
        <TextField label="Vencimiento" name="licenseExpiresAt" required type="date" />
      </MasterSection>

      <MasterSection optional title="Seguridad social">
        <TextField label="EPS" name="eps" />
        <TextField label="ARL / ARP" name="arp" />
        <TextField label="Fondo de pensiones" name="pensionFund" />
      </MasterSection>

      <MasterSection optional title="Documentos complementarios">
        <TextField label="N.º libreta de tripulante" name="crewCardNumber" />
        <TextField label="Vencimiento libreta" name="crewCardExpiresAt" type="date" />
        <TextField label="Curso de manejo de mercancías" name="hazmatCourse" />
        <TextField label="Vencimiento del curso" name="hazmatCourseExpiresAt" type="date" />
      </MasterSection>

      <MasterSection description="Persona a contactar en caso de accidente." optional title="Contacto de emergencia">
        <TextField label="Nombre" name="emergencyContactName" />
        <TextField inputMode="tel" label="Teléfono" name="emergencyContactPhone" />
      </MasterSection>

      <MasterSection optional title="Referencia laboral">
        <WorkReferencesFields />
      </MasterSection>

      <MasterSection description="Marca los roles que también cumple este conductor." optional title="Otras actividades">
        <div className="master-check-grid span-2">
          <CheckboxField label="Propietario" name="activityOwner" />
          <CheckboxField label="Poseedor" name="activityPossessor" />
          <CheckboxField label="Empleado" name="activityEmployee" />
        </div>
      </MasterSection>

      <MasterSection optional title="Foto y observaciones">
        <div className="span-2"><MasterPhotoPicker file={photo} label="Foto del conductor" onChange={setPhoto} /></div>
        <TextAreaField label="Observaciones" name="observations" rows={4} />
      </MasterSection>

      <MasterSubmitBar error={error} saving={saving} success={success} />
    </form>
  );
}

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const LICENSE_CATEGORIES = ["A1", "A2", "B1", "B2", "B3", "C1", "C2", "C3"];

function outcomeMessage(outcome: "created" | "enriched" | "unchanged"): string {
  if (outcome === "created") return "Conductor creado y disponible para asignaciones.";
  if (outcome === "enriched") return "El conductor existente fue completado con esta información.";
  return "El conductor ya estaba registrado con la misma información.";
}
