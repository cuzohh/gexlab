/**
 * Payload shapes for the equity workspace.
 *
 * These were previously eight single-line type aliases at the top of one
 * component file, which is why nothing could be imported without importing the
 * whole page. They are unchanged in shape — only the API routes define what is
 * actually sent, and these must keep matching them.
 */

export type RelativeStrength = {
  periods: number;
  stockReturn: number | null;
  versusQqq: number | null;
  versusSector: number | null;
};

export type AnnualFacts = {
  revenue: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  cash: number | null;
  /** Marketable securities, current and non-current. Part of the net cash bridge. */
  investments: number | null;
  debt: number | null;
  shares: number | null;
  /** Which concept and filing the share count came from, for the reader to judge. */
  sharesSource: string | null;
  dilutedShares: number | null;
  interestExpense: number | null;
  pretaxIncome: number | null;
  incomeTax: number | null;
  stockCompensation: number | null;
  acquisitions: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  depreciation: number | null;
  assets: number | null;
  equity: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  inventory: number | null;
  dividends: number | null;
  dilutedEps: number | null;
  filed: string | null;
  /** Fiscal year end every figure above is read from. Ratios across them are only valid because of it. */
  periodEnd: string | null;
};

export type Fundamentals = {
  company: string | null;
  annual: AnnualFacts;
  ttm: {
    operatingCashFlow: number | null;
    capex: number | null;
    source: string | null;
    filed: string | null;
  };
  history: {
    end: string;
    filed: string | null;
    revenue: number | null;
    operatingCashFlow: number | null;
    capex: number | null;
    grossProfit?: number | null;
    debt?: number | null;
    shares?: number | null;
  }[];
  /** Reported diluted earnings per share by fiscal year, most recent first. */
  epsHistory?: { end: string; value: number }[];
  source: string;
  stale: boolean;
};

export type StockData = {
  symbol: string;
  price: number | null;
  asOf: string | null;
  /** The last bar is the session in progress, so `price` is the last trade rather than a close. */
  intraday?: boolean;
  benchmark: string;
  stale: boolean;
  dayReturn: number | null;
  benchmarkDayReturn: number | null;
  atr14: number | null;
  beta60: number | null;
  /** How much of the stock's daily move the benchmark explains. A weak reading makes the beta unusable. */
  beta60Correlation?: number | null;
  beta60Observations?: number;
  /** Weekly beta against the broad market, shrunk toward one. The cost-of-equity input. */
  valuationBeta?: number | null;
  valuationBetaCorrelation?: number | null;
  valuationBetaWeeks?: number;
  gapRisk60: { average: number | null; p90: number | null; gapsOverTwoPercent: number | null };
  technicals: {
    rsi14: number | null;
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    high52w: number | null;
    low52w: number | null;
    volatility20: number | null;
  };
  swingLow20: number | null;
  swingHigh20: number | null;
  relativeStrength: RelativeStrength[];
  fundamentals?: Fundamentals;
  priceHistory: { date: string; close: number }[];
  /** One-month estimate drift from the local record, for the watchlist table. */
  estimateDrift?: { since: string; epsPercent: number | null; targetPercent: number | null } | null;
  /** Forward-return distributions after comparable setups in this ticker's own history. */
  baseRates?: {
    setup: { rsi: number | null; drawdown: number | null };
    match: { rsiLow: number; rsiHigh: number; drawdownLow: number; drawdownHigh: number } | null;
    outcomes: { horizonDays: number; samples: number; positiveShare: number; median: number; p10: number; p90: number; worst: number; best: number }[];
    matches: number;
    episodes: number;
  } | null;
  caveat: string;
};

export type MacroData = { regime: { posture: string; riskAppetite: number; summary: string } };

export type FlowRow = {
  contract: string;
  expiry: string;
  strike: number;
  type: "call" | "put";
  volume: number;
  openInterestChange: number | null;
  intent: "opened" | "closed" | "churned" | "pending" | "expired" | "unexplained";
  extrinsicNotional: number | null;
  moneyness: number;
};

export type FlowData = {
  session: string;
  rows: FlowRow[];
  summary: {
    contracts: number;
    callNotional: number;
    putNotional: number;
    openedNotional: number;
    closedNotional: number;
    callShare: number | null;
    resolved: boolean;
  };
  method: string;
  caveat: string;
};

export type OptionLevels = {
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
  maxPain: number | null;
  vannaMagnet: number | null;
};

export type OptionBridgeData = {
  error?: string;
  symbol: string;
  /** Delayed-chain provider; never assume a fallback has the same fields. */
  provider?: "cboe" | "nasdaq";
  source?: string;
  coverageNote?: string | null;
  spot: number;
  timestamp: string;
  levels: OptionLevels;
  strikes: { strike: number; gamma: number; delta: number; callVolume: number; putVolume: number }[];
  expiryLevels: { expiry: string; levels: OptionLevels; settlesAt?: string | null }[];
  selection: { expiries: string[] };
  surface: { expiry: string; atmIv: number | null; years: number | null }[];
  expectedMove?: { expiry: string; percent: number; dollars: number } | null;
  /** Constant-DTE ATM-IV percentile over recorded sessions; null until enough history exists. */
  ivRank?: number | null;
  /**
   * Strikes priced away from the volatility curve fitted through their
   * neighbours. Demand for one contract — not a hedging-pressure measure, and
   * not the same thing as the gamma walls above.
   */
  volDislocation?: {
    expiry: string;
    /** Spread of the residuals in volatility points; the threshold scales with it. */
    noise: number;
    rejected: { illiquid: number; unquoted: number; total: number };
    readable: number;
    strikes: {
      strike: number;
      iv: number;
      fitted: number;
      residual: number;
      openInterest: number;
      volume: number;
      relativeSpread: number;
      ivUncertainty: number;
    }[];
  } | null;
  flow?: FlowData | null;
  stale?: boolean;
};

