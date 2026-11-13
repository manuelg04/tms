"use client";

import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQuery } from "../../lib/convex-hooks";
import type { OperacionesRequest } from "../../lib/operaciones-request";
import { suggestionsFromRequest, type OperacionesSuggestions } from "../../lib/operaciones-suggestions";

export function useOperacionesSuggestions(expedienteId: Id<"expedientes">): { loading: boolean; suggestions: OperacionesSuggestions | null } {
  const data = useQuery(api.operaciones.forDispatch, { expedienteId });
  const requestId = data?.link.operacionesExpedienteId;
  const [state, setState] = useState<{ requestId: string; suggestions: OperacionesSuggestions | null } | null>(null);

  useEffect(() => {
    if (!requestId) return;
    let active = true;
    void fetch(`/api/operaciones/solicitudes/${encodeURIComponent(requestId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { item?: OperacionesRequest } | null;
        if (active) setState({ requestId, suggestions: response.ok && body?.item ? suggestionsFromRequest(body.item) : null });
      })
      .catch(() => {
        if (active) setState({ requestId, suggestions: null });
      });
    return () => {
      active = false;
    };
  }, [requestId]);

  if (data === undefined) return { loading: true, suggestions: null };
  if (!requestId) return { loading: false, suggestions: null };
  if (!state || state.requestId !== requestId) return { loading: true, suggestions: null };
  return { loading: false, suggestions: state.suggestions };
}
