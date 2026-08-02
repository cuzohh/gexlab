"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildReversalAnalysis,
  type ReversalAnalysis,
  type ReversalMetricRow,
  type ReversalSnapshot,
  type ReversalZone,
} from "@/lib/reversal-zones";

type ViewSymbol = "NDX" | "SPX";

type OptionsResponse = {
  symbol: string;
  spot: number;
  timestamp?: string | null;
  retrievedAt?: string | null;
  stale?: boolean;
  netGamma?: number | null;
  strikes?: ReversalMetricRow[];
  levels?: ReversalSnapshot["levels"];
  error?: string;
};

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function signedPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function timestamp(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—";
}

function Icon({ kind }: { kind: "target" | "spark" | "refresh" | "shield" }) {
  if (kind === "refresh") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
        <path d="M20 11a8 8 0 0 0-14.8-3.9L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.8 3.9L21 15m0 0v5m0-5h-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      </svg>
    );
  }
  if (kind === "spark") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
        <path d="m13.1 2-8 11.1h6.3L10.7 22l8.2-12h-6.2L13.1 2Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      </svg>
    );
  }
  if (kind === "shield") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
        <path d="M12 3 20 6v5.7c0 4.1-3.1 7.5-8 9.3-4.9-1.8-8-5.2-8-9.3V6l8-3Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
        <path d="m8.5 12 2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function formatZoneRange(zone: ReversalZone) {
  return `${money(zone.low)}–${money(zone.high)}`;
}

function zoneTone(zone: ReversalZone) {
  if (zone.kind === "Acceleration zone") return "stress";
  if (zone.confidence === "High") return "constructive";
  return "caution";
}

