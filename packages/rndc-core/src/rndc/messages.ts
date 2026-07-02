import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DemoScenario, RndcConfig, RndcMessageRequest, RndcXmlRecord } from "./types.js";
import { buildRndcXml, maskSecrets, rawXml } from "./xml.js";

type RndcFlowMessage = { name: string; title: string; request: RndcMessageRequest; optional?: boolean };

export function buildFlowMessages(scenario: DemoScenario): RndcFlowMessage[] {
  return [
    ...buildDriverVehicleMessages(scenario),
    {
      name: "sender",
      title: "Crear o actualizar remitente",
      request: createMessage(11, partyVariables(scenario, scenario.sender))
    },
    {
      name: "recipient",
      title: "Crear o actualizar destinatario",
      request: createMessage(11, partyVariables(scenario, scenario.recipient))
    },
    {
      name: "cargo",
      title: "Registrar informacion de carga",
      request: createMessage(1, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        CONSECUTIVOINFORMACIONCARGA: scenario.cargoNumber,
        CODOPERACIONTRANSPORTE: "G",
        CODTIPOEMPAQUE: scenario.cargo.packageCode,
        CODNATURALEZACARGA: scenario.cargo.natureCode,
        DESCRIPCIONCORTAPRODUCTO: scenario.cargo.shortDescription,
        MERCANCIAINFORMACIONCARGA: scenario.cargo.merchandiseCode,
        CANTIDADINFORMACIONCARGA: scenario.cargo.quantityKg,
        UNIDADMEDIDACAPACIDAD: 1,
        CODTIPOIDREMITENTE: scenario.sender.idType,
        NUMIDREMITENTE: scenario.sender.id,
        CODSEDEREMITENTE: scenario.sender.siteCode,
        CODTIPOIDDESTINATARIO: scenario.recipient.idType,
        NUMIDDESTINATARIO: scenario.recipient.id,
        CODSEDEDESTINATARIO: scenario.recipient.siteCode,
        PACTOTIEMPOCARGUE: "SI",
        HORASPACTOCARGA: 1,
        MINUTOSPACTOCARGA: 0,
        PACTOTIEMPODESCARGUE: "SI",
        HORASPACTODESCARGUE: 2,
        MINUTOSPACTODESCARGUE: 0,
        OBSERVACIONES: scenario.observations,
        FECHACITAPACTADACARGUE: scenario.loadingAppointmentDate,
        HORACITAPACTADACARGUE: scenario.loadingAppointmentTime,
        FECHACITAPACTADADESCARGUE: scenario.unloadingAppointmentDate,
        HORACITAPACTADADESCARGUEREMESA: scenario.unloadingAppointmentTime
      })
    },
    {
      name: "trip",
      title: "Registrar informacion de viaje",
      request: createMessage(2, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        CONSECUTIVOINFORMACIONVIAJE: scenario.tripNumber,
        CODIDCONDUCTOR: scenario.driver.idType,
        NUMIDCONDUCTOR: scenario.driver.id,
        NUMPLACA: scenario.vehicle.plate,
        NUMPLACAREMOLQUE: scenario.vehicle.trailerPlate,
        CODMUNICIPIOORIGENINFOVIAJE: scenario.sender.cityCode,
        CODMUNICIPIODESTINOINFOVIAJE: scenario.recipient.cityCode,
        VALORFLETEPACTADOVIAJE: scenario.money.freightValue,
        PREREMESAS: rawXml([
          '<PREREMESAS procesoid="44">',
          "<MANPREREMESA>",
          `<CONSECUTIVOINFORMACIONCARGA>${scenario.cargoNumber}</CONSECUTIVOINFORMACIONCARGA>`,
          "</MANPREREMESA>",
          "</PREREMESAS>"
        ].join(""))
      })
    },
    {
      name: "remesa",
      title: "Expedir remesa terrestre de carga",
      request: createMessage(3, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        CONSECUTIVOREMESA: scenario.remesaNumber,
        CONSECUTIVOINFORMACIONCARGA: scenario.cargoNumber,
        CODOPERACIONTRANSPORTE: "G",
        CODNATURALEZACARGA: scenario.cargo.natureCode,
        CANTIDADCARGADA: scenario.cargo.quantityKg,
        UNIDADMEDIDACAPACIDAD: 1,
        CODTIPOEMPAQUE: scenario.cargo.packageCode,
        MERCANCIAREMESA: scenario.cargo.merchandiseCode,
        DESCRIPCIONCORTAPRODUCTO: scenario.cargo.shortDescription,
        CODTIPOIDREMITENTE: scenario.sender.idType,
        NUMIDREMITENTE: scenario.sender.id,
        CODSEDEREMITENTE: scenario.sender.siteCode,
        CODTIPOIDDESTINATARIO: scenario.recipient.idType,
        NUMIDDESTINATARIO: scenario.recipient.id,
        CODSEDEDESTINATARIO: scenario.recipient.siteCode,
        DUENOPOLIZA: "E",
        NUMPOLIZATRANSPORTE: `159${scenario.seed.slice(-8)}`,
        FECHAVENCIMIENTOPOLIZACARGA: scenario.vehicle.soatExpirationDate,
        COMPANIASEGURO: scenario.vehicle.insurerNit,
        HORASPACTOCARGA: 1,
        MINUTOSPACTOCARGA: 0,
        HORASPACTODESCARGUE: 2,
        MINUTOSPACTODESCARGUE: 0,
        CODTIPOIDPROPIETARIO: scenario.sender.idType,
        NUMIDPROPIETARIO: scenario.sender.id,
        CODSEDEPROPIETARIO: scenario.sender.siteCode,
        FECHACITAPACTADACARGUE: scenario.loadingAppointmentDate,
        HORACITAPACTADACARGUE: scenario.loadingAppointmentTime,
        FECHACITAPACTADADESCARGUE: scenario.unloadingAppointmentDate,
        HORACITAPACTADADESCARGUEREMESA: scenario.unloadingAppointmentTime
      })
    },
    {
      name: "manifest",
      title: "Expedir manifiesto de carga",
      request: createMessage(4, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        NUMMANIFIESTOCARGA: scenario.manifestNumber,
        CONSECUTIVOINFORMACIONVIAJE: scenario.tripNumber,
        CODOPERACIONTRANSPORTE: "G",
        FECHAEXPEDICIONMANIFIESTO: scenario.expeditionDate,
        CODMUNICIPIOORIGENMANIFIESTO: scenario.sender.cityCode,
        CODMUNICIPIODESTINOMANIFIESTO: scenario.recipient.cityCode,
        CODIDTITULARMANIFIESTO: scenario.vehicleHolder.idType,
        NUMIDTITULARMANIFIESTO: scenario.vehicleHolder.id,
        NUMPLACA: scenario.vehicle.plate,
        NUMPLACAREMOLQUE: scenario.vehicle.trailerPlate,
        CODIDCONDUCTOR: scenario.driver.idType,
        NUMIDCONDUCTOR: scenario.driver.id,
        VALORFLETEPACTADOVIAJE: scenario.money.freightValue,
        RETENCIONICAMANIFIESTOCARGA: scenario.money.icaRetentionPerMille,
        RETENCIONFOPAT: scenario.money.fopatRetention,
        VALORANTICIPOMANIFIESTO: scenario.money.advanceValue,
        CODMUNICIPIOPAGOSALDO: scenario.recipient.cityCode,
        FECHAPAGOSALDOMANIFIESTO: scenario.balancePaymentDate,
        CODRESPONSABLEPAGOCARGUE: "R",
        CODRESPONSABLEPAGODESCARGUE: "D",
        ACEPTACIONELECTRONICA: "SI",
        OBSERVACIONES: scenario.observations,
        REMESASMAN: rawXml([
          '<REMESASMAN procesoid="43">',
          "<REMESA>",
          `<CONSECUTIVOREMESA>${scenario.remesaNumber}</CONSECUTIVOREMESA>`,
          "</REMESA>",
          "</REMESASMAN>"
        ].join(""))
      })
    }
  ];
}

