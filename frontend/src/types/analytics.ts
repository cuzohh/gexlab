export interface AnalyticsSummary {
  totalNetGex: number;
  totalNetDex: number;
  spotPrice: number;
  riskFreeRate: number;
  timestamp: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  polling: boolean;
}

export interface StrikeAnalytics {
  strike: number;
  gex: number;
  dex: number;
  vex: number;
  chex?: number;
  vega?: number;
  charm?: number;
  openInterest: number;
  volume: number;
  iv: number;
}

export interface RawContract {
  expiry: string;
  type: 'call' | 'put';
  strike: number;
  openInterest?: number;
  impliedVolatility?: number;
  volume?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  vanna?: number;
  charm?: number;
  iv?: number;
  gex?: number;
  dex?: number;
  vex?: number;
  chex?: number;
}

export interface SurfaceData {
  expiries: string[];
  strikes: number[];
  matrix: number[][];
}

export interface MajorWall {
  strike: number;
  gex: number;
}

export interface DexLevelsData {
  flip?: number;
  callWall?: number;
  putWall?: number;
  majorWalls?: {
    calls: MajorWall[];
    puts: MajorWall[];
  };
}

export interface DerivedLevelsData {
  sessionFloor?: number;
  oiCallWall?: number;
  oiPutWall?: number;
  weakCallOIStrike?: number;
  weakPutOIStrike?: number;
  protectedGammaHigh?: number;
  protectedGammaLow?: number;
  aggressiveCallCeiling?: number;
  aggressivePutFloor?: number;
  skewRichStrike?: number;
  skewCheapStrike?: number;
}

export interface LevelsData {
  gammaFlip?: number;
  callWall?: number;
  putWall?: number;
  sessionCeiling?: number;
  maxPain?: number;
  vannaMagnet?: number;
  majorWalls?: {
    calls: MajorWall[];
    puts: MajorWall[];
  };
  dex?: DexLevelsData;
  derived?: DerivedLevelsData;
  byDte?: DteLevelsData[];
}

export interface DteLevelsData {
  dte: number;
  expiry: string;
  gammaFlip?: number;
  callWall?: number;
  putWall?: number;
  sessionCeiling?: number;
  maxPain?: number;
  vannaMagnet?: number;
  majorWalls?: {
    calls: MajorWall[];
    puts: MajorWall[];
  };
  dex?: DexLevelsData;
  derived?: DerivedLevelsData;
}

export interface AnalyticsResponse {
  summary: AnalyticsSummary;
  strikes: StrikeAnalytics[];
  surface: SurfaceData;
  raw: RawContract[];
  levels?: LevelsData;
}

export interface BridgePayloadResponse {
  payload: string;
  timestamp?: string;
  error?: string;
}

export interface BasisData {
  etf_price: number;
  future_price: number;
  basis: number;
  futures_ticker?: string;
}

export interface RawMetricsResponse {
  metrics: Record<string, Record<string, unknown>>;
  basis: Record<string, BasisData>;
}

export interface SnapshotDatesResponse {
  ticker: string;
  dates: string[];
}

export interface HistoricalSnapshotResponse {
  ticker: string;
  date: string;
  savedAt: string;
  source: string;
  raw: Record<string, unknown>;
  basis: BasisData;
  analytics: AnalyticsResponse;
}

export interface MacroEvent {
  date: string;
  label: string;
  source: string;
  category: string;
  impact: 'high' | 'medium' | 'low' | string;
  note: string;
  releaseTimeEt?: string;
  expected?: string | null;
  actual?: string | null;
  previous?: string | null;
}

export interface MacroEventsResponse {
  events: MacroEvent[];
}
