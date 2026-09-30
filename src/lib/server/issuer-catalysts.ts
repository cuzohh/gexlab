import "server-only";

import { dedupeRequest } from "@/lib/server/request-deduper";
import { secRequestHeaders } from "@/lib/server/sec-request";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";

const SOURCE = "issuer-catalysts-v1";
const CACHE_MS = 6 * 60 * 60 * 1000;

const IR_CALENDARS: Record<string, string> = {
  NVDA: "https://investor.nvidia.com/events-and-presentations/default.aspx", MSFT: "https://www.microsoft.com/en-us/Investor/events-and-presentations.aspx", AAPL: "https://investor.apple.com/", AMZN: "https://ir.aboutamazon.com/overview/default.aspx", META: "https://investor.atmeta.com/", GOOGL: "https://abc.xyz/investor/", TSLA: "https://ir.tesla.com/",
};
type TickerMap = Record<string, { ticker: string; cik_str: number }>;
type Submissions = { filings?: { recent?: { form?: string[]; filingDate?: string[]; accessionNumber?: string[]; primaryDocument?: string[] } } };
export type IssuerCatalysts = { symbol: string; irCalendar: string | null; filings: { form: string; date: string; url: string; label: string }[]; source: "SEC EDGAR"; stale: boolean };

async function json<T>(url: string) { const r = await fetch(url, { headers: secRequestHeaders(), cache: "no-store", signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(`SEC request returned ${r.status}`); return r.json() as Promise<T>; }

export async function loadIssuerCatalysts(symbol: string): Promise<IssuerCatalysts> {
  const key = symbol.toUpperCase(); const cached = getSnapshot<Omit<IssuerCatalysts, "stale">>("issuer-catalysts", key);
  if (cached?.methodologyVersion === SOURCE && snapshotIsFresh(cached)) return { ...cached.payload, stale: false };
  return dedupeRequest(`issuer-catalysts:${key}`, async () => {
    try {
      const tickers = await json<TickerMap>("https://www.sec.gov/files/company_tickers.json"); const issuer = Object.values(tickers).find((item) => item.ticker.toUpperCase() === key);
      if (!issuer) throw new Error("Issuer not found");
      const cik = String(issuer.cik_str).padStart(10, "0"); const data = await json<Submissions>(`https://data.sec.gov/submissions/CIK${cik}.json`);
      const recent = data.filings?.recent ?? {}; const filings = (recent.form ?? []).map((form, index) => ({ form, date: recent.filingDate?.[index] ?? "", accession: recent.accessionNumber?.[index]?.replaceAll("-", "") ?? "", document: recent.primaryDocument?.[index] ?? "" })).filter((row) => ["8-K", "10-Q", "10-K"].includes(row.form)).slice(0, 8).map((row) => ({ form: row.form, date: row.date, url: `https://www.sec.gov/Archives/edgar/data/${issuer.cik_str}/${row.accession}/${row.document}`, label: row.form === "8-K" ? "Material update / potential earnings release" : row.form === "10-Q" ? "Quarterly filing" : "Annual filing" }));
      const payload: Omit<IssuerCatalysts, "stale"> = { symbol: key, irCalendar: IR_CALENDARS[key] ?? null, filings, source: "SEC EDGAR" };
      putSnapshot({ namespace: "issuer-catalysts", key, payload, sourceTime: filings[0]?.date ?? null, refreshAfter: new Date(Date.now() + CACHE_MS).toISOString(), methodologyVersion: SOURCE }); return { ...payload, stale: false };
    } catch { return cached ? { ...cached.payload, stale: true } : { symbol: key, irCalendar: IR_CALENDARS[key] ?? null, filings: [], source: "SEC EDGAR", stale: true }; }
  });
}
