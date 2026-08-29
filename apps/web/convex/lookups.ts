import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireActor } from "./model/access";
import { normalizeSearchText } from "./model/searchText";

const LIMIT = 12;

const divisionInputValidator = v.object({
  code: v.string(),
  name: v.string(),
  zoneCode: v.string(),
  isMunicipality: v.boolean(),
  onRoad: v.boolean(),
  municipalityCode: v.string(),
  municipalityName: v.string(),
  departmentCode: v.string(),
  departmentName: v.string(),
  latitude: v.optional(v.string()),
  longitude: v.optional(v.string()),
  searchText: v.string(),
  rndcRegisteredAt: v.optional(v.string()),
  source: v.string()
});

const divisionOptionValidator = v.object({
  code: v.string(),
  name: v.string(),
  isMunicipality: v.boolean(),
  municipalityName: v.string(),
  departmentName: v.string()
});

const partyOptionValidator = v.object({
  _id: v.id("thirdParties"),
  document: v.string(),
  documentType: v.string(),
  name: v.string(),
  address: v.optional(v.string()),
  city: v.optional(v.string()),
  cityCode: v.optional(v.string()),
  phone: v.optional(v.string()),
  siteCount: v.optional(v.number())
});

const siteOptionValidator = v.object({
  _id: v.id("thirdPartySites"),
  siteCode: v.string(),
  siteName: v.string(),
  address: v.optional(v.string()),
  city: v.optional(v.string()),
  cityCode: v.optional(v.string())
});

const roleValidator = v.union(
  v.literal("driver"),
  v.literal("owner"),
  v.literal("possessor"),
  v.literal("holder"),
  v.literal("sender"),
  v.literal("recipient"),
  v.literal("insured"),
  v.literal("insurance_company"),
  v.literal("transport_company"),
  v.literal("legal_representative"),
  v.literal("commercial"),
  v.literal("consignee"),
  v.literal("employee"),
  v.literal("logistics_operator"),
  v.literal("fiscal_reviewer"),
  v.literal("other")
);

function isDocumentTerm(term: string): boolean {
  return /^[0-9][0-9.\-]*$/.test(term);
}

function partyOption(party: Doc<"thirdParties">) {
  return {
    _id: party._id,
    document: party.document,
    documentType: party.documentType,
    name: party.name,
    address: party.address,
    city: party.city,
    cityCode: party.cityCode,
    phone: party.cellphone ?? party.phone,
    siteCount: party.siteCount
  };
}

export const partiesSearch = query({
  args: { term: v.string(), role: v.optional(roleValidator) },
  returns: v.array(partyOptionValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const term = args.term.trim();
    if (term.length < 2) return [];
    let parties: Doc<"thirdParties">[];
    if (isDocumentTerm(term)) {
      const prefix = term.replace(/[.\-]/g, "");
      parties = await ctx.db
        .query("thirdParties")
        .withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).gte("document", prefix).lt("document", prefix + "￿"))
        .take(LIMIT * 2);
    } else {
      parties = await ctx.db
        .query("thirdParties")
        .withSearchIndex("search_name", (q) => q.search("name", term).eq("organizationId", actor.organizationId))
        .take(LIMIT * 2);
    }
    const role = args.role;
    const preferred = role ? parties.filter((party) => party.roles.includes(role)) : parties;
    const rest = role ? parties.filter((party) => !party.roles.includes(role)) : [];
    return [...preferred, ...rest].slice(0, LIMIT).map(partyOption);
  }
});

export const partySites = query({
  args: { thirdPartyId: v.id("thirdParties") },
  returns: v.array(siteOptionValidator),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const party = await ctx.db.get("thirdParties", args.thirdPartyId);
    if (!party || party.organizationId !== actor.organizationId) return [];
    const sites = await ctx.db.query("thirdPartySites").withIndex("by_third_party", (q) => q.eq("thirdPartyId", party._id)).take(200);
    return sites
      .sort((a, b) => Number(a.siteCode) - Number(b.siteCode) || a.siteCode.localeCompare(b.siteCode))
      .map((site) => ({ _id: site._id, siteCode: site.siteCode, siteName: site.siteName, address: site.address, city: site.city, cityCode: site.cityCode }));
  }
});

function matchesEveryTerm(searchText: string, terms: string[]): boolean {
  const words = searchText.split(" ");
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}

export const divisionsSearch = query({
  args: { term: v.string() },
  returns: v.array(divisionOptionValidator),
  handler: async (ctx, args) => {
    await requireActor(ctx);
    const term = normalizeSearchText(args.term);
    if (term.length < 2) return [];
    const terms = term.split(" ");
    const municipalities = (await ctx.db
      .query("rndcDivisions")
      .withSearchIndex("search_text", (q) => q.search("searchText", term).eq("isMunicipality", true))
      .take(60)).filter((row) => matchesEveryTerm(row.searchText, terms)).slice(0, 8);
    const zones = (await ctx.db
      .query("rndcDivisions")
      .withSearchIndex("search_text", (q) => q.search("searchText", term).eq("isMunicipality", false))
      .take(60)).filter((row) => matchesEveryTerm(row.searchText, terms)).slice(0, LIMIT - municipalities.length);
    return [...municipalities, ...zones].map((row) => ({ code: row.code, name: row.name, isMunicipality: row.isMunicipality, municipalityName: row.municipalityName, departmentName: row.departmentName }));
  }
});