function ReversalMap({ analysis, snapshot }: { analysis: ReversalAnalysis; snapshot: ReversalSnapshot }) {
  const width = 920;
  const height = 260;
  const padX = 22;
  const padY = 26;
  const scenario = analysis.scenario;
  const maxValue = Math.max(1, ...scenario.flatMap((point) => [point.stabilizing, point.amplifying]));
  const x = (price: number) => padX + ((price - scenario[0].price) / (scenario.at(-1)!.price - scenario[0].price)) * (width - padX * 2);
  const y = (value: number) => height - padY - (value / maxValue) * (height - padY * 2);
  const line = (key: "stabilizing" | "amplifying") => scenario.map((point, index) => `${index ? "L" : "M"}${x(point.price).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
  const area = (key: "stabilizing" | "amplifying") => `${line(key)} L${x(scenario.at(-1)!.price).toFixed(1)},${height - padY} L${x(scenario[0].price).toFixed(1)},${height - padY} Z`;
  const ticks = [scenario[0].price, snapshot.spot, scenario.at(-1)!.price];

  return (
    <div className="reversal-map" role="img" aria-label="Options confluence map showing stabilizing and amplifying hedge pressure around spot">
      <div className="reversal-map-head">
        <div>
          <span className="eyebrow">Reaction map</span>
          <h2>Where the book changes character</h2>
        </div>
        <div className="reversal-map-legend" aria-hidden="true">
          <span><i className="reversal-key reversal-key--stable" />Stabilizing</span>
          <span><i className="reversal-key reversal-key--amplify" />Amplifying</span>
        </div>
      </div>
      {scenario.length ? (
        <svg className="reversal-map-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <title>Stabilizing and amplifying options pressure around the current price</title>
          <desc>Higher stabilizing pressure suggests dealer hedging may dampen movement. Higher amplifying pressure suggests breaks can travel.</desc>
          <line x1={padX} x2={width - padX} y1={height - padY} y2={height - padY} className="reversal-axis" />
          <path d={area("stabilizing")} className="reversal-area reversal-area--stable" />
          <path d={area("amplifying")} className="reversal-area reversal-area--amplify" />
          <path d={line("stabilizing")} className="reversal-line reversal-line--stable" />
          <path d={line("amplifying")} className="reversal-line reversal-line--amplify" />
          <line x1={x(snapshot.spot)} x2={x(snapshot.spot)} y1={padY} y2={height - padY} className="reversal-spot-line" />
          <text x={x(snapshot.spot)} y="16" textAnchor="middle" className="reversal-spot-label">SPOT {money(snapshot.spot)}</text>
          {analysis.zones.slice(0, 3).map((zone) => {
            const zoneX = x(zone.low);
            const zoneWidth = Math.max(8, x(zone.high) - zoneX);
            return (
              <g key={`${zone.center}-${zone.kind}`}>
                <rect x={zoneX} y={padY} width={zoneWidth} height={height - padY * 2} className={`reversal-zone-band reversal-zone-band--${zoneTone(zone)}`} />
                <text x={zoneX + zoneWidth / 2} y={height - 9} textAnchor="middle" className="reversal-zone-label">{money(zone.center)}</text>
              </g>
            );
          })}
          {ticks.map((tick, index) => (
            <text key={`${tick}-${index}`} x={x(tick)} y={height - 1} textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"} className="reversal-axis-label">
              {index === 1 ? "current" : money(tick)}
            </text>
          ))}
        </svg>
      ) : (
        <div className="reversal-empty-map">No nearby strike data is available for a reaction map.</div>
      )}
      <p className="reversal-map-caption">The map combines gamma with speed, vanna and charm. It describes where hedging pressure may change—not a promise of direction.</p>
    </div>
  );
}

function ZoneCard({ zone, primary = false }: { zone: ReversalZone; primary?: boolean }) {
  const tone = zoneTone(zone);
  return (
    <article className={`reversal-zone-card${primary ? " reversal-zone-card--primary" : ""}`} data-kind={zone.kind === "Acceleration zone" ? "acceleration" : "stabilizing"}>
      <div className="reversal-zone-card-top">
        <span className={`reversal-zone-icon reversal-zone-icon--${tone}`}><Icon kind={zone.kind === "Acceleration zone" ? "spark" : primary ? "target" : "shield"} /></span>
        <span className="reversal-zone-kind">{zone.kind}</span>
        <span className={`reversal-confidence reversal-confidence--${zone.confidence.toLowerCase()}`}>{zone.confidence}</span>
      </div>
      <div className="reversal-zone-card-price">{formatZoneRange(zone)}</div>
      <div className="reversal-zone-card-meta">
        <span>{zone.side}</span>
        <span>{signedPercent(zone.distancePercent)} from spot</span>
      </div>
      <div className="reversal-zone-score-row">
        <span>Confluence</span>
        <strong>{zone.score}<small>/100</small></strong>
      </div>
      <div className="reversal-score-track" aria-hidden="true"><i style={{ width: `${zone.score}%` }} /></div>
      <ul className="reversal-reason-list">
        {zone.reasons.slice(0, primary ? 5 : 3).map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
    </article>
  );
}

function toSnapshot(payload: OptionsResponse): ReversalSnapshot {
  return {
    symbol: payload.symbol,
    spot: Number(payload.spot),
    timestamp: payload.timestamp ?? null,
    stale: payload.stale,
    strikes: (payload.strikes ?? []).map((row) => ({
      strike: Number(row.strike),
      gamma: Number(row.gamma),
      delta: Number(row.delta),
      vanna: Number(row.vanna),
      charm: Number(row.charm),
      vega: Number(row.vega),
      speed: Number(row.speed),
      callOi: Number(row.callOi),
      putOi: Number(row.putOi),
      callVolume: Number(row.callVolume),
      putVolume: Number(row.putVolume),
    })),
    levels: payload.levels ?? { callWall: null, putWall: null, gammaFlip: null, maxPain: null, vannaMagnet: null },
  };
}

export function ReversalZones() {
  const [viewSymbol, setViewSymbol] = useState<ViewSymbol>("NDX");
  const [payload, setPayload] = useState<OptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  function reload(nextSymbol?: ViewSymbol) {
    setLoading(true);
    setError(null);
    if (nextSymbol && nextSymbol !== viewSymbol) {
      // A symbol switch must never leave the previous index's structural read
      // below the newly active toggle while the new request is in flight.
      setPayload(null);
      setViewSymbol(nextSymbol);
      return;
    }
    // Setting the same symbol is a no-op in React. A separate refresh token
    // keeps an intentional click on the active NQ/ES control from stranding
    // the page in its updating state.
    setRefreshToken((value) => value + 1);
  }

  useEffect(() => {
    let cancelled = false;
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 45);
    const through = horizon.toISOString().slice(0, 10);
    fetch(`/api/options/${viewSymbol}?updates=live&through=${through}`, { cache: "no-store" })
      .then(async (response) => {
        const next = (await response.json()) as OptionsResponse;
        if (!response.ok || next.error) throw new Error(next.error ?? "Unable to load the options book.");
        return next;
      })
      .then((next) => {
        if (!cancelled) setPayload(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load the options book.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [viewSymbol, refreshToken]);

  const snapshot = useMemo(() => payload ? toSnapshot(payload) : null, [payload]);
  const analysis = useMemo(() => snapshot ? buildReversalAnalysis(snapshot) : null, [snapshot]);
  const bestZone = analysis?.zones[0] ?? null;
  const gammaFlip = snapshot?.levels.gammaFlip ?? null;
  const gammaRegime = payload && Number.isFinite(payload.netGamma)
    ? Number(payload.netGamma) > 0 ? "Stabilizing" : Number(payload.netGamma) < 0 ? "Amplifying" : "Unclear"
    : "Unclear";

  return (
    <div className="reversal-page">
      <header className="reversal-header">
        <div className="reversal-heading">
          <span className="eyebrow">Options structure · confluence</span>
          <h1>Where price is likely to react</h1>
          <p>One ranked zone, one map, one reason to act—or stand aside.</p>
        </div>
        <div className="reversal-controls">
          <div className="reversal-symbol-toggle" role="group" aria-label="Choose index">
            <button type="button" data-active={viewSymbol === "NDX" || undefined} onClick={() => reload("NDX")}>NQ</button>
            <button type="button" data-active={viewSymbol === "SPX" || undefined} onClick={() => reload("SPX")}>ES</button>
          </div>
          <button className="reversal-refresh" type="button" onClick={() => reload()} disabled={loading}>
            <Icon kind="refresh" /> {loading ? "Updating" : "Refresh"}
          </button>
        </div>
      </header>

      {loading && !analysis ? <div className="reversal-loading"><span className="reversal-loading-mark" />Reading the nearby options book…</div> : null}
      {error ? <div className="reversal-error" role="alert">{error}<button type="button" onClick={() => reload()}>Try again</button></div> : null}

      {snapshot && analysis ? (
        <>
          <div className="reversal-asof-row">
            <span><i className={snapshot.stale ? "status-dot status-dot--caution" : "status-dot"} />{snapshot.stale ? "Cached snapshot" : "Market snapshot"}</span>
            <span>{snapshot.symbol === "NDX" ? "Nasdaq 100" : "S&P 500"} · as of {timestamp(snapshot.timestamp)}</span>
          </div>

          <section className="reversal-hero" aria-label="Current reversal read">
            {bestZone ? <ZoneCard zone={bestZone} primary /> : <div className="reversal-best-card reversal-best-card--empty"><span className="eyebrow">No ranked zone</span><h2>Wait for a cleaner confluence</h2><p>The current nearby book does not meet the minimum signal threshold. That is a usable result.</p></div>}
            <article className="reversal-state-card">
              <div className="reversal-state-head"><span className="eyebrow">Market posture</span><span className={`reversal-posture reversal-posture--${gammaRegime.toLowerCase()}`}>{gammaRegime}</span></div>
              <div className="reversal-state-main"><span className="reversal-state-icon"><Icon kind={gammaRegime === "Stabilizing" ? "shield" : "spark"} /></span><div><span className="reversal-state-label">Gamma regime</span><strong>{gammaRegime}</strong></div></div>
              <p className="reversal-state-copy">{gammaRegime === "Stabilizing" ? "Positive gamma is closer to a mean-reversion environment; reactions can hold when other inputs agree." : gammaRegime === "Amplifying" ? "Negative gamma raises break-and-run risk; treat nearby zones as acceleration warnings before fades." : "The flip is not available, so let the ranked zones and price response do more of the work."}</p>
              <dl className="reversal-level-list">
                <div><dt>Spot</dt><dd>{money(snapshot.spot)}</dd></div>
                <div><dt>Gamma flip</dt><dd>{money(snapshot.levels.gammaFlip)} <small>{gammaFlip !== null ? signedPercent(((gammaFlip - snapshot.spot) / snapshot.spot) * 100) : ""}</small></dd></div>
                <div><dt>Max pain</dt><dd>{money(snapshot.levels.maxPain)}</dd></div>
              </dl>
            </article>
          </section>

          <ReversalMap analysis={analysis} snapshot={snapshot} />

          <section className="reversal-zones-section">
            <div className="reversal-section-head"><div><span className="eyebrow">Supporting levels</span><h2>What else is close enough to matter</h2></div><span className="reversal-section-count">{analysis.zones.length} ranked zones</span></div>
            {analysis.zones.length ? <div className="reversal-zone-grid">{analysis.zones.slice(1, 4).map((zone) => <ZoneCard key={`${zone.center}-${zone.kind}`} zone={zone} />)}</div> : <div className="reversal-empty-state">No high-confluence zones within 6% of spot.</div>}
          </section>

          <details className="reversal-explain">
            <summary>How the confluence score works <span>+</span></summary>
            <div className="reversal-explain-grid">
              <p><strong>Stabilizing gamma</strong> is the reversal input. It is stronger when a nearby strike also carries a sharp speed transition, vanna or charm concentration, and meaningful open interest.</p>
              <p><strong>Amplifying gamma</strong> is a risk flag, not a short signal. Negative gamma can make a move travel through a level instead of rejecting from it.</p>
              <p><strong>Score ≠ probability.</strong> This is a structural ranking until the app logs zone touches and outcomes well enough to calibrate hit rates.</p>
            </div>
          </details>
          <p className="data-disclaimer reversal-disclaimer">Modelled dealer exposure from the selected 0–45 day book. Open interest is a positioning proxy; it is not live order flow. Use the zone as context around a trigger, not as a standalone entry.</p>
        </>
      ) : null}
    </div>
  );
}
