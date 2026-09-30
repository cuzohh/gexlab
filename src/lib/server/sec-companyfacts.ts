import "server-only";

import { dedupeRequest } from "@/lib/server/request-deduper";
import { findIssuer } from "@/lib/server/sec-tickers";
import { secRequestHeaders } from "@/lib/server/sec-request";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";

// v5 anchors every annual figure to one fiscal period end. Saved v4 snapshots
// mix years and must not be reused. v7 revised the share count and the net cash
// bridge; v8 adds the reported per-share history, which earlier snapshots lack.
const SOURCE_VERSION = "sec-companyfacts-v9";
const CACHE_MS = 24 * 60 * 60 * 1000;

// Annual figures also arrive on an amended 10-K, and foreign private issuers
// report on 20-F or 40-F rather than a 10-K at all. Reading only "10-K" left
// those issuers with an empty fact set and no fiscal year to anchor to.
const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
const PERIODIC_FORMS = new Set([...ANNUAL_FORMS, "10-Q", "10-Q/A"]);

type Fact = { start?: string; end?: string; filed?: string; form?: string; fy?: number; fp?: string; val?: number; frame?: string; accn?: string };
type Concepts = Record<string, { units?: Record<string, Fact[]> }>;
// Share counts are cover-page facts and live in the `dei` namespace, not
// `us-gaap`. Looking only at us-gaap meant EntityCommonStockSharesOutstanding
// never resolved, so every share count was null and the DCF could never run.
type CompanyFacts = { entityName?: string; facts?: { "us-gaap"?: Concepts; dei?: Concepts } };

export type StockFundamentals = {
  company: string | null;
  cik: number | null;
  annual: { revenue: number | null; netIncome: number | null; operatingCashFlow: number | null; capex: number | null; cash: number | null; investments: number | null; debt: number | null; shares: number | null; sharesSource: string | null; dilutedShares: number | null; interestExpense: number | null; pretaxIncome: number | null; incomeTax: number | null; stockCompensation: number | null; acquisitions: number | null; grossProfit: number | null; operatingIncome: number | null; depreciation: number | null; assets: number | null; equity: number | null; currentAssets: number | null; currentLiabilities: number | null; inventory: number | null; dividends: number | null; dilutedEps: number | null; filed: string | null; periodEnd: string | null };
  ttm: { operatingCashFlow: number | null; capex: number | null; source: string | null; filed: string | null };
  history: { end: string; filed: string | null; revenue: number | null; operatingCashFlow: number | null; capex: number | null; grossProfit: number | null; debt: number | null; shares: number | null }[];
  /** Reported diluted earnings per share by fiscal year, most recent first. */
  epsHistory: { end: string; value: number }[];
  source: "SEC Companyfacts" | "Unavailable";
  stale: boolean;
};

/**
 * A fact covers one fiscal year.
 *
 * Duration facts carry a start; instant facts (every balance-sheet line) do
 * not. A 10-K also tags fourth-quarter-only durations as `fp: "FY"`, so a
 * period length check is the only thing separating a full year from a quarter.
 */
function isFullYear(row: Fact) {
  if (!row.start || !row.end) return true;
  const days = (Date.parse(row.end) - Date.parse(row.start)) / 86_400_000;
  return days >= 300 && days <= 400;
}

function annualRows(facts: CompanyFacts, name: string) {
  const concept = facts.facts?.["us-gaap"]?.[name] ?? facts.facts?.dei?.[name];
  return Object.values(concept?.units ?? {})
    .flat()
    .filter((row) => ANNUAL_FORMS.has(row.form ?? "") && row.fp === "FY" && row.end && Number.isFinite(row.val) && isFullYear(row));
}

/**
 * The fiscal year every annual figure is read from.
 *
 * Each concept used to be resolved on its own, and a concept the issuer stopped
 * tagging simply froze at the last year it appeared. NVDA came back with FY2022
 * revenue beside FY2026 net income and cash flow, which is why the interface
 * reported a 466% free-cash-flow margin and a net income larger than sales.
 * Anchoring to one period end makes a ratio across two lines meaningful, and
 * anything the issuer did not tag for that year stays null rather than being
 * silently filled from an older filing.
 */
