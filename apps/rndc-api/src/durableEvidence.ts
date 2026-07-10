import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { maskSecrets } from "@tms/rndc-core";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

export type DurableEvidenceContext = {
  organizationId: string;
  expedienteId: string;
  documentId?: string;
  operationId: string;
  expectedMode: "dry-run" | "live";
};

export type DurableOperationContext = DurableEvidenceContext & {
  operationType: string;
  leaseOwner: string;
};

export type DurableContextValidationInput = DurableOperationContext & {
  payloadJson: string;
};

export type DurableEvidenceKind = "request_xml" | "response_xml" | "pdf" | "other";

export type DurableEvidenceArtifact = {
  kind: DurableEvidenceKind;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
  size: number;
};

export type ExistingDurableEvidence = {
  artifactId: string;
  kind: DurableEvidenceKind;
  fileName: string;
  sha256: string;
  size: number;
};

export type DurableEvidenceDependencies = {
  readFile: (path: string) => Promise<Uint8Array>;
  listExisting: (context: DurableEvidenceContext) => Promise<ExistingDurableEvidence[]>;
  upload: (context: DurableEvidenceContext, artifact: DurableEvidenceArtifact) => Promise<string>;
};

export type DurableEvidenceStore = (
  result: unknown,
  context: DurableEvidenceContext,
  directories: { outputDir: string; pdfDir: string }
) => Promise<DurableEvidenceReport>;

export type DurableContextValidator = (context: DurableContextValidationInput) => Promise<boolean>;

export type DurableEvidenceReport = {
  stored: boolean;
  artifacts: Array<ExistingDurableEvidence & { existing: boolean }>;
  error?: string;
};

type DurableEvidenceContextResult =
  | { requested: false }
  | { requested: true; context: DurableOperationContext }
  | { requested: true; error: string };

type EvidenceSource = {
  kind: DurableEvidenceKind;
  path: string;
  contentType: string;
};

export function readDurableEvidenceContext(getHeader: (name: string) => string | undefined): DurableEvidenceContextResult {
  if (getHeader("X-TMS-Durable-Operation") !== "true") {
    return { requested: false };
  }

  const organizationId = cleanHeader(getHeader("X-TMS-Organization-Id"));
  const expedienteId = cleanHeader(getHeader("X-TMS-Expediente-Id"));
  const documentId = cleanHeader(getHeader("X-TMS-Document-Id"));
  const operationId = cleanHeader(getHeader("X-TMS-Operation-Id"));
  const expectedMode = cleanHeader(getHeader("X-TMS-Expected-Mode"));
  const operationType = cleanHeader(getHeader("X-TMS-Operation-Type"));
  const leaseOwner = cleanHeader(getHeader("X-TMS-Lease-Owner"));

  if (!organizationId || !expedienteId || !operationId || !operationType || !leaseOwner || (expectedMode !== "dry-run" && expectedMode !== "live")) {
    return { requested: true, error: "Durable evidence references are incomplete" };
  }

  return {
    requested: true,
    context: {
      organizationId,
      expedienteId,
      ...(documentId ? { documentId } : {}),
      operationId,
      expectedMode,
      operationType,
      leaseOwner
    }
  };
}

export async function storeDurableEvidence(
  result: unknown,
  context: DurableEvidenceContext,
  directories: { outputDir: string; pdfDir: string },
  dependencies: DurableEvidenceDependencies
): Promise<DurableEvidenceReport> {
  const sources = evidenceSources(result, directories);

  if (sources.length === 0) {
    throw new Error("RNDC result did not expose evidence files");
  }

  const artifacts = await Promise.all(sources.map(async (source) => {
    const sourceBytes = await dependencies.readFile(source.path);
    const bytes = sanitizeBytes(source.kind, sourceBytes);
    return {
      kind: source.kind,
      fileName: basename(source.path),
      contentType: source.contentType,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("base64"),
      size: bytes.byteLength
    } satisfies DurableEvidenceArtifact;
  }));
  const existing = await dependencies.listExisting(context);
  const stored = [];

  for (const artifact of artifacts) {
    const match = existing.find((candidate) =>
      candidate.kind === artifact.kind
      && candidate.fileName === artifact.fileName
      && candidate.sha256 === artifact.sha256
      && candidate.size === artifact.size
    );

    if (match) {
      stored.push({ ...match, existing: true });
      continue;
    }

    const artifactId = await dependencies.upload(context, artifact);
    stored.push({
      artifactId,
      kind: artifact.kind,
      fileName: artifact.fileName,
      sha256: artifact.sha256,
      size: artifact.size,
      existing: false
    });
  }

  return { stored: true, artifacts: stored };
}

