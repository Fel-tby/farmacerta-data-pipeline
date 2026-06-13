import cmedPricesData from "./cmed-prices.json";
import type dashboardData from "./municipios/pb/campina-grande/dashboard.json";
import type regionalPartnersData from "./municipios/pb/campina-grande/regional-partners.json";

export type RiskLevel = "baixo" | "moderado" | "alto" | "critico";

export type StockStatus =
  | "Estoque zero"
  | "Vencido"
  | "Vence em 30 dias"
  | "Vence em 60 dias"
  | "Com saldo"
  | "Realocar";

export type UnitPoint = {
  cnes: string;
  name: string;
  neighborhood: string;
  address: string;
  lat: number;
  lon: number;
  zeroRows: number;
  expiredRows: number;
  expiringRows: number;
  positiveRows: number;
  score: number;
  riskLevel: RiskLevel;
  topAction: string;
};

export type StockRow = {
  id: number;
  unit: string;
  cnes: string;
  neighborhood: string;
  product: string;
  code: string;
  normalizedCode: string | null;
  lot: string;
  validity: string;
  daysToExpire: number | null;
  stock: number;
  status: StockStatus;
  severity: RiskLevel;
  program: string;
  programCode: string;
  origin: string;
  source: "BNAFAR";
};

export type MedicationSummary = {
  product: string;
  code: string;
  normalizedCode: string | null;
  programs: string[];
  totalStock: number;
  unitCount: number;
  unitsWithStock: number;
  zeroUnits: number;
  zeroUnitNames: string[];
  expiredRows: number;
  expiringRows: number;
  status: string;
  severity: RiskLevel;
  hasPriceReferencePB: boolean;
  lots: Array<{
    unit: string;
    cnes: string;
    lot: string;
    validity: string;
    daysToExpire: number | null;
    stock: number;
    status: string;
  }>;
};

export type CriticalItem = StockRow & {
  action?: string;
  evidence?: string;
};

export type RelocationSuggestion = {
  product: string;
  code: string;
  zeroUnits: string[];
  donorUnits: Array<{ unit: string; stock: number }>;
  availableStock: number;
};

export type ExpirationLot = {
  unit: string;
  cnes: string;
  product: string;
  code: string;
  lot: string;
  validity: string;
  days: number;
  stock: number;
  status: string;
  severity: RiskLevel;
  source: "BNAFAR";
};

export type PriceReference = {
  product: string;
  code: string;
  medianPB: number | null;
  observationsPB: number;
  medianBrazil: number | null;
  observationsBrazil: number;
};

export type DashboardData = typeof dashboardData;

export type PartnerProduct = {
  catmat: string;
  produto: string;
  estoqueCG: number;
  estoqueParceiro: number;
};

export type RegionalPartner = {
  cod: string;
  municipio: string;
  distKm: number;
  produtosZeradosEmComum: number;
  produtos: PartnerProduct[];
};

export type RegionalPartnersPayload = {
  meta: {
    geradoEm: string;
    municipioBase: string;
    codIBGEBase: string;
    fonte: string;
    raioBuscaKm: number;
    totalProdutosZeradosCG: number;
    totalMunicipiosParceiros: number;
  };
  produtosZeradosCG: { catmat: string; produto: string }[];
  parceiros: RegionalPartner[];
};

export type CmedPriceItem = {
  substancia: string;
  produto: string;
  apresentacao: string;
  ggrem: string;
  registro: string;
  classeTerapeutica: string;
  tarja: string;
  restricaoHospitalar: boolean;
  pfSemImpostos: number | null;
  pmvgSemImpostos: number | null;
  pmvg0pct: number | null;
  pmvg12pct: number | null;
  pmvg17pct: number | null;
};

export type CmedPricesPayload = {
  meta: {
    fonte: string;
    dataPublicacao: string;
    totalRegistros: number;
    totalSubstancias: number;
    nota: string;
  };
  produtos: CmedPriceItem[];
};

export const cmedPrices = cmedPricesData as CmedPricesPayload;

export type MunicipalityIndexEntry = {
  slug: string;
  name: string;
  uf: string;
  generatedAt: string;
};

export async function loadDashboard(uf: string, slug: string): Promise<DashboardData> {
  return import(`./municipios/${uf.toLowerCase()}/${slug}/dashboard.json`).then(m => m.default as DashboardData);
}

export async function loadRegionalPartners(uf: string, slug: string): Promise<RegionalPartnersPayload> {
  return import(`./municipios/${uf.toLowerCase()}/${slug}/regional-partners.json`).then(m => m.default as RegionalPartnersPayload);
}

export async function getMunicipalityList(): Promise<MunicipalityIndexEntry[]> {
  return import("./municipios/index.json").then(m => m.default as MunicipalityIndexEntry[]);
}