function fiscalPeriodEnd(facts: CompanyFacts, anchors: string[]) {
  let latest: string | null = null;
  for (const name of anchors) {
    for (const row of annualRows(facts, name)) {
      if (!latest || row.end! > latest) latest = row.end!;
    }
  }
  return latest;
}

/** The first of `names` the issuer tagged for `end`, most recent restatement first. */
function factAt(facts: CompanyFacts, names: string[], end: string | null) {
  if (!end) return null;
  for (const name of names) {
    const rows = annualRows(facts, name).filter((row) => row.end === end);
    if (rows.length) return rows.sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? ""))[0];
  }
  return null;
}

/**
 * The last five fiscal years of one line, merged across the concepts that can
 * carry it.
 *
 * Returning the first concept that had any rows at all was the same mistake
 * `latestAnnual` made. An issuer that re-tags a line mid-history then produces
 * a series covering only the years using the older concept: NVDA's revenue came
 * back as one row from FY2022 and its capital expenditure as none, so the
 * free-cash-flow history rendered empty while the current-year figures beside
 * it were present. Each year is now filled from the first concept that reports
 * it, and a later restatement of the same concept wins over the original.
 */
function annualSeries(facts: CompanyFacts, names: string[]) {
  const byEnd = new Map<string, { end: string; filed: string | null; value: number; rank: number }>();
  names.forEach((name, rank) => {
    for (const row of annualRows(facts, name)) {
      const existing = byEnd.get(row.end!);
      const better =
        !existing || rank < existing.rank || (rank === existing.rank && (row.filed ?? "") > (existing.filed ?? ""));
      if (better) byEnd.set(row.end!, { end: row.end!, filed: row.filed ?? null, value: row.val!, rank });
    }
  });
  return [...byEnd.values()]
    .sort((left, right) => right.end.localeCompare(left.end))
    .slice(0, 5)
    .map(({ end, filed, value }) => ({ end, filed, value }));
}

/**
 * The most recently reported value, from any periodic filing.
 *
 * Used for the cover-page share count, which is stated as of the filing date
 * rather than the fiscal year end, so it is deliberately not period-anchored.
 *
 * `notBefore` is what stops a long-dead fact from being served as current. The
 * cover-page count of a multi-class issuer is tagged per class, and companyfacts
 * carries only the undimensioned facts, so Berkshire's newest untagged count is
 * from a 2011 10-Q and Visa's from 2010. Returning those produced a share count
 * three orders of magnitude too small and a Berkshire fair value of $509,588 a
 * share. A stale fact is now no different from a missing one.
 */
function latestReported(facts: CompanyFacts, names: string[], notBefore: string | null) {
  for (const name of names) {
    const concept = facts.facts?.["us-gaap"]?.[name] ?? facts.facts?.dei?.[name];
    const rows = Object.values(concept?.units ?? {})
      .flat()
      .filter((row) => PERIODIC_FORMS.has(row.form ?? "") && Number.isFinite(row.val) && row.val! > 0 && (!notBefore || (row.end ?? "") >= notBefore));
    if (rows.length) return rows.sort((a, b) => `${b.filed ?? ""}${b.end ?? ""}`.localeCompare(`${a.filed ?? ""}${a.end ?? ""}`))[0];
  }
  return null;
}