export async function storeDurableEvidenceToConvex(
  result: unknown,
  context: DurableEvidenceContext,
  directories: { outputDir: string; pdfDir: string },
  environment: { CONVEX_URL?: string; RNDC_INGEST_KEY?: string } = process.env
): Promise<DurableEvidenceReport> {
  const convexUrl = environment.CONVEX_URL?.trim();
  const serviceKey = environment.RNDC_INGEST_KEY?.trim();

  if (!convexUrl || !serviceKey) {
    return {
      stored: false,
      artifacts: [],
      error: "Durable evidence storage is not configured"
    };
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    return await storeDurableEvidence(result, context, directories, {
      readFile,
      listExisting: async (evidenceContext) => {
        try {
          const rows = await client.query(anyApi.evidence.listForOperationForService, {
            serviceKey,
            operationId: evidenceContext.operationId
          }) as unknown;
          return Array.isArray(rows) ? rows.flatMap(readExistingArtifact) : [];
        } catch {
          throw new Error("Durable evidence listing failed");
        }
      },
      upload: async (evidenceContext, artifact) => {
        let uploadUrl: string;

        try {
          uploadUrl = await client.mutation(anyApi.evidence.generateServiceUploadUrl, { serviceKey }) as string;
        } catch {
          throw new Error("Durable evidence upload URL failed");
        }

        const body = artifact.bytes.buffer.slice(
          artifact.bytes.byteOffset,
          artifact.bytes.byteOffset + artifact.bytes.byteLength
        ) as ArrayBuffer;
        let uploadResponse: Response;

        try {
          uploadResponse = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": artifact.contentType },
            body
          });
        } catch {
          throw new Error("Durable evidence upload failed");
        }

        if (!uploadResponse.ok) {
          throw new Error("Convex evidence upload failed");
        }

        const uploaded = await uploadResponse.json() as { storageId?: unknown };

        if (typeof uploaded.storageId !== "string") {
          throw new Error("Convex evidence upload did not return a storage ID");
        }

        try {
          const artifactId = await client.mutation(anyApi.evidence.finalizeServiceUpload, {
            serviceKey,
            organizationId: evidenceContext.organizationId,
            expedienteId: evidenceContext.expedienteId,
            ...(evidenceContext.documentId ? { documentId: evidenceContext.documentId } : {}),
            rndcOperationId: evidenceContext.operationId,
            storageId: uploaded.storageId,
            kind: artifact.kind,
            fileName: artifact.fileName,
            expectedSha256: artifact.sha256
          }) as string;
          return artifactId;
        } catch {
          throw new Error("Durable evidence finalization failed");
        }
      }
    });
  } catch (cause) {
    return {
      stored: false,
      artifacts: [],
      error: safeStorageError(cause)
    };
  }
}

export async function validateDurableContextWithConvex(
  context: DurableContextValidationInput,
  environment: { CONVEX_URL?: string; RNDC_INGEST_KEY?: string } = process.env
): Promise<boolean> {
  const convexUrl = environment.CONVEX_URL?.trim();
  const serviceKey = environment.RNDC_INGEST_KEY?.trim();

  if (!convexUrl || !serviceKey) {
    return false;
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    return await client.query(anyApi.rndcOperations.validateDurableContextForService, {
      serviceKey,
      organizationId: context.organizationId,
      expedienteId: context.expedienteId,
      ...(context.documentId ? { documentId: context.documentId } : {}),
      operationId: context.operationId,
      mode: context.expectedMode,
      operationType: context.operationType,
      leaseOwner: context.leaseOwner,
      payloadJson: context.payloadJson
    }) as boolean;
  } catch {
    return false;
  }
}

function evidenceSources(result: unknown, directories: { outputDir: string; pdfDir: string }): EvidenceSource[] {
  if (!isRecord(result)) {
    return [];
  }

  const sources: EvidenceSource[] = [];
  addSource(sources, "other", result.evidencePath, "application/json", directories.outputDir);

  if (Array.isArray(result.steps)) {
    for (const step of result.steps) {
      if (!isRecord(step)) continue;
      addSource(sources, "request_xml", step.requestPath, "application/xml", directories.outputDir);
      addSource(sources, "response_xml", step.responsePath, "application/xml", directories.outputDir);
    }
  }

  if (isRecord(result.request)) {
    addSource(sources, "request_xml", result.request.path, "application/xml", directories.outputDir);
  }

  if (isRecord(result.response)) {
    addSource(sources, "response_xml", result.response.path, "application/xml", directories.outputDir);
  }

  if (Array.isArray(result.documents)) {
    for (const document of result.documents) {
      if (!isRecord(document)) continue;
      addSource(sources, "pdf", document.path, "application/pdf", directories.pdfDir);
    }
  }

  return [...new Map(sources.map((source) => [`${source.kind}:${source.path}`, source])).values()];
}

function addSource(
  sources: EvidenceSource[],
  kind: DurableEvidenceKind,
  value: unknown,
  contentType: string,
  root: string
): void {
  if (typeof value !== "string" || !value.trim()) {
    return;
  }

  const path = resolve(value);
  const relativePath = relative(resolve(root), path);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("RNDC evidence path is outside the configured storage directory");
  }

  sources.push({ kind, path, contentType });
}

function sanitizeBytes(kind: DurableEvidenceKind, bytes: Uint8Array): Uint8Array {
  if (kind === "pdf") {
    return new Uint8Array(bytes);
  }

  const masked = maskSecrets(Buffer.from(bytes).toString("utf8"))
    .replace(/("(?:password|username|token|serviceToken|ingestKey|apiKey)"\s*:\s*")[^"]*(")/gi, "$1***$2");
  return Buffer.from(masked, "utf8");
}

function readExistingArtifact(value: unknown): ExistingDurableEvidence[] {
  if (!isRecord(value)
    || typeof value._id !== "string"
    || !isDurableEvidenceKind(value.kind)
    || typeof value.fileName !== "string"
    || typeof value.sha256 !== "string"
    || typeof value.size !== "number") {
    return [];
  }

  return [{
    artifactId: value._id,
    kind: value.kind,
    fileName: value.fileName,
    sha256: value.sha256,
    size: value.size
  }];
}

function isDurableEvidenceKind(value: unknown): value is DurableEvidenceKind {
  return value === "request_xml" || value === "response_xml" || value === "pdf" || value === "other";
}

function cleanHeader(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeStorageError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "";
  return message.startsWith("Durable evidence ") || message === "Convex evidence upload failed"
    ? message
    : "Durable evidence source preparation failed";
}
