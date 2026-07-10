export type ActionOutcome = {
  operationOutcome: "succeeded" | "failed" | "uncertain";
  lifecycleAccepted: boolean;
  responseStatus: number;
  errorText?: string;
};

export function resolveActionOutcome(input: {
  backendOk: boolean;
  backendStatus: number;
  evidenceStored: boolean;
}): ActionOutcome {
  if (input.backendOk && input.evidenceStored) {
    return {
      operationOutcome: "succeeded",
      lifecycleAccepted: true,
      responseStatus: input.backendStatus
    };
  }

  if (input.backendOk) {
    return {
      operationOutcome: "uncertain",
      lifecycleAccepted: false,
      responseStatus: 202,
      errorText: "RNDC responded successfully, but durable evidence was not stored"
    };
  }

  if (input.backendStatus === 422 && !input.evidenceStored) {
    return {
      operationOutcome: "uncertain",
      lifecycleAccepted: false,
      responseStatus: input.backendStatus,
      errorText: "RNDC rejected the operation, but durable evidence was not stored"
    };
  }

  return {
    operationOutcome: input.backendStatus === 408 || input.backendStatus >= 500 ? "uncertain" : "failed",
    lifecycleAccepted: false,
    responseStatus: input.backendStatus
  };
}