export function buildDriverVehicleMessages(scenario: DemoScenario): RndcFlowMessage[] {
  const people = uniqueRolePeople([
    { name: "driver", title: "Crear o actualizar conductor", person: scenario.driver },
    { name: "owner", title: "Crear o actualizar propietario del vehiculo", person: scenario.vehicleOwner },
    { name: "holder", title: "Crear o actualizar tenedor del vehiculo", person: scenario.vehicleHolder }
  ]);

  return [
    ...people.map(({ name, title, person }) => ({
      name,
      title,
      request: createMessage(11, personVariables(scenario, person))
    })),
    {
      name: "vehicle",
      title: "Crear o actualizar vehiculo",
      request: createMessage(12, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        NUMPLACA: scenario.vehicle.plate,
        CODCONFIGURACIONUNIDADCARGA: scenario.vehicle.rndcConfigurationCode,
        CODMARCAVEHICULOCARGA: 1,
        CODLINEAVEHICULOCARGA: scenario.vehicle.lineCode,
        ANOFABRICACIONVEHICULOCARGA: scenario.vehicle.modelYear,
        CODTIPOIDPROPIETARIO: scenario.vehicleOwner.idType,
        NUMIDPROPIETARIO: scenario.vehicleOwner.id,
        CODTIPOIDTENEDOR: scenario.vehicleHolder.idType,
        NUMIDTENEDOR: scenario.vehicleHolder.id,
        CODTIPOCOMBUSTIBLE: 1,
        PESOVEHICULOVACIO: scenario.vehicle.emptyWeightKg,
        CAPACIDADUNIDADCARGA: scenario.vehicle.capacityKg,
        CODCOLORVEHICULOCARGA: scenario.vehicle.colorCode,
        CODTIPOCARROCERIA: 0,
        UNIDADMEDIDACAPACIDAD: 1,
        NUMNITASEGURADORASOAT: scenario.vehicle.insurerNit,
        FECHAVENCIMIENTOSOAT: scenario.vehicle.soatExpirationDate,
        NUMSEGUROSOAT: scenario.vehicle.soatNumber
      })
    }
  ];
}

