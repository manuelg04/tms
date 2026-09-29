import type { OperationTimes } from "../../../convex/model/fulfillmentWorkflow";
import { deriveOperationTimes } from "../../../convex/model/fulfillmentWorkflow";
import {
  effectiveConsignment,
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
}) {
  const detail = input.detail;
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
        remesas={detail.remesas}
      />
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
        }}
        draft={detail.expediente.manifestDraft ?? {}}
        onSubmit={input.saveManifestStage}
        readOnly={input.manifestReadOnly}
      />
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
        onSubmit={input.fulfillRemesas}
        remesas={detail.remesas.map((remesa) => ({
          ...remesa,
          operationTimes: defaultOperationTimes(detail, remesa),
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

function defaultOperationTimes(
  detail: Detail,
  remesa: Detail["remesas"][number],
): OperationTimes {
  const effective = effectiveConsignment(
    remesa.draft ?? {},
    detail.expediente.loadingOrderDraft ?? null,
  );
  const loadingAt =
    detail.serviceOrder.scheduledLoadingAt ?? detail.expediente.createdAt;
  return deriveOperationTimes(
    {
      loadingAppointmentAt: effective.loading?.appointmentAt,
      loadingAgreedHours: effective.loading?.agreedHours,
      unloadingAppointmentAt: effective.unloading?.appointmentAt,
      unloadingAgreedHours: effective.unloading?.agreedHours,
    },
    remesa.fulfillmentDraft,
    {
      loadingAt,
      unloadingAt: detail.serviceOrder.scheduledUnloadingAt ?? loadingAt,
    },
  );
}