/** One year before `periodEnd`: the oldest date a "current" share count may carry. */
function oneYearBefore(periodEnd: string | null) {
  if (!periodEnd) return null;
  const date = new Date(Date.parse(periodEnd) - 365 * 86_400_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * The CIK that actually filed these facts.
 *
 * A reorganisation moves the ticker to a new holding-company CIK whose
 * companyfacts starts empty — Exxon's CIK 2115436 carries two facts and no
 * annual filing at all, so every fundamental resolved to null and the valuation
 * reported no share data. The accession number on the newest fact names the
 * filer, which is where the history still lives.
 */
function filerCik(facts: CompanyFacts) {
  let newest: Fact | null = null;
  for (const namespace of [facts.facts?.["us-gaap"], facts.facts?.dei]) {
    for (const concept of Object.values(namespace ?? {})) {
      for (const rows of Object.values(concept.units ?? {})) {
        for (const row of rows) {
          if (row.accn && row.filed && (!newest || row.filed > newest.filed!)) newest = row;
        }
      }
    }
  }
  const digits = newest?.accn?.split("-")[0];
  return digits && /^\d{10}$/.test(digits) ? digits : null;
}

function ttmFromYtd(facts: CompanyFacts, names: string[], annual: Fact | null) {
  const gaap = facts.facts?.["us-gaap"];
  if (!annual || !annual.fy) return null;
  for (const name of names) {
    const rows = Object.values(gaap?.[name]?.units ?? {}).flat().filter((row) => row.form === "10-Q" && ["Q1", "Q2", "Q3"].includes(row.fp ?? "") && row.fy && Number.isFinite(row.val));
    const current = rows.filter((row) => row.fy! > annual.fy!).sort((a, b) => `${b.filed ?? ""}${b.end ?? ""}`.localeCompare(`${a.filed ?? ""}${a.end ?? ""}`))[0];
    if (!current) continue;
    const prior = rows.filter((row) => row.fp === current.fp && row.fy === current.fy! - 1).sort((a, b) => `${b.filed ?? ""}${b.end ?? ""}`.localeCompare(`${a.filed ?? ""}${a.end ?? ""}`))[0];
    if (prior && annual.fy === current.fy! - 1) return { value: annual.val! + current.val! - prior.val!, filed: current.filed ?? null, source: `FY${annual.fy} + ${current.fp} FY${current.fy} − ${current.fp} FY${prior.fy}` };
  }
  return null;
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, { headers: secRequestHeaders(), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`SEC request returned ${response.status}`);
  return response.json() as Promise<T>;
}

async function collect(symbol: string): Promise<Omit<StockFundamentals, "stale">> {
  const entry = await findIssuer(symbol);
  if (!entry) throw new Error("Ticker is not an SEC reporting issuer.");
  const cik = entry.cik;
  let facts = await fetchJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  const REVENUE_NAMES = ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "Revenues"];
  const OPERATING_CASH_FLOW_NAMES = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"];
  const CAPEX_NAMES = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"];
  const ANCHORS = [...REVENUE_NAMES, "NetIncomeLoss", ...OPERATING_CASH_FLOW_NAMES, "Assets"];
  // The income statement, cash flow statement, and balance sheet all close on
  // the same date, so any one of them identifies the year to read.
  let periodEnd = fiscalPeriodEnd(facts, ANCHORS);
  if (!periodEnd) {
    // No annual filing under this CIK: follow the accession number to the CIK
    // that filed, which is where a reorganised issuer's history stayed.
    const filer = filerCik(facts);
    if (filer && filer !== cik) {
      const prior = await fetchJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${filer}.json`);
      const priorEnd = fiscalPeriodEnd(prior, ANCHORS);
      if (priorEnd) {
        facts = prior;
        periodEnd = priorEnd;
      }
    }
  }
  const at = (names: string[]) => factAt(facts, names, periodEnd);

  const revenue = at(REVENUE_NAMES);
  const netIncome = at(["NetIncomeLoss"]);
  const operatingCashFlow = at(OPERATING_CASH_FLOW_NAMES);
  const capex = at(CAPEX_NAMES);
  const cash = at(["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]);
  const debtCurrent = at(["LongTermDebtAndFinanceLeaseObligationsCurrent", "LongTermDebtCurrent"]);
  const debtNoncurrent = at(["LongTermDebtAndFinanceLeaseObligationsNoncurrent", "LongTermDebtNoncurrent"]);
  const totalDebt = at(["LongTermDebtAndFinanceLeaseObligations", "LongTermDebt"]);
  // Prefer the balance-sheet current + non-current components. Some issuers report
  // only a total; use that only when the components are unavailable.
  const debtValue = debtCurrent || debtNoncurrent
    ? (debtCurrent?.val ?? 0) + (debtNoncurrent?.val ?? 0)
    : totalDebt?.val ?? null;
  // Cash alone is not the liquid balance. Excluding marketable securities while
  // subtracting the whole debt balance is asymmetric, and it removed $96B of
  // Alphabet's and $92B of Microsoft's net cash from the valuation bridge.
  const investmentsCurrent = at(["MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "ShortTermInvestments", "OtherShortTermInvestments"]);
  const investmentsNoncurrent = at(["MarketableSecuritiesNoncurrent", "AvailableForSaleSecuritiesDebtSecuritiesNoncurrent", "LongTermInvestments"]);
  const investmentsValue = investmentsCurrent || investmentsNoncurrent ? (investmentsCurrent?.val ?? 0) + (investmentsNoncurrent?.val ?? 0) : null;
  // Do not fall back to equity-account facts here: a DCF needs a share count,
  // and an unavailable count is safer than dividing by a dollar balance.
  //
  // The cover-page count is the right one, but it is tagged per share class by
  // multi-class issuers and companyfacts drops dimensioned facts, so Alphabet
  // and Meta have none at all. The balance-sheet and weighted-average counts
  // cover every class in one figure and stand in when the cover page cannot.
  // Issued shares last: it counts treasury stock the outstanding lines do not.
  const SHARE_NAMES = [
    "EntityCommonStockSharesOutstanding",
    "CommonStockSharesOutstanding",
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageNumberOfSharesOutstandingBasic",
    "CommonStockSharesIssued",
  ];
  const shares = (() => {
    const floor = oneYearBefore(periodEnd);
    for (const name of SHARE_NAMES) {
      const row = latestReported(facts, [name], floor);
      if (row) return { row, name };
    }
    return null;
  })();
  const dilutedShares = at(["WeightedAverageNumberOfDilutedSharesOutstanding"]);
  const interestExpense = at(["InterestExpenseNonoperating", "InterestExpenseDebt"]);
  const pretaxIncome = at(["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"]);
  const incomeTax = at(["IncomeTaxExpenseBenefit"]);
  const stockCompensation = at(["ShareBasedCompensation"]);
  const acquisitions = at(["PaymentsToAcquireBusinessesNetOfCashAcquired"]);
  const grossProfit = at(["GrossProfit"]);
  const operatingIncome = at(["OperatingIncomeLoss"]);
  const depreciation = at(["DepreciationDepletionAndAmortization", "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment"]);
  const assets = at(["Assets"]);
  const equity = at(["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]);
  const currentAssets = at(["AssetsCurrent"]);
  const currentLiabilities = at(["LiabilitiesCurrent"]);
  const inventory = at(["InventoryNet"]);
  const dividends = at(["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"]);
  const dilutedEps = at(["EarningsPerShareDiluted"]);
  const ttmOperatingCashFlow = ttmFromYtd(facts, OPERATING_CASH_FLOW_NAMES, operatingCashFlow);
  const ttmCapex = ttmFromYtd(facts, CAPEX_NAMES, capex);
  const revenues = annualSeries(facts, REVENUE_NAMES);
  const operatingCashFlows = annualSeries(facts, OPERATING_CASH_FLOW_NAMES);
  const capexes = new Map(annualSeries(facts, CAPEX_NAMES).map((row) => [row.end, row]));
  const revenueByEnd = new Map(revenues.map((row) => [row.end, row]));
  // The lines a deterioration check reads. One value per fiscal year each, so
  // the series costs a few dozen numbers rather than another request.
  const grossProfits = new Map(annualSeries(facts, ["GrossProfit"]).map((row) => [row.end, row]));
  const debts = new Map(annualSeries(facts, ["LongTermDebtAndFinanceLeaseObligationsNoncurrent", "LongTermDebtNoncurrent", "LongTermDebt"]).map((row) => [row.end, row]));
  const shareCounts = new Map(annualSeries(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"]).map((row) => [row.end, row]));
  // The publisher gates its own per-share history behind a subscription, so the
  // reported half of the earnings chart comes from the filings instead.
  const epsHistory = annualSeries(facts, ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"]).map((row) => ({ end: row.end, value: row.value }));
  const history = operatingCashFlows.map((row) => ({ end: row.end, filed: row.filed, revenue: revenueByEnd.get(row.end)?.value ?? null, operatingCashFlow: row.value, capex: capexes.get(row.end)?.value ?? null, grossProfit: grossProfits.get(row.end)?.value ?? null, debt: debts.get(row.end)?.value ?? null, shares: shareCounts.get(row.end)?.value ?? null }));
  return {
    company: facts.entityName ?? entry.title,
    cik: entry.cikNumber,
    annual: { revenue: revenue?.val ?? null, netIncome: netIncome?.val ?? null, operatingCashFlow: operatingCashFlow?.val ?? null, capex: capex?.val ?? null, cash: cash?.val ?? null, investments: investmentsValue, debt: debtValue, shares: shares?.row.val ?? null, sharesSource: shares ? `${shares.name} · ${shares.row.form ?? "filing"} ${shares.row.end ?? ""}`.trim() : null, dilutedShares: dilutedShares?.val ?? null, interestExpense: interestExpense?.val ?? null, pretaxIncome: pretaxIncome?.val ?? null, incomeTax: incomeTax?.val ?? null, stockCompensation: stockCompensation?.val ?? null, acquisitions: acquisitions?.val ?? null, grossProfit: grossProfit?.val ?? null, operatingIncome: operatingIncome?.val ?? null, depreciation: depreciation?.val ?? null, assets: assets?.val ?? null, equity: equity?.val ?? null, currentAssets: currentAssets?.val ?? null, currentLiabilities: currentLiabilities?.val ?? null, inventory: inventory?.val ?? null, dividends: dividends?.val ?? null, dilutedEps: dilutedEps?.val ?? null, filed: revenue?.filed ?? netIncome?.filed ?? operatingCashFlow?.filed ?? null, periodEnd }, epsHistory, ttm: { operatingCashFlow: ttmOperatingCashFlow?.value ?? null, capex: ttmCapex?.value ?? null, source: ttmOperatingCashFlow && ttmCapex ? `${ttmOperatingCashFlow.source}; ${ttmCapex.source}` : null, filed: ttmOperatingCashFlow?.filed ?? ttmCapex?.filed ?? null }, history,
    source: "SEC Companyfacts",
  };
}

/** The saved fact set, if still fresh, without touching the network. */
export function peekStockFundamentals(symbol: string): StockFundamentals | null {
  const stored = getSnapshot<Omit<StockFundamentals, "stale">>("stock-fundamentals", symbol.toUpperCase());
  return stored?.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(stored) ? { ...stored.payload, stale: false } : null;
}

export async function loadStockFundamentals(symbol: string): Promise<StockFundamentals> {
  const key = symbol.toUpperCase();
  const stored = getSnapshot<Omit<StockFundamentals, "stale">>("stock-fundamentals", key);
  if (stored?.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(stored)) return { ...stored.payload, stale: false };
  return dedupeRequest(`stock-fundamentals:${key}`, async () => {
    try {
      const payload = await collect(key);
      putSnapshot({ namespace: "stock-fundamentals", key, payload, sourceTime: payload.annual.filed, fetchedAt: new Date().toISOString(), refreshAfter: new Date(Date.now() + CACHE_MS).toISOString(), methodologyVersion: SOURCE_VERSION });
      return { ...payload, stale: false };
    } catch {
      return stored ? { ...stored.payload, stale: true } : { company: null, cik: null, annual: { revenue: null, netIncome: null, operatingCashFlow: null, capex: null, cash: null, investments: null, debt: null, shares: null, sharesSource: null, dilutedShares: null, interestExpense: null, pretaxIncome: null, incomeTax: null, stockCompensation: null, acquisitions: null, grossProfit: null, operatingIncome: null, depreciation: null, assets: null, equity: null, currentAssets: null, currentLiabilities: null, inventory: null, dividends: null, dilutedEps: null, filed: null, periodEnd: null }, epsHistory: [], ttm: { operatingCashFlow: null, capex: null, source: null, filed: null }, history: [], source: "Unavailable", stale: true };
    }
  });
}