export function buildMtmProductionFlowMessages(scenario: DemoScenario): RndcFlowMessage[] {
  const messages = buildFlowMessages(scenario);
  const wanted = ["cargo", "trip", "remesa", "manifest"];
  return wanted.map((name) => {
    const message = messages.find((item) => item.name === name);
    if (!message) {
      throw new Error(`Missing RNDC flow message: ${name}`);
    }
    return message;
  });
}

export function buildLoadingOrderMessages(scenario: DemoScenario): RndcFlowMessage[] {
  const messages = buildFlowMessages(scenario);
  return [
    renameMessage(findMessage(messages, "cargo"), "issue-loading-order", "Registrar informacion de carga (orden de cargue)")
  ];
}

export function buildRemesaMessages(scenario: DemoScenario): RndcFlowMessage[] {
  const messages = buildFlowMessages(scenario);
  return [
    renameMessage(findMessage(messages, "remesa"), "issue-remesa")
  ];
}

export function buildManifestMessages(scenario: DemoScenario): RndcFlowMessage[] {
  const messages = buildFlowMessages(scenario);
  return [
    renameMessage(findMessage(messages, "trip"), "register-trip"),
    renameMessage(findMessage(messages, "manifest"), "issue-manifest")
  ];
}

export function buildIssuanceMessages(scenario: DemoScenario): RndcFlowMessage[] {
  const messages = buildFlowMessages(scenario);
  return [
    renameMessage(findMessage(messages, "remesa"), "issue-remesa"),
    renameMessage(findMessage(messages, "manifest"), "issue-manifest")
  ];
}

