"use client";

import { useEffect, useState } from "react";

type DxyData = { symbol: string; spot: number | null; asOf: string | null; stale: boolean; returns: { dxy5: number | null; dxy20: number | null; nq5: number | null; nq20: number | null }; trend: string; realizedVol20: number | null; correlation60: number | null; divergence: string; officialBroad: { spot: number | null; asOf: string | null; return5: number | null; return20: number | null; trend: string; source: string }; caveat: string; error?: string };
const pct = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function isDxyData(payload: unknown): payload is DxyData {
  if (!payload || typeof payload !== "object" || "error" in payload) return false;
  const value = payload as Partial<DxyData>;
  return Boolean(value.returns && typeof value.returns === "object" && value.officialBroad && typeof value.officialBroad === "object");
}

const EMPTY_DXY: DxyData = { symbol: "DXY", spot: null, asOf: null, stale: true, returns: { dxy5: null, dxy20: null, nq5: null, nq20: null }, trend: "unavailable", realizedVol20: null, correlation60: null, divergence: "unavailable", officialBroad: { spot: null, asOf: null, return5: null, return20: null, trend: "unavailable", source: "FRED" }, caveat: "DXY and Nasdaq futures context is temporarily unavailable." };

export function DxyStudy() {
  const [data, setData] = useState<DxyData | null>(null); const [threshold, setThreshold] = useState("0.5");
  useEffect(() => { const controller = new AbortController(); fetch("/api/cross-asset", { signal: controller.signal }).then((response) => response.json()).then((payload: unknown) => setData(isDxyData(payload) ? payload : EMPTY_DXY)).catch(() => setData(EMPTY_DXY)); return () => controller.abort(); }, []);
  const alert = data && data.returns.dxy5 !== null && Math.abs(data.returns.dxy5) >= Number(threshold || .5);
  return <section className="dxy-study stock-section" aria-labelledby="dxy-study-title"><div className="section-heading"><div><p className="section-kicker">Cross-asset context · futures</p><h2 id="dxy-study-title">Dollar pressure around NQ / MNQ.</h2></div><p>{data?.caveat ?? "Loading DXY and Nasdaq futures context…"}</p></div><div className="dxy-grid"><article><span>DXY tactical</span><strong>{data?.spot?.toFixed(2) ?? "—"}</strong><small>{data?.trend ?? "loading"} · 5d {pct(data?.returns.dxy5 ?? null)}</small></article><article><span>Fed broad dollar</span><strong>{data?.officialBroad.spot?.toFixed(2) ?? "—"}</strong><small>{data?.officialBroad.trend ?? "loading"} · 5d {pct(data?.officialBroad.return5 ?? null)}</small></article><article><span>Rolling NQ correlation</span><strong>{data?.correlation60 === null || data?.correlation60 === undefined ? "—" : data.correlation60.toFixed(2)}</strong><small>60 sessions · {data?.divergence ?? "loading"}</small></article><article><span>DXY realized vol</span><strong>{data?.realizedVol20 === null || data?.realizedVol20 === undefined ? "—" : `${data.realizedVol20.toFixed(1)}%`}</strong><small>20d annualized · NQ 5d {pct(data?.returns.nq5 ?? null)}</small></article><article><span>Move alert</span><strong className={alert ? "dxy-alert" : ""}>{alert ? "Active" : "Quiet"}</strong><small>5d DXY threshold ±<input aria-label="DXY five day alert threshold" inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} />%</small></article></div><div className="dxy-note"><span>{data?.asOf ? `DXY as of ${data.asOf}` : "Waiting for market data"}</span><b>{data?.stale ? "saved snapshot / official broad fallback" : "DXY delayed · Fed H.10 broad dollar"}</b></div></section>;
}
