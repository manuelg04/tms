"use client";

import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { DELIVERY_DOCUMENTS, bogotaLocalInput, parseBogotaLocalInput } from "../../../../convex/model/monitoring";
import { convexErrorMessage } from "../../../lib/convex-error";
import { DateField } from "../../../components/fields/date-field";

const MAX = 1000;
const MAX_FILES = 6;

export function DeliveryForm({ trip, deliveredSites = [], onSaved }: { trip: Doc<"monitoringTrips">; deliveredSites?: string[]; onSaved: () => void }) {
  const save = useMutation(api.monitoring.registerDelivery);
  const generateUploadUrl = useMutation(api.monitoring.generateUploadUrl);
  const pendingSites = (trip.deliveryWaypoints ?? []).filter((site) => !deliveredSites.some((done) => done.toLocaleLowerCase("es").includes(site.toLocaleLowerCase("es"))));
  const [partial, setPartial] = useState(pendingSites.length > 0);
  const [at, setAt] = useState(() => bogotaLocalInput(Date.now()));
  const [location, setLocation] = useState(pendingSites[0] ?? trip.destination);
  const [receivedBy, setReceivedBy] = useState("");
  const [weight, setWeight] = useState("");
  const [condition, setCondition] = useState<"conforme" | "con_novedad">("conforme");
  const [documents, setDocuments] = useState<string[]>([DELIVERY_DOCUMENTS[0]]);
  const [files, setFiles] = useState<File[]>([]);
  const [observation, setObservation] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const requestKey = useRef<string | null>(null);
  const uploaded = useRef<Array<{ storageId: Id<"_storage">; fileName: string; contentType: string }>>([]);

  function toggleDocument(name: string) {
    setDocuments((current) => (current.includes(name) ? current.filter((d) => d !== name) : [...current, name]));
    requestKey.current = null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      if (!at) throw new Error("Indica la fecha y hora de la entrega.");
      const ms = parseBogotaLocalInput(at);
      if (!receivedBy.trim()) throw new Error("Indica quién recibió la carga en el destino.");
      if (!observation.trim()) throw new Error("Describe cómo terminó el descargue.");
      const kg = weight.trim() ? Number(weight.replace(/\./g, "").replace(",", ".")) : undefined;
      if (kg !== undefined && (!Number.isFinite(kg) || kg <= 0)) throw new Error("El peso entregado debe ser un número mayor que cero.");
      setBusy(true);
      if (uploaded.current.length !== files.length) {
        uploaded.current = [];
        for (const [index, file] of files.entries()) {
          setProgress(`Subiendo ${index + 1} de ${files.length}: ${file.name}`);
          const url = await generateUploadUrl({});
          const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
          if (!response.ok) throw new Error(`No se pudo subir ${file.name}.`);
          const result = (await response.json()) as { storageId?: Id<"_storage"> };
          if (!result.storageId) throw new Error(`La carga de ${file.name} no devolvió un archivo válido.`);
          uploaded.current.push({ storageId: result.storageId, fileName: file.name, contentType: file.type || "application/octet-stream" });
        }
      }
      setProgress("Registrando entrega…");
      requestKey.current ??= crypto.randomUUID();
      await save({
        tripId: trip._id,
        requestKey: requestKey.current,
        at: ms,
        location,
        receivedBy,
        deliveredWeightKg: kg,
        cargoCondition: condition,
        documents,
        attachments: uploaded.current,
        observation,
        partial,
      });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error && !("data" in reason) ? reason.message : convexErrorMessage(reason, "No se pudo registrar la entrega."));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <form className="bm-form" onSubmit={(e) => void submit(e)}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
        <div className="bm-form-grid">
          <div className="field wide">
            <span>Tipo de entrega</span>
            <div className="bm-segment" role="group" aria-label="Tipo de entrega">
              <button type="button" aria-pressed={partial} onClick={() => { setPartial(true); if (pendingSites[0] && location === trip.destination) setLocation(pendingSites[0]); requestKey.current = null; }}>Parcial · el viaje continúa</button>
              <button type="button" className="good" aria-pressed={!partial} onClick={() => { setPartial(false); if (pendingSites.includes(location)) setLocation(trip.destination); requestKey.current = null; }}>Final · cierra el viaje</button>
            </div>
            {partial && pendingSites.length ? <small className="counter" style={{ textAlign: "left" }}>Sitios de entrega pendientes: {pendingSites.join(", ")}</small> : null}
          </div>
          <DateField className="field wide" label="Fecha y hora de la entrega" name="deliveredAt" required value={at} withTime onChange={(value) => { setAt(value); requestKey.current = null; }} />
          <label className="field wide">
            <span>Lugar de descargue</span>
            <input required value={location} onChange={(e) => { setLocation(e.target.value); requestKey.current = null; }} />
          </label>
          <label className="field wide">
            <span>Recibido por <small>nombre y cargo</small></span>
            <input required placeholder="Ej. Pedro Pérez · Supervisor de recibo" value={receivedBy} onChange={(e) => { setReceivedBy(e.target.value); requestKey.current = null; }} />
          </label>
          <label className="field">
            <span>Peso entregado <small>kg, opcional</small></span>
            <input inputMode="decimal" placeholder="34000" value={weight} onChange={(e) => { setWeight(e.target.value); requestKey.current = null; }} />
          </label>
          <div className="field">
            <span>Estado de la carga</span>
            <div className="bm-segment" role="group" aria-label="Estado de la carga">
              <button type="button" className="good" aria-pressed={condition === "conforme"} onClick={() => { setCondition("conforme"); requestKey.current = null; }}>Conforme</button>
              <button type="button" className="warn" aria-pressed={condition === "con_novedad"} onClick={() => { setCondition("con_novedad"); requestKey.current = null; }}>Con novedad</button>
            </div>
          </div>
          <div className="field wide">
            <span>Documentos de soporte recibidos</span>
            <div className="bm-checks">
              {DELIVERY_DOCUMENTS.map((doc) => (
                <label key={doc}>
                  <input type="checkbox" checked={documents.includes(doc)} onChange={() => toggleDocument(doc)} />
                  {doc}
                </label>
              ))}
            </div>
          </div>
          <label className="field wide">
            <span>Adjuntar soportes <small>fotos o PDF, hasta {MAX_FILES}</small></span>
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []).slice(0, MAX_FILES);
                setFiles(list);
                uploaded.current = [];
                requestKey.current = null;
              }}
            />
            {files.length ? <small className="counter" style={{ textAlign: "left" }}>{files.map((f) => f.name).join(" · ")}</small> : null}
          </label>
          <label className="field wide">
            <span>Observación del descargue <small>{condition === "con_novedad" ? "describe la novedad encontrada" : "cómo terminó la entrega"}</small></span>
            <textarea required maxLength={MAX} value={observation} onChange={(e) => { setObservation(e.target.value.slice(0, MAX)); requestKey.current = null; }} placeholder="Ej. Descargue completo. El cliente verificó la carga y firmó la remesa." />
            <small className="counter">{MAX - observation.length} caracteres disponibles</small>
          </label>
        </div>
        {progress ? <p className="bm-message success" role="status">{progress}</p> : null}
        {error ? <p className="bm-message error" role="alert">{error}</p> : null}
        <div className="bm-form-actions">
          <button className="primary-action" type="submit">{busy ? "Guardando…" : partial ? "Registrar entrega parcial" : "Registrar entrega y cerrar viaje"}</button>
        </div>
      </fieldset>
    </form>
  );
}