export const divisionByCode = query({
  args: { code: v.string() },
  returns: v.union(divisionOptionValidator, v.null()),
  handler: async (ctx, args) => {
    await requireActor(ctx);
    const code = args.code.trim().padStart(8, "0");
    const row = await ctx.db.query("rndcDivisions").withIndex("by_code", (q) => q.eq("code", code)).unique();
    return row ? { code: row.code, name: row.name, isMunicipality: row.isMunicipality, municipalityName: row.municipalityName, departmentName: row.departmentName } : null;
  }
});

export const packagingSearch = query({
  args: { term: v.string() },
  returns: v.array(v.object({ code: v.string(), description: v.string(), fullDescription: v.string() })),
  handler: async (ctx, args) => {
    await requireActor(ctx);
    const term = args.term.trim();
    const rows = term
      ? await ctx.db.query("rndcPackaging").withSearchIndex("search_description", (q) => q.search("fullDescription", term)).take(LIMIT)
      : await ctx.db.query("rndcPackaging").withIndex("by_code").take(LIMIT);
    return rows.map((row) => ({ code: row.code, description: row.description, fullDescription: row.fullDescription }));
  }
});

export const insurersSearch = query({
  args: { term: v.string() },
  returns: v.array(v.object({ insurerNit: v.string(), name: v.string() })),
  handler: async (ctx, args) => {
    await requireActor(ctx);
    const term = args.term.trim();
    if (!term) return [];
    const rows = isDocumentTerm(term)
      ? await ctx.db.query("rndcInsurers").withIndex("by_nit", (q) => q.gte("insurerNit", term).lt("insurerNit", term + "￿")).take(LIMIT)
      : await ctx.db.query("rndcInsurers").withSearchIndex("search_name", (q) => q.search("name", term)).take(LIMIT);
    return rows.map((row) => ({ insurerNit: row.insurerNit, name: row.name }));
  }
});

export const vehicleLinesSearch = query({
  args: { term: v.string() },
  returns: v.array(v.object({
    makeCode: v.string(),
    makeName: v.optional(v.string()),
    lineCode: v.string(),
    lineName: v.optional(v.string()),
    grossWeightKg: v.number()
  })),
  handler: async (ctx, args) => {
    await requireActor(ctx);
    const term = args.term.trim();
    if (!term) return [];
    const normalizedCode = term.toUpperCase().replace(/\s+/g, "");
    const codeLike = /^[A-Z0-9]+$/.test(normalizedCode);
    const [makeMatches, lineCodeMatches, makeNameMatches, lineNameMatches] = await Promise.all([
      codeLike
        ? ctx.db.query("rndcVehicleLines").withIndex("by_make_and_line", (q) => q.gte("makeCode", normalizedCode).lt("makeCode", normalizedCode + "￿")).take(LIMIT)
        : Promise.resolve([]),
      codeLike
        ? ctx.db.query("rndcVehicleLines").withIndex("by_line_and_make", (q) => q.gte("lineCode", normalizedCode).lt("lineCode", normalizedCode + "￿")).take(LIMIT)
        : Promise.resolve([]),
      ctx.db.query("rndcVehicleLines").withSearchIndex("search_make", (q) => q.search("makeName", term)).take(LIMIT),
      ctx.db.query("rndcVehicleLines").withSearchIndex("search_line", (q) => q.search("lineName", term)).take(LIMIT)
    ]);
    const unique = new Map<string, Doc<"rndcVehicleLines">>();
    for (const row of [...makeMatches, ...lineCodeMatches, ...makeNameMatches, ...lineNameMatches]) {
      unique.set(`${row.makeCode}:${row.lineCode}`, row);
    }
    return [...unique.values()].slice(0, LIMIT).map((row) => ({
      makeCode: row.makeCode,
      makeName: row.makeName,
      lineCode: row.lineCode,
      lineName: row.lineName,
      grossWeightKg: row.grossWeightKg
    }));
  }
});

export const bodyTypesSearch = query({
  args: { term: v.string() },
  returns: v.array(v.object({ code: v.string(), description: v.string() })),
  handler: async (ctx, args) => {
    await requireActor(ctx);
    const term = args.term.trim();
    if (!term) return [];
    const normalizedCode = term.toUpperCase().replace(/\s+/g, "");
    const [codeMatches, descriptionMatches] = await Promise.all([
      ctx.db.query("rndcBodyTypes").withIndex("by_code", (q) => q.gte("code", normalizedCode).lt("code", normalizedCode + "￿")).take(LIMIT),
      ctx.db.query("rndcBodyTypes").withSearchIndex("search_description", (q) => q.search("description", term)).take(LIMIT)
    ]);
    const unique = new Map<string, Doc<"rndcBodyTypes">>();
    for (const row of [...codeMatches, ...descriptionMatches]) unique.set(row.code, row);
    return [...unique.values()].slice(0, LIMIT).map((row) => ({ code: row.code, description: row.description }));
  }
});

