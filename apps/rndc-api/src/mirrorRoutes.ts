import type express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildFailureResponse,
  buildRndcXml,
  buildMirrorQuery,
  maskSecrets,
  readMirrorResponse,
  RndcClient,
} from "@tms/rndc-core";
import type { RndcConfig } from "@tms/rndc-core";

export function registerMirrorRoutes(
  app: express.Express,
  readConfig: () => RndcConfig,
) {
  app.get("/rndc/mirror", async (req, res) => {
    if (process.env.RNDC_MIRROR_ENABLED !== "true") {
      res
        .status(503)
        .json({ error: "El espejo RNDC de sólo lectura no está habilitado." });
      return;
    }
    if (
      !process.env.RNDC_MIRROR_ORGANIZATION_ID ||
      req.header("X-TMS-Organization-Id") !==
        process.env.RNDC_MIRROR_ORGANIZATION_ID
    ) {
      res
        .status(403)
        .json({ error: "La conexión RNDC no pertenece a esta organización." });
      return;
    }
    const config = {
      ...readConfig(),
      mode: "live" as const,
      transport: "soap" as const,
      environment: "primary" as const,
      timeoutMs: Number(process.env.RNDC_MIRROR_TIMEOUT_MS ?? 120000),
    };
    if (
      !Number.isSafeInteger(config.timeoutMs) ||
      config.timeoutMs < 1000 ||
      config.timeoutMs > 180000
    ) {
      res
        .status(503)
        .json({
          error:
            "El tiempo de espera del espejo debe estar entre 1000 y 180000 ms.",
        });
      return;
    }
    let request;
    const from = String(req.query.from ?? ""),
      to = String(req.query.to ?? ""),
      processId = Number(req.query.process);
    try {
      if (
        Object.keys(req.query).some(
          (key) => !["from", "to", "process"].includes(key),
        )
      )
        throw new Error("Parámetros de consulta no permitidos.");
      request = buildMirrorQuery(config.companyRndcNit, processId, from, to);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Consulta inválida.",
      });
      return;
    }
    const id = randomUUID(),
      startedAt = new Date().toISOString();
    const redact = (value: string) =>
      [config.username, config.password]
        .filter(Boolean)
        .reduce(
          (text, secret) => text.replaceAll(secret, "***"),
          maskSecrets(value),
        );
    let response;
    try {
      response = await new RndcClient(config).sendMessage(request);
    } catch (error) {
      response = buildFailureResponse(config, request, error);
      response.requestXml = redact(buildRndcXml(config, request));
    }
    const finishedAt = new Date().toISOString();
    let records: Record<string, string>[] = [],
      error: string | undefined;
    try {
      if (response.status === 0)
        throw new Error(response.errorText ?? "No se pudo conectar al RNDC.");
      records = readMirrorResponse(response, from, to);
    } catch (failure) {
      error = redact(
        failure instanceof Error ? failure.message : "Consulta fallida.",
      );
    }
    const directory = join(config.outputDir, "mirror", id);
    const metadata = {
      id,
      companyRndcNit: config.companyRndcNit,
      process: processId,
      from,
      to,
      startedAt,
      finishedAt,
      ok: !error,
      tipo: 3,
      mode: "live",
      transport: "soap",
      httpStatus: response.status,
      count: records.length,
      error,
    };
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const [name, value] of Object.entries({
        "request.xml": response.requestXml,
        "response.xml": response.rndcResponseXml,
        "soap-response.xml": response.soapResponse,
        "parsed.json": JSON.stringify(response.parsed),
        "metadata.json": JSON.stringify(metadata),
        "records.json": JSON.stringify(records),
      }))
        await writeFile(join(directory, name), redact(value), { mode: 0o600 });
    } catch {
      res
        .status(503)
        .json({ error: "No se pudo conservar la evidencia de la consulta." });
      return;
    }
    if (error) {
      res.status(502).json({ ...metadata, error });
      return;
    }
    res.json({
      ...metadata,
      records,
      evidence: {
        requestXml: redact(response.requestXml),
        responseXml: redact(response.rndcResponseXml),
        parsedJson: redact(JSON.stringify(response.parsed)),
      },
    });
  });
}