export function buildComplianceMessages(scenario: DemoScenario): { name: string; title: string; request: RndcMessageRequest }[] {
  const compliance = scenario.compliance;

  return [
    {
      name: "fulfill-remesa",
      title: "Cumplir remesa terrestre de carga",
      request: createMessage(5, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        CONSECUTIVOREMESA: scenario.remesaNumber,
        TIPOCUMPLIDOREMESA: compliance.remesaType,
        CANTIDADCARGADA: compliance.loadedQuantityKg,
        CANTIDADENTREGADA: compliance.deliveredQuantityKg,
        UNIDADMEDIDACAPACIDAD: compliance.unitCode,
        FECHALLEGADACARGUE: compliance.loadingArrivalDate,
        HORALLEGADACARGUEREMESA: compliance.loadingArrivalTime,
        FECHAENTRADACARGUE: compliance.loadingEntryDate,
        HORAENTRADACARGUEREMESA: compliance.loadingEntryTime,
        FECHASALIDACARGUE: compliance.loadingExitDate,
        HORASALIDACARGUEREMESA: compliance.loadingExitTime,
        FECHALLEGADADESCARGUE: compliance.unloadingArrivalDate,
        HORALLEGADADESCARGUECUMPLIDO: compliance.unloadingArrivalTime,
        FECHAENTRADADESCARGUE: compliance.unloadingEntryDate,
        HORAENTRADADESCARGUECUMPLIDO: compliance.unloadingEntryTime,
        FECHASALIDADESCARGUE: compliance.unloadingExitDate,
        HORASALIDADESCARGUECUMPLIDO: compliance.unloadingExitTime,
        OBSERVACIONES: compliance.observations
      })
    },
    {
      name: "fulfill-manifest",
      title: "Cumplir manifiesto de carga",
      request: createMessage(6, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        NUMMANIFIESTOCARGA: scenario.manifestNumber,
        TIPOCUMPLIDOMANIFIESTO: compliance.manifestType,
        FECHAENTREGADOCUMENTOS: compliance.documentsDeliveryDate,
        VALORADICIONALHORASCARGUE: compliance.additionalLoadHoursValue,
        VALORADICIONALHORASDESCARGUE: compliance.additionalUnloadHoursValue,
        VALORADICIONALFLETE: compliance.additionalFreightValue,
        VALORDESCUENTOFLETE: compliance.freightDiscountValue,
        VALORSOBREANTICIPO: compliance.overAdvanceValue,
        OBSERVACIONES: compliance.observations
      })
    }
  ];
}

export function buildAnnulmentMessages(scenario: { company: { rndcNit: string }; cargoNumber: string; tripNumber: string; remesaNumber: string; manifestNumber: string }): { name: string; title: string; request: RndcMessageRequest; optional?: boolean }[] {
  return [
    {
      name: "annul-manifest-compliance",
      title: "Anular cumplido de manifiesto",
      optional: true,
      request: createMessage(29, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        NUMMANIFIESTOCARGA: scenario.manifestNumber,
        CODMOTIVOANULACIONCUMPLIDO: "O",
        OBSERVACIONES: "ANULACION DE CUMPLIDO DE MANIFIESTO POR REVERSO OPERATIVO"
      })
    },
    {
      name: "annul-remesa-compliance",
      title: "Anular cumplido de remesa",
      optional: true,
      request: createMessage(28, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        CONSECUTIVOREMESA: scenario.remesaNumber,
        CODMOTIVOANULACIONCUMPLIDO: "O",
        OBSERVACIONES: "ANULACION DE CUMPLIDO DE REMESA POR REVERSO OPERATIVO"
      })
    },
    {
      name: "annul-manifest",
      title: "Anular manifiesto de carga",
      request: createMessage(32, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        NUMMANIFIESTOCARGA: scenario.manifestNumber,
        MOTIVOANULACIONMANIFIESTO: "S",
        OBSERVACIONES: "ANULACION DE MANIFIESTO POR REVERSO OPERATIVO"
      })
    },
    {
      name: "annul-remesa",
      title: "Anular remesa terrestre de carga",
      request: createMessage(9, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        CONSECUTIVOREMESA: scenario.remesaNumber,
        MOTIVOREVERSAREMESA: "A",
        MOTIVOANULACIONREMESA: "S",
        OBSERVACIONES: "ANULACION DE REMESA POR REVERSO OPERATIVO"
      })
    },
    {
      name: "annul-trip-information",
      title: "Anular informacion del viaje",
      request: createMessage(8, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        CONSECUTIVOINFORMACIONVIAJE: scenario.tripNumber,
        MOTIVOANULACIONINFOVIAJE: "S"
      })
    },
    {
      name: "annul-cargo-information",
      title: "Anular informacion de carga",
      request: createMessage(7, {
        NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
        CONSECUTIVOINFORMACIONCARGA: scenario.cargoNumber,
        MOTIVOANULACIONINFOCARGA: "S"
      })
    }
  ];
}

