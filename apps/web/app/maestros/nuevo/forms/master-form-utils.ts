import type { Id } from "../../../../convex/_generated/dataModel";

export type UploadedMasterPhoto = {
  storageId: Id<"_storage">;
  fileName: string;
};

export type UploadedVehiclePhoto = UploadedMasterPhoto & {
  slot: "front" | "left" | "right" | "rear";
};

export function requiredText(data: FormData, name: string, label: string): string {
  const result = data.get(name)?.toString().trim();
  if (!result) throw new Error(`${label} es obligatorio.`);
  return result;
}

export function optionalText(data: FormData, name: string): string | undefined {
  return data.get(name)?.toString().trim() || undefined;
}

export function optionalNumber(data: FormData, name: string, label: string): number | undefined {
  const raw = optionalText(data, name);
  if (raw === undefined) return undefined;
  const result = Number(raw.replace(",", "."));
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${label} debe ser un número mayor que cero.`);
  return result;
}

export function requiredNumber(data: FormData, name: string, label: string): number {
  const result = optionalNumber(data, name, label);
  if (result === undefined) throw new Error(`${label} es obligatorio.`);
  return result;
}

export function checked(data: FormData, name: string): boolean {
  return data.get(name) === "on";
}

export function values(data: FormData, name: string): string[] {
  return data.getAll(name).map((item) => item.toString()).filter(Boolean);
}

export async function uploadMasterPhoto(generateUploadUrl: (args: Record<string, never>) => Promise<string>, file: File): Promise<UploadedMasterPhoto> {
  const uploadUrl = await generateUploadUrl({});
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file
  });
  if (!response.ok) throw new Error(`No pudimos cargar ${file.name}. Intenta nuevamente.`);
  const result = await response.json() as { storageId?: Id<"_storage"> };
  if (!result.storageId) throw new Error(`La carga de ${file.name} no devolvió un archivo válido.`);
  return { storageId: result.storageId, fileName: file.name };
}

export async function discardUploadedMasterPhotos(
  discard: (args: { storageIds: Id<"_storage">[] }) => Promise<number>,
  photos: UploadedMasterPhoto[]
): Promise<void> {
  const storageIds = photos.map((photo) => photo.storageId);
  if (storageIds.length === 0) return;
  try {
    await discard({ storageIds });
  } catch {
    return;
  }
}

export function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const embedded = /message:\s*"([^"]+)"/.exec(message);
  return embedded?.[1] ?? message.replace(/^.*?: /, "");
}
