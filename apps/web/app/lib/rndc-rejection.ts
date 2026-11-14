export type RejectionGuide = { code?: string; message: string; action: string };

const GUIDES: Record<string, { message: string; action: string }> = {
  MAN330: {
    message: "Las observaciones del manifiesto pasan de 500 caracteres.",
    action: "Recorta el campo Observaciones del manifiesto a 500 caracteres o menos y vuelve a emitir."
  },
  REM502: {
    message: "La sede del remitente no tiene coordenadas registradas en el RNDC y el vehículo tiene empresa de monitoreo GPS.",
    action: "Elige en la remesa una sede del remitente que sí tenga coordenadas (las que registró Avansat) y vuelve a emitir."
  },
  REM503: {
    message: "La sede del destinatario no tiene coordenadas registradas en el RNDC y el vehículo tiene empresa de monitoreo GPS.",
    action: "Elige en la remesa una sede del destinatario que sí tenga coordenadas (las que registró Avansat) y vuelve a emitir."
  },
  REM130: {
    message: "La descripción corta de la mercancía pasa de 60 caracteres.",
    action: "Acorta la descripción de la primera remisión a 60 caracteres o menos y vuelve a emitir."
  },
  REM420: {
    message: "Las observaciones de la remesa pasan de 200 caracteres.",
    action: "Recorta las observaciones a 200 caracteres o menos y vuelve a emitir."
  },
  ANM070: {
    message: "El manifiesto tiene remesas con cumplido inicial registrado (por ejemplo, por la empresa de monitoreo GPS).",
    action: "Anula primero el cumplido inicial de la remesa, después el manifiesto y al final la remesa."
  }
};

export function rejectionCode(errorText: string | undefined | null): string | undefined {
  return (errorText ?? "").toUpperCase().match(/\b([A-Z]{3}\d{3})\b/)?.[1];
}

export function explainRejection(errorText: string | undefined | null): RejectionGuide {
  const raw = (errorText ?? "").replace(/\s+/g, " ").trim();
  const code = rejectionCode(raw);
  const guide = code ? GUIDES[code] : undefined;
  if (guide) return { code, ...guide };
  return {
    code,
    message: raw || "El RNDC rechazó el documento sin dar detalle.",
    action: "Corrige el dato que indica el mensaje y vuelve a emitir."
  };
}

export type RejectedDocument = {
  documentId: string;
  kind: "remesa" | "manifiesto";
  number?: string;
  remesaId?: string;
  editable: boolean;
  raw: string;
  guide: RejectionGuide;
};

const SETTLED = ["authorized", "fulfilled", "annulled"];

export function rejectedDocuments(
  documents: ReadonlyArray<{ _id: string; kind: string; number?: string; officialState?: string; errorText?: string; expedienteRemesaId?: string }>
): RejectedDocument[] {
  return documents.flatMap((document) => {
    const raw = (document.errorText ?? "").trim();
    if (!raw || SETTLED.includes(document.officialState ?? "") || (document.kind !== "remesa" && document.kind !== "manifiesto")) return [];
    return [{
      documentId: document._id,
      kind: document.kind,
      number: document.number,
      remesaId: document.expedienteRemesaId,
      editable: (document.officialState ?? "draft") === "draft",
      raw,
      guide: explainRejection(raw)
    }];
  });
}
