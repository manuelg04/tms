import {
  buildManifestPreviewPayload,
  type AssignmentSnapshotData,
  type EmissionPlanInput
} from "../../convex/model/emissionPlan";
import {
  effectiveConsignment,
  type ConsignmentDraft,
  type LoadingOrderDraft,
  type ManifestDraft
} from "../../convex/model/dispatchWorkflow";
import type { OfficialDocumentState } from "../../convex/model/documentLifecycle";

export type ManifestPreviewSource = {
  workflowVariant?: EmissionPlanInput["workflowVariant"];
  tripNumber?: string;
  orderNumber?: string;
  orderDraft?: LoadingOrderDraft | null;
  orderSnapshotJson?: string;
  manifestNumber?: string;
  manifestDraft?: ManifestDraft | null;
  manifestSnapshotJson?: string;
  assignmentJson?: string;
  driver?: { document?: string; name?: string; phone?: string } | null;
  vehicle?: {
    plate?: string;
    make?: string;
    line?: string;
    modelYear?: string;
    configuration?: string;
    capacityTn?: string;
    ownerName?: string;
    ownerDocument?: string;
    possessorName?: string;
    possessorDocument?: string;
  } | null;
  trailer?: { plate?: string } | null;
  consignments: Array<{
    remesaId: string;
    number?: string;
    draft?: ConsignmentDraft | null;
    snapshotJson?: string;
    officialState: string;
  }>;
};

export function manifestPreviewPayload(source: ManifestPreviewSource): { payload: Record<string, unknown>; missingFields: string[] } {
  const order = (snapshotData(source.orderSnapshotJson) ?? source.orderDraft ?? null) as EmissionPlanInput["order"]["snapshot"];
  const manifest = (snapshotData(source.manifestSnapshotJson) ?? source.manifestDraft ?? null) as EmissionPlanInput["manifest"]["snapshot"];
  const assignment = (snapshotData(source.assignmentJson) as AssignmentSnapshotData | null) ?? liveAssignment(source);
  const draft = buildManifestPreviewPayload({
    workflowVariant: source.workflowVariant,
    order: { number: source.orderNumber, snapshot: order, officialState: "draft" },
    consignments: source.consignments.map((item) => ({
      remesaId: item.remesaId,
      number: item.number,
      snapshot: (snapshotData(item.snapshotJson) ?? effectiveConsignment(item.draft ?? {}, source.orderDraft ?? undefined)) as EmissionPlanInput["consignments"][number]["snapshot"],
      officialState: item.officialState as OfficialDocumentState
    })),
    manifest: { number: source.manifestNumber, snapshot: manifest, officialState: "draft" },
    assignment,
    tripNumber: source.tripNumber,
    tripEmitted: false,
    operationsInFlight: []
  });
  return draft;
}

function liveAssignment(source: ManifestPreviewSource): AssignmentSnapshotData | null {
  if (!source.driver && !source.vehicle && !source.trailer) return null;
  return {
    driver: source.driver ? { document: source.driver.document, name: source.driver.name, cellphone: source.driver.phone } : null,
    secondDriver: null,
    vehicle: source.vehicle
      ? {
          plate: source.vehicle.plate,
          make: source.vehicle.make,
          line: source.vehicle.line,
          modelYear: source.vehicle.modelYear,
          configuration: source.vehicle.configuration,
          capacityTn: source.vehicle.capacityTn,
          ownerName: source.vehicle.ownerName,
          ownerDocument: source.vehicle.ownerDocument,
          possessorName: source.vehicle.possessorName,
          possessorDocument: source.vehicle.possessorDocument
        }
      : null,
    trailer: source.trailer ? { plate: source.trailer.plate } : null
  };
}

function snapshotData(payloadJson: string | undefined): Record<string, unknown> | null {
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson) as { data?: unknown };
    return parsed && typeof parsed.data === "object" && parsed.data !== null && !Array.isArray(parsed.data)
      ? (parsed.data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
