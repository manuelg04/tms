/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as audit from "../audit.js";
import type * as counters from "../counters.js";
import type * as dashboard from "../dashboard.js";
import type * as dispatches from "../dispatches.js";
import type * as evidence from "../evidence.js";
import type * as expedientes from "../expedientes.js";
import type * as fleet from "../fleet.js";
import type * as masterData from "../masterData.js";
import type * as model_access from "../model/access.js";
import type * as model_consecutiveRange from "../model/consecutiveRange.js";
import type * as model_dashboardStatus from "../model/dashboardStatus.js";
import type * as model_dispatchPresentation from "../model/dispatchPresentation.js";
import type * as model_dispatchSnapshot from "../model/dispatchSnapshot.js";
import type * as model_dispatchWorkflow from "../model/dispatchWorkflow.js";
import type * as model_documentLifecycle from "../model/documentLifecycle.js";
import type * as model_draftValidators from "../model/draftValidators.js";
import type * as model_emissionPlan from "../model/emissionPlan.js";
import type * as model_fulfillmentWorkflow from "../model/fulfillmentWorkflow.js";
import type * as model_officialDocumentIdentity from "../model/officialDocumentIdentity.js";
import type * as model_operationIntent from "../model/operationIntent.js";
import type * as model_operationState from "../model/operationState.js";
import type * as model_reconciliationOutcome from "../model/reconciliationOutcome.js";
import type * as notifications from "../notifications.js";
import type * as officialDocuments from "../officialDocuments.js";
import type * as rndc from "../rndc.js";
import type * as rndcOperations from "../rndcOperations.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  audit: typeof audit;
  counters: typeof counters;
  dashboard: typeof dashboard;
  dispatches: typeof dispatches;
  evidence: typeof evidence;
  expedientes: typeof expedientes;
  fleet: typeof fleet;
  masterData: typeof masterData;
  "model/access": typeof model_access;
  "model/consecutiveRange": typeof model_consecutiveRange;
  "model/dashboardStatus": typeof model_dashboardStatus;
  "model/dispatchPresentation": typeof model_dispatchPresentation;
  "model/dispatchSnapshot": typeof model_dispatchSnapshot;
  "model/dispatchWorkflow": typeof model_dispatchWorkflow;
  "model/documentLifecycle": typeof model_documentLifecycle;
  "model/draftValidators": typeof model_draftValidators;
  "model/emissionPlan": typeof model_emissionPlan;
  "model/fulfillmentWorkflow": typeof model_fulfillmentWorkflow;
  "model/officialDocumentIdentity": typeof model_officialDocumentIdentity;
  "model/operationIntent": typeof model_operationIntent;
  "model/operationState": typeof model_operationState;
  "model/reconciliationOutcome": typeof model_reconciliationOutcome;
  notifications: typeof notifications;
  officialDocuments: typeof officialDocuments;
  rndc: typeof rndc;
  rndcOperations: typeof rndcOperations;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
