import { NextResponse } from "next/server";
import { loadYahooDailyOhlc } from "@/lib/server/yahoo-daily";

export const runtime = "nodejs";

function returns(rows: { close: number }[], periods: number) {
  const latest = rows.at(-1)?.close; const prior = rows.at(-1 - periods)?.close;
  return latest && prior ? (latest / prior - 1) * 100 : null;
}

function correlation(left: { close: number }[], right: { close: number }[], periods = 60) {
  const a = left.slice(-(periods + 1)); const b = right.slice(-(periods + 1)); if (a.length < periods + 1 || b.length < periods + 1) return null;
  const pairs = a.slice(1).map((row, index) => ({ left: row.close / a[index].close - 1, right: b[index + 1].close / b[index].close - 1 }));
  const leftMean = pairs.reduce((sum, row) => sum + row.left, 0) / pairs.length; const rightMean = pairs.reduce((sum, row) => sum + row.right, 0) / pairs.length;
  const numerator = pairs.reduce((sum, row) => sum + (row.left - leftMean) * (row.right - rightMean), 0); const leftVariance = pairs.reduce((sum, row) => sum + (row.left - leftMean) ** 2, 0); const rightVariance = pairs.reduce((sum, row) => sum + (row.right - rightMean) ** 2, 0);
  return leftVariance && rightVariance ? numerator / Math.sqrt(leftVariance * rightVariance) : null;
}

function realizedVol(rows: { close: number }[], periods = 20) {
  const window = rows.slice(-(periods + 1)); if (window.length < periods + 1) return null;
  const changes = window.slice(1).map((row, index) => Math.log(row.close / window[index].close)); const mean = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  return Math.sqrt(changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / changes.length) * Math.sqrt(252) * 100;
}

async function loadFedBroadDollar() {
  const response = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXBGS", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`FRED broad dollar request returned ${response.status}`);
  const csv = await response.text();
  const rows = csv.split(/\r?\n/).slice(1).flatMap((line) => { const [date, value] = line.split(","); const close = Number(value); return date && Number.isFinite(close) ? [{ date, close }] : []; });
  return { rows, stale: false };
}

export async function GET() {
  const [dxy, nq, fedBroad] = await Promise.all([loadYahooDailyOhlc("DX=F"), loadYahooDailyOhlc("NQ=F"), loadFedBroadDollar().catch(() => ({ rows: [], stale: true }))]);
  const dxyRows = dxy.rows; const nqRows = nq.rows; const dxy5 = returns(dxyRows, 5); const nq5 = returns(nqRows, 5); const dxy20 = returns(dxyRows, 20); const nq20 = returns(nqRows, 20);
  const dxyLast = dxyRows.at(-1)?.close ?? null; const dxyPrior = dxyRows.at(-21)?.close ?? null; const trend = dxyLast !== null && dxyPrior !== null ? dxyLast >= dxyPrior ? "rising" : "falling" : "unavailable";
  const broadRows = fedBroad.rows; const broad5 = returns(broadRows, 5); const broad20 = returns(broadRows, 20); const broadLast = broadRows.at(-1)?.close ?? null; const broadPrior = broadRows.at(-21)?.close ?? null; const broadTrend = broadLast !== null && broadPrior !== null ? broadLast >= broadPrior ? "rising" : "falling" : "unavailable";
  const divergence = dxy5 !== null && nq5 !== null && dxy5 > .5 && nq5 > .5 ? "dollar + equities rising" : dxy5 !== null && nq5 !== null && dxy5 > .5 && nq5 < -.5 ? "dollar headwind" : dxy5 !== null && nq5 !== null && dxy5 < -.5 && nq5 < -.5 ? "risk-off confirmation" : "mixed";
  return NextResponse.json({ symbol: "DXY", spot: dxyLast, asOf: dxyRows.at(-1)?.date ?? null, stale: dxy.stale || nq.stale || fedBroad.stale, returns: { dxy5, dxy20, nq5, nq20 }, trend, realizedVol20: realizedVol(dxyRows), correlation60: correlation(dxyRows, nqRows), divergence, officialBroad: { spot: broadLast, asOf: broadRows.at(-1)?.date ?? null, return5: broad5, return20: broad20, trend: broadTrend, source: "Federal Reserve H.10 via FRED DTWEXBGS" }, caveat: "DXY is the ICE fixed-weight dollar benchmark; the broad dollar is the Federal Reserve H.10 trade-weighted index. Their baskets differ. Relationship to NQ is rolling and regime-dependent; this is context, not a directional signal." });
}
