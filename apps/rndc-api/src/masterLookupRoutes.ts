import type express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildFailureResponse,
  buildThirdPartyMasterQuery,
  buildVehicleMasterQuery,
  maskSecrets,
  normalizeThirdPartyMaster,
  normalizeVehicleMaster,
  RndcClient
} from "@tms/rndc-core";
import type { RndcConfig, RndcMessageRequest, RndcMessageResponse } from "@tms/rndc-core";

export type OwnershipParty = {
  idType: string;
  id: string;
  name?: string;
  phone?: string;
  cityCode?: string;
};

export type VehicleOwnershipResult = {
  ok: boolean;
  found: boolean;
  simulated: boolean;
  plate: string;
  queriedAt: string;
  owner?: OwnershipParty;
  holder?: OwnershipParty;
  error?: string;
};

const PLATE_PATTERN = /^[A-Z0-9]{5,7}$/;

export function registerMasterLookupRoutes(app: express.Express, readConfig: () => RndcConfig, clientFor: (config: RndcConfig) => Pick<RndcClient, "sendMessage"> = (config) => new RndcClient(config)) {
  app.get("/rndc/masters/vehicle-ownership", async (req, res) => {
    const plate = String(req.query.plate ?? "").trim().toUpperCase();

    if (!PLATE_PATTERN.test(plate) || Object.keys(req.query).some((key) => key !== "plate")) {
      res.status(400).json({ ok: false, error: "Indica una placa válida." });
      return;
    }

    const base = readConfig();
    const readOnlyLive = process.env.RNDC_MIRROR_ENABLED === "true"
      && Boolean(process.env.RNDC_MIRROR_ORGANIZATION_ID)
      && req.header("X-TMS-Organization-Id") === process.env.RNDC_MIRROR_ORGANIZATION_ID;
    const config: RndcConfig = readOnlyLive
      ? { ...base, mode: "live", transport: "soap", environment: "primary" }
      : base;
    const simulated = config.mode !== "live";
    const client = clientFor(config);
    const redact = (value: string) => [config.username, config.password]
      .filter(Boolean)
      .reduce((text, secret) => text.replaceAll(secret, "***"), maskSecrets(value));
    const evidence: Record<string, string> = {};
    const send = async (name: string, request: RndcMessageRequest): Promise<RndcMessageResponse> => {
      let response: RndcMessageResponse;
      try {
        response = await client.sendMessage(request);
      } catch (error) {
        response = buildFailureResponse(config, request, error);
      }
      evidence[`${name}-request.xml`] = redact(response.requestXml ?? "");
      evidence[`${name}-response.xml`] = redact(response.rndcResponseXml ?? "");
      return response;
    };
    const queriedAt = new Date().toISOString();
    const result: VehicleOwnershipResult = { ok: false, found: false, simulated, plate, queriedAt };
    let status = 200;

    const vehicleResponse = await send("vehicle", buildVehicleMasterQuery({ companyRndcNit: config.companyRndcNit, plate }));
    const vehicle = normalizeVehicleMaster(vehicleResponse.parsed);

    if (vehicleResponse.status === 0) {
      status = 502;
      result.error = "No se pudo conectar con el RNDC. Intenta de nuevo en unos minutos.";
    } else if (!vehicle) {
      status = 404;
      result.error = /no encontrado/i.test(vehicleResponse.errorText ?? "") || !vehicleResponse.errorText
        ? "El RNDC no tiene esta placa en el maestro de vehículos de la empresa."
        : redact(vehicleResponse.errorText);
    } else {
      result.ok = true;
      result.found = true;
      const lookups: Array<["owner" | "holder", string | undefined, string | undefined]> = [
        ["owner", vehicle.ownerIdType, vehicle.ownerId],
        ["holder", vehicle.holderIdType, vehicle.holderId]
      ];
      const cache = new Map<string, OwnershipParty>();

      for (const [role, idType, id] of lookups) {
        if (!id) continue;
        const type = (idType ?? "C").toUpperCase();
        const key = `${type}-${id}`;
        let party = cache.get(key);

        if (!party) {
          const response = await send(role, buildThirdPartyMasterQuery({ companyRndcNit: config.companyRndcNit, idType: type, id }));
          const master = normalizeThirdPartyMaster(response.parsed);
          party = {
            idType: type,
            id,
            name: master && master.fullName !== master.id ? master.fullName : undefined,
            phone: master?.phone && master.phone !== "0" ? master.phone : undefined,
            cityCode: master?.cityCode
          };
          cache.set(key, party);
        }

        result[role] = party;
      }
    }

    try {
      const directory = join(config.outputDir, "master-lookups", randomUUID());
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const [name, value] of Object.entries({ ...evidence, "result.json": JSON.stringify(result) })) {
        await writeFile(join(directory, name), value, { mode: 0o600 });
      }
    } catch {
      res.status(503).json({ ok: false, error: "No se pudo conservar la evidencia de la consulta." });
      return;
    }

    res.status(status).json(result);
  });
}
