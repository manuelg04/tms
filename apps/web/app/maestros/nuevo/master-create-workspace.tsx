"use client";

import { MasterEditorHeader } from "../components/master-form-ui";
import { DriverMasterForm } from "./forms/driver-master-form";
import { ThirdPartyMasterForm } from "./forms/third-party-master-form";
import { TrailerMasterForm } from "./forms/trailer-master-form";
import { VehicleMasterForm } from "./forms/vehicle-master-form";

export type MasterResource = "conductor" | "tercero" | "remolque" | "vehículo";

const descriptions: Record<MasterResource, string> = {
  conductor: "Identidad, licencia y datos de contacto para asignarlo con seguridad a los despachos.",
  tercero: "Una sola identidad reutilizable como propietario, poseedor, remitente u otro rol operativo.",
  remolque: "Ficha técnica, propiedad y disponibilidad del equipo de arrastre.",
  vehículo: "Datos técnicos, responsables y vigencias para dejar el vehículo listo para operar."
};

export function MasterCreateWorkspace({ resource }: { resource: MasterResource }) {
  return (
    <div className="master-editor-page">
      <MasterEditorHeader description={descriptions[resource]} resource={resource} />
      {resource === "conductor" ? <DriverMasterForm /> : null}
      {resource === "tercero" ? <ThirdPartyMasterForm /> : null}
      {resource === "remolque" ? <TrailerMasterForm /> : null}
      {resource === "vehículo" ? <VehicleMasterForm /> : null}
    </div>
  );
}