export function buildOperationMessages(scenario: DemoScenario): { name: string; title: string; request: RndcMessageRequest }[] {
  return [
    ...buildLoadingOrderMessages(scenario),
    ...buildIssuanceMessages(scenario),
    ...buildComplianceMessages(scenario),
    ...buildAnnulmentMessages(scenario)
  ];
}

export async function prepareOperationRequests(config: RndcConfig, scenario: DemoScenario): Promise<{
  ok: true;
  runDirectory: string;
  resultPath: string;
  requests: { name: string; title: string; tipo: number; procesoId: number; path: string }[];
}> {
  const startedAt = new Date().toISOString();
  const runDirectory = join(config.outputDir, `${startedAt.replaceAll(":", "-")}-${scenario.seed}-operations`);
  const requestDirectory = join(runDirectory, "requests");
  await mkdir(requestDirectory, { recursive: true });
  const requests = [];

  for (const [index, message] of buildOperationMessages(scenario).entries()) {
    const path = join(requestDirectory, `${String(index + 1).padStart(2, "0")}-${message.name}.xml`);
    const xml = maskSecrets(buildRndcXml(config, message.request));
    await writeFile(path, `${xml}\n`, "utf8");
    requests.push({
      name: message.name,
      title: message.title,
      tipo: Number(message.request.tipo),
      procesoId: Number(message.request.procesoId),
      path
    });
  }

  const resultPath = join(runDirectory, "operations.json");
  await writeFile(resultPath, `${JSON.stringify({ ok: true, runDirectory, requests }, null, 2)}\n`, "utf8");

  return {
    ok: true,
    runDirectory,
    resultPath,
    requests
  };
}

function createMessage(procesoId: number, variables: RndcXmlRecord): RndcMessageRequest {
  return {
    tipo: 1,
    procesoId,
    variables
  };
}

function personVariables(scenario: DemoScenario, person: DemoScenario["driver"]): RndcXmlRecord {
  return {
    NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
    CODTIPOIDTERCERO: person.idType,
    NUMIDTERCERO: person.id,
    NOMIDTERCERO: person.firstName,
    PRIMERAPELLIDOIDTERCERO: person.firstLastName,
    SEGUNDOAPELLIDOIDTERCERO: person.secondLastName,
    NUMTELEFONOCONTACTO: person.phone,
    NUMCELULARPERSONA: person.phone,
    NOMENCLATURADIRECCION: person.address,
    CODMUNICIPIORNDC: person.cityCode,
    CODCATEGORIALICENCIACONDUCCION: person.licenseCategory,
    NUMLICENCIACONDUCCION: person.licenseNumber,
    FECHAVENCIMIENTOLICENCIA: person.licenseExpirationDate
  };
}

function partyVariables(scenario: DemoScenario, party: DemoScenario["sender"]): RndcXmlRecord {
  return {
    NUMNITEMPRESATRANSPORTE: scenario.company.rndcNit,
    CODTIPOIDTERCERO: party.idType,
    NUMIDTERCERO: party.id,
    NOMIDTERCERO: party.name,
    CODSEDETERCERO: party.siteCode,
    NOMSEDETERCERO: party.siteName,
    NUMTELEFONOCONTACTO: scenario.company.phone,
    NUMCELULARPERSONA: scenario.company.phone,
    NOMENCLATURADIRECCION: party.address,
    CODMUNICIPIORNDC: party.cityCode,
    LATITUD: party.latitude,
    LONGITUD: party.longitude
  };
}

function uniqueRolePeople(roles: { name: string; title: string; person: DemoScenario["driver"] }[]): { name: string; title: string; person: DemoScenario["driver"] }[] {
  const seen = new Set<string>();
  const people = [];

  for (const role of roles) {
    const key = `${role.person.idType}:${role.person.id}`.toUpperCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    people.push(role);
  }

  return people;
}

function findMessage(messages: RndcFlowMessage[], name: string): RndcFlowMessage {
  const message = messages.find((item) => item.name === name);

  if (!message) {
    throw new Error(`Missing RNDC flow message: ${name}`);
  }

  return message;
}

function renameMessage(message: RndcFlowMessage, name: string, title = message.title): RndcFlowMessage {
  return {
    ...message,
    name,
    title
  };
}
