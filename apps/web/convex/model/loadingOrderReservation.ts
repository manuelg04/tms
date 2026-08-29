export type LoadingOrderReservationRecord = {
  organizationId: string;
  reservedBy: string;
  token: string;
  number: string;
  status: "reserved" | "consumed";
  expedienteId?: string;
};

export type LoadingOrderReservationContext = {
  organizationId: string;
  actorId: string;
  token: string;
};

export function formatLoadingOrderNumber(value: string): string {
  const number = value.trim();
  if (!/^\d+$/.test(number)) {
    throw new Error("El consecutivo de la orden debe ser numérico");
  }
  return number.padStart(9, "0");
}

export function normalizeLoadingOrderReservationToken(value: string): string {
  const token = value.trim();
  if (token.length < 8 || token.length > 200) {
    throw new Error("El token de reserva de la orden no es válido");
  }
  return token;
}

export function resolveLoadingOrderReservation(
  reservation: LoadingOrderReservationRecord,
  context: LoadingOrderReservationContext
): { kind: "available"; number: string } | { kind: "consumed"; number: string; expedienteId: string } {
  const token = normalizeLoadingOrderReservationToken(context.token);
  if (
    reservation.organizationId !== context.organizationId ||
    reservation.reservedBy !== context.actorId ||
    reservation.token !== token
  ) {
    throw new Error("La reserva de la orden no pertenece a este operador o espacio de trabajo");
  }
  if (reservation.status === "reserved") {
    return { kind: "available", number: reservation.number };
  }
  if (!reservation.expedienteId) {
    throw new Error("La reserva consumida no tiene un despacho asociado");
  }
  return { kind: "consumed", number: reservation.number, expedienteId: reservation.expedienteId };
}