export type CatalystData = {
  irCalendar: string | null;
  filings: { form: string; date: string; url: string; label: string }[];
  stale: boolean;
};

/** The plain quote-page facts: when it reports, what it pays, what it does. */
export type ProfileData = {
  error?: string;
  symbol: string;
  stale?: boolean;
  earningsDate?: string | null;
  exDividendDate?: string | null;
  dividend?: number | null;
  dividendYield?: number | null;
  peRatio?: number | null;
  forwardPe?: number | null;
  beta?: number | null;
  sharesOut?: number | null;
  marketCap?: number | null;
  weekRange?: { low: number; high: number } | null;
  description?: string | null;
  dividendDetail?: {
    dividendYield: number | null;
    annualDividend: number | null;
    exDividendDate: string | null;
    payoutFrequency: string | null;
    payoutRatio: number | null;
    growth1Y: number | null;
    growthYears: number | null;
    buybackYield: number | null;
    shareholderYield: number | null;
  } | null;
  source?: string;
  sourceUrl?: string;
  checkedAt?: string;
};

export type AnalystData = {
  error?: string;
  symbol: string;
  count?: number;
  consensus?: string;
  average?: number | null;
  median?: number | null;
  low?: number | null;
  high?: number | null;
  updated?: string | null;
  source?: string;
  sourceUrl?: string;
  checkedAt?: string;
  /** Reported fiscal years followed by the consensus year, oldest first. */
  fiscalYears?: {
    label: string;
    periodEnding: string | null;
    revenue: number | null;
    revenueGrowth: number | null;
    eps: number | null;
    epsGrowth: number | null;
    netIncome: number | null;
    freeCashFlow: number | null;
    analysts: number | null;
    forecast: boolean;
  }[];
  revenueForecast?: { year: string; high: number | null; average: number | null; low: number | null } | null;
  epsForecast?: { year: string; high: number | null; average: number | null; low: number | null } | null;
  revision?: { comparedTo: string | null; targetChange: number | null; analystCountChange: number | null } | null;
  /** Dated estimate observations and how far they have moved over each window. */
  trend?: {
    points: { date: string; observation: { target: number | null; analysts: number | null; eps: number | null; revenue: number | null; year: string | null } }[];
    windows: {
      label: string;
      days: number;
      comparedTo: string | null;
      targetChange: number | null;
      targetPercent: number | null;
      epsChange: number | null;
      epsPercent: number | null;
      analystChange: number | null;
    }[];
    since: string | null;
  } | null;
};

export type OwnershipData = {
  error?: string;
  symbol: string;
  insiders: {
    date: string | null;
    filed: string;
    owner: string;
    title: string | null;
    code: string | null;
    side: "buy" | "sell" | "other";
    shares: number | null;
    price: number | null;
    value: number | null;
    sharesAfter: number | null;
    url: string;
  }[];
  institutional: {
    asOf: string | null;
    filed: string | null;
    managers: number;
    reportedValue: number | null;
    reportedShares: number | null;
    ownershipPercent: number | null;
    previousReportedValue: number | null;
    changePercent: number | null;
    topHolders: { manager: string; value: number; shares: number; percent: number | null }[];
    source: string;
    sourceUrl: string;
  } | null;
  shortInterest: {
    settlementDate: string | null;
    symbol: string;
    current: number | null;
    previous: number | null;
    changePercent: number | null;
    averageDailyVolume: number | null;
    daysToCover: number | null;
    source: string;
    sourceUrl: string;
  } | null;
  shortSaleVolume: {
    tradeDate: string | null;
    shortVolume: number | null;
    shortExemptVolume: number | null;
    totalVolume: number | null;
    ratio: number | null;
    source: string;
    sourceUrl: string;
  } | null;
  checkedAt: string;
  stale: boolean;
};

/** The detail route's sections. Each one renders and fetches only what it needs. */
export type StockView =
  | "overview"
  | "signals"
  | "flow"
  | "metrics"
  | "sec"
  | "analysts"
  | "ownership"
  | "value"
  | "risk";

export const STOCK_VIEWS: { view: StockView; label: string }[] = [
  { view: "overview", label: "Overview" },
  { view: "signals", label: "Signals" },
  { view: "flow", label: "Flow" },
  { view: "metrics", label: "Metrics" },
  { view: "sec", label: "SEC" },
  { view: "analysts", label: "Analysts" },
  { view: "ownership", label: "Ownership" },
  { view: "value", label: "Value" },
  { view: "risk", label: "Risk" },
];
