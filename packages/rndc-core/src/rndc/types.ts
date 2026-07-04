export type RndcEnvironment = "test" | "primary" | "secondary";

export type RndcMode = "dry-run" | "live";

export type RndcTransport = "soap" | "wstest";

export type RndcEndpointTarget = "test" | "primary" | "secondary" | "queries";

export type RndcScalar = string | number | boolean;

export type RndcRawXml = {
  kind: "rawXml";
  xml: string;
};

export type RndcXmlValue = RndcScalar | RndcRawXml | null | undefined;

export type RndcXmlRecord = Record<string, RndcXmlValue>;

export type RndcConfig = {
  mode: RndcMode;
  transport: RndcTransport;
  environment: RndcEnvironment;
  endpointUrl: string;
  wstestUrl: string;
  endpointUrls: Record<RndcEndpointTarget, string>;
  wstestUrls: Record<RndcEndpointTarget, string>;
  endpointUrlOverride?: string;
  wstestUrlOverride?: string;
  username: string;
  password: string;
  companyNit: string;
  companyDv: string;
  companyRndcNit: string;
  timeoutMs: number;
  outputDir: string;
  pdfDir: string;
  localDataDir: string;
};

export type RndcMessageRequest = {
  tipo: string | number;
  procesoId: string | number;
  variables?: RndcXmlRecord | string;
  documento?: RndcXmlRecord;
  documentorango?: RndcXmlRecord;
};

export type RndcMessageResponse = {
  endpointUrl: string;
  requestXml: string;
  soapRequest: string;
  soapResponse: string;
  rndcResponseXml: string;
  parsed: unknown;
  status: number;
  ok: boolean;
  mode: RndcMode;
  transport: RndcTransport;
  errorText?: string;
  radicado?: string;
  seguridadQr?: string;
  observacionesQr?: string;
};

export type FlowStepName =
  | "driver"
  | "owner"
  | "holder"
  | "sender"
  | "recipient"
  | "vehicle"
  | "cargo"
  | "trip"
  | "remesa"
  | "manifest";

export type RndcFlowStep = {
  name: FlowStepName;
  title: string;
  tipo: number;
  procesoId: number;
  response: RndcMessageResponse;
  accepted: boolean;
  requestPath?: string;
  responsePath?: string;
};

export type PersonData = {
  idType: string;
  id: string;
  firstName: string;
  firstLastName: string;
  secondLastName: string;
  fullName: string;
  phone: string;
  address: string;
  cityName: string;
  cityCode: string;
  licenseCategory?: string;
  licenseNumber?: string;
  licenseExpirationDate?: string;
};

export type CompanyParty = {
  idType: string;
  id: string;
  siteCode: string;
  siteName: string;
  name: string;
  address: string;
  cityName: string;
  cityCode: string;
  latitude: string;
  longitude: string;
};

export type VehicleData = {
  plate: string;
  trailerPlate: string;
  brand: string;
  configuration: string;
  rndcConfigurationCode: string;
  lineCode: string;
  colorCode: string;
  modelYear: string;
  emptyWeightKg: number;
  capacityKg: number;
  soatNumber: string;
  soatExpirationDate: string;
  insurerNit: string;
};

export type CargoData = {
  productName: string;
  shortDescription: string;
  merchandiseCode: string;
  packageName: string;
  packageCode: string;
  nature: string;
  natureCode: string;
  quantityKg: number;
  declaredValue: number;
};

export type MoneyData = {
  freightValue: number;
  advanceValue: number;
  sourceRetention: number;
  icaRetention: number;
  icaRetentionPerMille: number;
  fopatRetention: number;
};

export type ComplianceData = {
  remesaType: string;
  manifestType: string;
  remesaSuspensionReason?: string;
  manifestSuspensionReason?: string;
  suspensionConsequence?: string;
  loadedQuantityKg: number;
  deliveredQuantityKg: number;
  unitCode: number;
  loadingArrivalDate: string;
  loadingArrivalTime: string;
  loadingEntryDate: string;
  loadingEntryTime: string;
  loadingExitDate: string;
  loadingExitTime: string;
  unloadingArrivalDate: string;
  unloadingArrivalTime: string;
  unloadingEntryDate: string;
  unloadingEntryTime: string;
  unloadingExitDate: string;
  unloadingExitTime: string;
  documentsDeliveryDate: string;
  additionalLoadHoursValue: number;
  additionalUnloadHoursValue: number;
  additionalFreightValue: number;
  additionalValueReason?: string;
  freightDiscountValue: number;
  discountReason?: string;
  overAdvanceValue: number;
  observations: string;
};

export type DemoScenario = {
  seed: string;
  company: {
    nit: string;
    dv: string;
    rndcNit: string;
    name: string;
    address: string;
    phone: string;
    cityName: string;
  };
  driver: PersonData;
  vehicleOwner: PersonData;
  vehicleHolder: PersonData;
  sender: CompanyParty;
  recipient: CompanyParty;
  vehicle: VehicleData;
  cargo: CargoData;
  money: MoneyData;
  cargoNumber: string;
  tripNumber: string;
  remesaNumber: string;
  manifestNumber: string;
  expeditionDate: string;
  loadingAppointment: string;
  loadingAppointmentDate: string;
  loadingAppointmentTime: string;
  unloadingAppointment: string;
  unloadingAppointmentDate: string;
  unloadingAppointmentTime: string;
  balancePaymentDate: string;
  observations: string;
  compliance: ComplianceData;
};

export type GeneratedDocument = {
  kind: "loading-order" | "remesa" | "manifest";
  number: string;
  path: string;
  urlPath: string;
};

export type RndcFlowResult = {
  ok: boolean;
  mode: RndcMode;
  transport: RndcTransport;
  environment: RndcEnvironment;
  endpointUrl: string;
  seed: string;
  startedAt: string;
  finishedAt: string;
  companyNit: string;
  companyDv: string;
  companyRndcNit: string;
  cargoNumber: string;
  tripNumber: string;
  remesaNumber: string;
  manifestNumber: string;
  remesaAuthorization?: string;
  manifestAuthorization?: string;
  seguridadQr?: string;
  observacionesQr?: string;
  runDirectory?: string;
  evidencePath?: string;
  documents: GeneratedDocument[];
  steps: RndcFlowStep[];
};
