import {
  effectiveConsignment,
  remissionWeightTons,
  type DispatchStage,
} from "../../../convex/model/dispatchWorkflow";
import {
  ConsignmentFulfillmentForm,
  ManifestFulfillmentForm,
} from "../components/consignment-fulfillment-form";
import {
  AssignmentForm,
  ConsignmentsForm,
  LoadingOrderForm,
  ManifestForm,
  ReviewStage,
} from "../components/draft-stage-forms";
import {
  suggestionSummary,
  withConsignmentSuggestions,
  withManifestSuggestions,
  type OperacionesSuggestions,
} from "../../lib/operaciones-suggestions";
import type { Detail } from "./detail-types";

export function renderStage(input: {
  detail: Detail;
  selectedStage: DispatchStage;
  isEditable: boolean;
  orderReadOnly: boolean;
  manifestReadOnly: boolean;
  saveOrder: (data: FormData) => void;
  saveRemesas: (data: FormData) => void;
  saveFleet: (values: { driverId?: string; vehicleId?: string }) => void;
  saveManifestStage: (data: FormData) => void;
  fulfillRemesas: (data: FormData) => void;
  fulfillManifest: (data: FormData) => void;
  operaciones?: OperacionesSuggestions | null;
}) {
  const detail = input.detail;
  const operaciones = input.operaciones;
  if (input.selectedStage === "orden_cargue")
    return (
      <LoadingOrderForm
        draft={detail.expediente.loadingOrderDraft ?? {}}
        onSubmit={input.saveOrder}
        readOnly={input.orderReadOnly}
      />
    );
  if (input.selectedStage === "remesas")
    return (
      <>
      <OperacionesHint show={input.isEditable} stage="remesas" suggestions={operaciones} />
      <ConsignmentsForm
        context={{
          customerName: detail.customer.name,
          loadingOrderNumber:
            detail.expediente.cargoNumber ??
            detail.expediente.loadingOrderDraft?.orderNumber,
          manifestNumber:
            detail.expediente.manifestNumber ??
            detail.expediente.manifestDraft?.manifestNumber,
          serviceOrderCode: detail.serviceOrder.code,
        }}
        onSubmit={input.saveRemesas}
        order={detail.expediente.loadingOrderDraft ?? {}}
        readOnly={!input.isEditable}
        remesas={detail.remesas.map((remesa) =>
          remesa.officialState === "draft"
            ? { ...remesa, draft: withConsignmentSuggestions(remesa.draft, operaciones) }
            : remesa,
        )}
      />
      </>
    );
  if (input.selectedStage === "vehiculo_conductor")
    return (
      <AssignmentForm
        currentDriverDocument={detail.driver?.document}
        currentVehiclePlate={detail.vehicle?.plate}
        onSubmit={input.saveFleet}
        readOnly={!input.isEditable}
      />
    );
  if (input.selectedStage === "manifiesto")
    return (
      <>
      <OperacionesHint show={!input.manifestReadOnly} stage="manifiesto" suggestions={operaciones} />
      <ManifestForm
        context={{
          agencyCode: detail.expediente.agencyCode,
          consignmentCount: detail.remesas.length,
          originCity:
            detail.remesas[0]?.draft?.loading?.cityName ??
            detail.loadingLocation.city,
          destinationCity:
            detail.remesas[0]?.draft?.unloading?.cityName ??
            detail.unloadingLocation.city,
          vehicle: detail.vehicle,
          trailer: detail.trailer,
          driver: detail.driver,
          secondDriver: detail.secondDriver,
          moneyLimits: detail.moneyLimits,
        }}
        draft={
          input.manifestReadOnly
            ? detail.expediente.manifestDraft ?? {}
            : withManifestSuggestions(detail.expediente.manifestDraft ?? {}, operaciones)
        }
        onSubmit={input.saveManifestStage}
        readOnly={input.manifestReadOnly}
      />
      </>
    );
  if (input.selectedStage === "envio_rndc")
    return (
      <ReviewStage
        mode="PRUEBA"
        summary={[
          {
            label: "Orden de cargue",
            value:
              detail.expediente.loadingOrderDraft?.orderNumber ??
              "Se asignará al enviar",
          },
          {
            label: "Remesas",
            value: `${detail.remesas.length} preparadas`,
            warning: detail.remesas.length === 0,
          },
          {
            label: "Vehículo y conductor",
            value:
              detail.vehicle && detail.driver
                ? `${detail.vehicle.plate} · ${detail.driver.name ?? detail.driver.document}`
                : "Asignación incompleta",
            warning: !detail.vehicle || !detail.driver,
          },
          {
            label: "Manifiesto",
            value:
              detail.expediente.manifestDraft?.manifestNumber ??
              "Se asignará al enviar",
          },
        ]}
      />
    );
  if (input.selectedStage === "cumplido_inicial")
    return (
      <ConsignmentFulfillmentForm
        expedienteId={detail.expediente._id}
        onSubmit={input.fulfillRemesas}
        remesas={detail.remesas.map((remesa) => ({
          ...remesa,
          cargoWeightKg: remesa.cargoWeightKg ?? loadedWeightKg(detail, remesa),
        }))}
      />
    );
  return (
    <ManifestFulfillmentForm
      defaultDate={
        detail.expediente.manifestFulfillmentDraft?.documentsDeliveryDate
      }
      defaultObservation={
        detail.expediente.manifestFulfillmentDraft?.observation
      }
      onSubmit={input.fulfillManifest}
    />
  );
}

function OperacionesHint({
  show,
  stage,
  suggestions,
}: {
  show: boolean;
  stage: "remesas" | "manifiesto";
  suggestions?: OperacionesSuggestions | null;
}) {
  if (!show || !suggestions) return null;
  const items = suggestionSummary(stage, suggestions);
  if (items.length === 0) return null;
  return (
    <div className="operation-notice ok" role="status">
      <span />
      Sugerido desde la solicitud de planilla de Operaciones: {items.join(", ")}. Solo se llenan los campos vacíos; revísalos antes de guardar.
    </div>
  );
}

function loadedWeightKg(
  detail: Detail,
  remesa: Detail["remesas"][number],
): number | undefined {
  const effective = effectiveConsignment(
    remesa.draft ?? {},
    detail.expediente.loadingOrderDraft ?? null,
  );
  const tons = Number(remissionWeightTons(effective.remissions) ?? "0");
  return tons > 0 ? Math.round(tons * 1000) : undefined;
}
