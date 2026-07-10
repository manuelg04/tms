export type OperationIntent = {
  organizationId: string;
  expedienteId?: string;
  documentId?: string;
  expedienteRemesaId?: string;
  operationType: string;
  procesoId?: number;
  mode: string;
  businessKey: string;
  payloadJson: string;
};

export function operationIntentMatches(left: OperationIntent, right: OperationIntent): boolean {
  return left.organizationId === right.organizationId
    && left.expedienteId === right.expedienteId
    && left.documentId === right.documentId
    && left.expedienteRemesaId === right.expedienteRemesaId
    && left.operationType === right.operationType
    && left.procesoId === right.procesoId
    && left.mode === right.mode
    && left.businessKey === right.businessKey
    && left.payloadJson === right.payloadJson;
}