export const trailersSearch = query({
  args: { term: v.string() },
  returns: v.array(v.object({
    _id: v.id("trailers"),
    plate: v.string(),
    trailerType: v.optional(v.string()),
    configuration: v.optional(v.string()),
    status: v.union(v.literal("available"), v.literal("assigned"), v.literal("maintenance"), v.literal("inactive"))
  })),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const prefix = args.term.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!prefix) return [];
    const trailers = await ctx.db
      .query("trailers")
      .withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).gte("plate", prefix).lt("plate", prefix + "￿"))
      .take(LIMIT);
    return trailers.map((trailer) => ({
      _id: trailer._id,
      plate: trailer.plate,
      trailerType: trailer.trailerType,
      configuration: trailer.configuration,
      status: trailer.status
    }));
  }
});

export const vehiclesWithDriversSearch = query({
  args: { term: v.string() },
  returns: v.array(v.object({
    _id: v.id("vehicles"),
    plate: v.string(),
    make: v.optional(v.string()),
    line: v.optional(v.string()),
    modelYear: v.optional(v.string()),
    color: v.optional(v.string()),
    trailer: v.optional(v.string()),
    configuration: v.optional(v.string()),
    capacityTn: v.optional(v.string()),
    status: v.optional(v.string()),
    soatExpiresAt: v.optional(v.string()),
    drivers: v.array(v.object({ _id: v.id("drivers"), document: v.string(), name: v.optional(v.string()), phone: v.optional(v.string()), licenseCategory: v.optional(v.string()), licenseExpiresAt: v.optional(v.string()) }))
  })),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const prefix = args.term.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!prefix) return [];
    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_organization_and_plate", (q) => q.eq("organizationId", actor.organizationId).gte("plate", prefix).lt("plate", prefix + "￿"))
      .take(LIMIT);
    return await Promise.all(vehicles.map(async (vehicle) => {
      const relations = await ctx.db.query("driverVehicles").withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id)).take(20);
      const drivers = (await Promise.all(relations.map(async (relation) => {
        const driver = await ctx.db.get("drivers", relation.driverId);
        return driver ? { _id: driver._id, document: driver.document, name: driver.name, phone: driver.cellphone ?? driver.phone1 ?? driver.phone2, licenseCategory: driver.licenseCategory, licenseExpiresAt: driver.licenseExpiresAt } : null;
      }))).filter((driver): driver is NonNullable<typeof driver> => driver !== null);
      return { _id: vehicle._id, plate: vehicle.plate, make: vehicle.make, line: vehicle.line, modelYear: vehicle.modelYear, color: vehicle.color, trailer: vehicle.trailer, configuration: vehicle.configuration, capacityTn: vehicle.capacityTn, status: vehicle.status, soatExpiresAt: vehicle.soatExpiresAt, drivers };
    }));
  }
});

export const driversLookup = query({
  args: { term: v.string() },
  returns: v.array(v.object({ _id: v.id("drivers"), document: v.string(), name: v.optional(v.string()), phone: v.optional(v.string()), licenseCategory: v.optional(v.string()), licenseExpiresAt: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const term = args.term.trim();
    if (term.length < 2) return [];
    const drivers = isDocumentTerm(term)
      ? await ctx.db.query("drivers").withIndex("by_organization_and_document", (q) => q.eq("organizationId", actor.organizationId).gte("document", term).lt("document", term + "￿")).take(LIMIT)
      : await ctx.db.query("drivers").withSearchIndex("search_name", (q) => q.search("name", term).eq("organizationId", actor.organizationId)).take(LIMIT);
    return drivers.map((driver) => ({ _id: driver._id, document: driver.document, name: driver.name, phone: driver.cellphone ?? driver.phone1 ?? driver.phone2, licenseCategory: driver.licenseCategory, licenseExpiresAt: driver.licenseExpiresAt }));
  }
});

export const upsertDivisionBatch = mutation({
  args: { ingestKey: v.string(), divisions: v.array(divisionInputValidator) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    if (args.ingestKey !== process.env.RNDC_INGEST_KEY) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid ingest key" });
    }
    const now = Date.now();
    const result = { inserted: 0, updated: 0 };
    for (const division of args.divisions) {
      const existing = await ctx.db.query("rndcDivisions").withIndex("by_code", (q) => q.eq("code", division.code)).unique();
      if (existing) {
        await ctx.db.patch(existing._id, { ...division, updatedAt: now });
        result.updated += 1;
      } else {
        await ctx.db.insert("rndcDivisions", { ...division, createdAt: now, updatedAt: now });
        result.inserted += 1;
      }
    }
    return result;
  }
});
