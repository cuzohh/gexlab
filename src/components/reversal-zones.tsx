"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  buildReversalAnalysis,
  type ReversalAnalysis,
  type ReversalMetricRow,
  type ReversalSnapshot,
  type ReversalZone,
} from "@/lib/reversal-zones";
import { futuresRatio, indexLevelToFutures } from "@/lib/futures-mapping";

type ViewSymbol = "NDX" | "SPX";

type OptionsResponse = {
  symbol: string;
  spot: number;
  timestamp?: string | null;
  retrievedAt?: string | null;
  stale?: boolean;
  netGamma?: number | null;
  expectedMovePercent?: number | null;
  riskReversal25?: number | null;
  expiryBuckets?: ReversalSnapshot["expiryBuckets"];
  strikes?: ReversalMetricRow[];
  levels?: ReversalSnapshot["levels"];
  error?: string;
};

type FuturesSettlement = {
  symbol: "NQ" | "ES";
  contract: string;
  price: number;
  tradeDate: string;
  stale?: boolean;
};

type FuturesQuote = {
  symbol: "NQ" | "ES";
  price: number;
  observedAt: string;
  source: string;
  delayed: true;
  stale?: boolean;
};

type FuturesContext = {
  settlement: FuturesSettlement;
  quote: FuturesQuote;
};

type OvernightInstrument = {
  overnightHigh: number | null;
  overnightLow: number | null;
  overnightRangePoints: number | null;
  rangePositionPercent: number | null;
};

type OvernightResponse = {
  sessionDate: string;
  status: "available" | "partial" | "unavailable";
  stale?: boolean;
  observedThrough: string | null;
  nq: OvernightInstrument;
  es: OvernightInstrument;
};

type OvernightState = {
  symbol: "NQ" | "ES";
  data: OvernightResponse;
};

function DataScan() {
  const root = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion || !root.current) return;
    let cancelled = false;
    let controls: { cancel: () => void } | null = null;
    const bars = root.current.querySelectorAll("i");
    void import("animejs").then(({ animate, stagger }) => {
      if (cancelled) return;
      controls = animate(bars, {
        scaleY: [0.25, 1],
        opacity: [0.35, 1],
        delay: stagger(85),
        duration: 680,
        ease: "inOut(3)",
        alternate: true,
        loop: true,
      });
    });
    return () => {
      cancelled = true;
      controls?.cancel();
    };
  }, [reducedMotion]);

  return <span ref={root} className="data-scan" aria-hidden="true"><i /><i /><i /><i /><i /></span>;
}

function ReversalSkeleton() {
  return (
    <div className="reversal-skeleton" aria-label="Loading market structure" role="status">
      <div className="reversal-skeleton-line"><DataScan /><span>Loading market structure</span></div>
      <div className="reversal-skeleton-rail"><i /><i /><i /><i /></div>
      <div className="reversal-skeleton-hero"><i /><i /></div>
      <div className="reversal-skeleton-map"><i /><i /><i /></div>
    </div>
  );
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function signedPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function signedPoints(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(0)} pts`;
}

function timestamp(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "—";
}

function shortDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
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
  if (zone.kind === "Transition zone") return "caution";
  if (zone.confidence === "High") return "constructive";
  return "caution";
}

function ReversalMap({ analysis, snapshot }: { analysis: ReversalAnalysis; snapshot: ReversalSnapshot }) {
  const reducedMotion = useReducedMotion();
  const [highlight, setHighlight] = useState<"stabilizing" | "amplifying" | null>(null);
  const [lens, setLens] = useState<"combined" | "gamma" | "delta">("combined");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 920;
  const height = 260;
  const padX = 22;
  const padY = 26;
  const scenario = analysis.scenario;
  const plotted = scenario.map((point) => lens === "gamma"
    ? { ...point, stabilizing: Math.max(0, point.gamma), amplifying: Math.max(0, -point.gamma) }
    : lens === "delta"
      ? { ...point, stabilizing: Math.max(0, point.delta), amplifying: Math.max(0, -point.delta) }
      : point);
  const labels = lens === "delta" ? ["Call delta", "Put delta"] : lens === "gamma" ? ["Positive gamma", "Negative gamma"] : ["Stabilizing", "Amplifying"];
  const maxValue = Math.max(1, ...plotted.flatMap((point) => [point.stabilizing, point.amplifying]));
  const x = (price: number) => padX + ((price - scenario[0].price) / (scenario.at(-1)!.price - scenario[0].price)) * (width - padX * 2);
  const y = (value: number) => height - padY - (value / maxValue) * (height - padY * 2);
  const line = (key: "stabilizing" | "amplifying") => plotted.map((point, index) => `${index ? "L" : "M"}${x(point.price).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");
  const area = (key: "stabilizing" | "amplifying") => `${line(key)} L${x(plotted.at(-1)!.price).toFixed(1)},${height - padY} L${x(plotted[0].price).toFixed(1)},${height - padY} Z`;
  const ticks = [scenario[0].price, snapshot.spot, scenario.at(-1)!.price];
  const hovered = hoverIndex === null ? null : plotted[hoverIndex];
  const tooltipX = hovered ? Math.max(92, Math.min(width - 92, x(hovered.price))) : 0;

  function trackPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * width;
    const position = Math.max(0, Math.min(1, (pointerX - padX) / (width - padX * 2)));
    setHoverIndex(Math.round(position * (plotted.length - 1)));
  }

  return (
    <div className="reversal-map">
      <div className="reversal-map-head">
        <div>
          <span className="eyebrow">Reaction map</span>
          <h2>Where the book changes character</h2>
        </div>
        <div className="reversal-map-tools">
          <div className="pressure-lens" role="tablist" aria-label="Pressure lens">
            {(["combined", "gamma", "delta"] as const).map((option) => (
              <button key={option} type="button" role="tab" aria-selected={lens === option} onClick={() => setLens(option)}>
                {lens === option ? <motion.i layoutId="pressure-lens-active" transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }} /> : null}
                <span>{option}</span>
              </button>
            ))}
          </div>
          <div className="reversal-map-legend" onMouseLeave={() => setHighlight(null)}>
            <button type="button" aria-pressed={highlight === "stabilizing"} onMouseEnter={() => setHighlight("stabilizing")} onFocus={() => setHighlight("stabilizing")} onBlur={() => setHighlight(null)}>
              <i className="reversal-key reversal-key--stable" />{labels[0]}
            </button>
            <button type="button" aria-pressed={highlight === "amplifying"} onMouseEnter={() => setHighlight("amplifying")} onFocus={() => setHighlight("amplifying")} onBlur={() => setHighlight(null)}>
              <i className="reversal-key reversal-key--amplify" />{labels[1]}
            </button>
          </div>
        </div>
      </div>
      {scenario.length ? (
        <svg className="reversal-map-svg" role="img" aria-label="Options confluence map showing hedge pressure around spot" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" onPointerMove={trackPointer} onPointerLeave={() => setHoverIndex(null)}>
          <title>Stabilizing and amplifying options pressure around the current price</title>
          <desc>Higher stabilizing pressure suggests dealer hedging may dampen movement. Higher amplifying pressure suggests breaks can travel.</desc>
          <line x1={padX} x2={width - padX} y1={height - padY} y2={height - padY} className="reversal-axis" />
          <motion.path d={area("stabilizing")} className="reversal-area reversal-area--stable" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: highlight === null || highlight === "stabilizing" ? 0.12 : 0.025 }} transition={{ duration: reducedMotion ? 0 : 0.28 }} />
          <motion.path d={area("amplifying")} className="reversal-area reversal-area--amplify" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: highlight === null || highlight === "amplifying" ? 0.12 : 0.025 }} transition={{ delay: reducedMotion ? 0 : 0.05, duration: reducedMotion ? 0 : 0.28 }} />
          <motion.path d={line("stabilizing")} className="reversal-line reversal-line--stable" initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: highlight === null || highlight === "stabilizing" ? 1 : 0.18 }} transition={{ duration: reducedMotion ? 0 : 0.62, ease: [0.16, 1, 0.3, 1] }} />
          <motion.path d={line("amplifying")} className="reversal-line reversal-line--amplify" initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: highlight === null || highlight === "amplifying" ? 1 : 0.18 }} transition={{ delay: reducedMotion ? 0 : 0.06, duration: reducedMotion ? 0 : 0.62, ease: [0.16, 1, 0.3, 1] }} />
          <motion.line x1={x(snapshot.spot)} x2={x(snapshot.spot)} y1={padY} y2={height - padY} className="reversal-spot-line" initial={false} animate={{ opacity: 1 }} transition={{ delay: 0.42, duration: 0.3 }} />
          <text x={x(snapshot.spot)} y="16" textAnchor="middle" className="reversal-spot-label">SPOT {money(snapshot.spot)}</text>
          {analysis.zones.slice(0, 3).map((zone, index) => {
            // The zone list is not bounded by the plotted price range: a break
            // level several hundred points below the lowest plotted strike is
            // still a zone worth listing. Unclamped, x() put its band at a
            // negative coordinate and the SVG drew it outside the card
            // entirely, label and all. Bands are clipped to the plot area, and
            // a zone with no overlap at all is not drawn — a band pinned to the
            // edge would claim a price the map does not cover.
            const left = Math.max(padX, Math.min(x(zone.low), x(zone.high)));
            const right = Math.min(width - padX, Math.max(x(zone.low), x(zone.high)));
            if (right <= padX || left >= width - padX) return null;
            const zoneX = left;
            const zoneWidth = Math.max(2, right - left);
            return (
              <g key={`${zone.center}-${zone.kind}`}>
                <motion.rect x={zoneX} y={padY} width={zoneWidth} height={height - padY * 2} className={`reversal-zone-band reversal-zone-band--${zoneTone(zone)}`} initial={false} animate={{ opacity: 1 }} transition={{ delay: 0.5 + index * 0.08, duration: 0.3 }} />
                <text x={zoneX + zoneWidth / 2} y={padY + 13 + index * 12} textAnchor="middle" className="reversal-zone-label">{money(zone.center)}</text>
              </g>
            );
          })}
          {hovered ? (
            <g className="reversal-crosshair" aria-hidden="true">
              <motion.line initial={false} animate={{ x1: x(hovered.price), x2: x(hovered.price) }} y1={padY} y2={height - padY} />
              <motion.circle initial={false} animate={{ cx: x(hovered.price), cy: y(hovered.stabilizing) }} r="3.5" className="reversal-crosshair-dot reversal-crosshair-dot--stable" />
              <motion.circle initial={false} animate={{ cx: x(hovered.price), cy: y(hovered.amplifying) }} r="3.5" className="reversal-crosshair-dot reversal-crosshair-dot--amplify" />
              <text x={x(hovered.price)} y={height - 9} textAnchor="middle">{money(hovered.price)}</text>
              <g className="reversal-chart-tooltip" transform={`translate(${tooltipX}, ${padY + 5})`}>
                <rect x="-82" y="0" width="164" height="48" rx="2" />
                <text x="-70" y="13" className="reversal-chart-tooltip-price">{money(hovered.price)}</text>
                <text x="-70" y="28">Γ {hovered.gamma.toFixed(2)} · Δ {hovered.delta.toFixed(2)}</text>
                <text x="-70" y="41">{labels[0]} {hovered.stabilizing.toFixed(2)} · {labels[1]} {hovered.amplifying.toFixed(2)}</text>
              </g>
            </g>
          ) : null}
          {ticks.map((tick, index) => (
            <text key={`${tick}-${index}`} x={x(tick)} y={height - 1} textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"} className="reversal-axis-label">
              {index === 1 ? "current" : money(tick)}
            </text>
          ))}
        </svg>
      ) : (
        <div className="reversal-empty-map">No nearby strike data is available for a reaction map.</div>
      )}
      <p className="reversal-map-caption">{lens === "delta" ? "OI-weighted call/put delta tilt. Directional context—not signed flow." : lens === "gamma" ? "Signed gamma isolates damping versus acceleration pressure." : "Gamma, speed, delta, vanna, and charm combined."}</p>
    </div>
  );
}

function DeltaCompass({ zone }: { zone: ReversalZone }) {
  const callHeavy = zone.deltaBias >= 0;
  const strength = Math.min(1, Math.abs(zone.deltaBias));
  return (
    <div className="delta-compass" title="OI-weighted option delta; this is positioning context, not signed order flow">
      <div className="delta-compass-head">
        <span>Delta tilt</span>
        <strong data-read={zone.deltaRead.toLowerCase().replace(" ", "-")}>{zone.deltaRead}</strong>
      </div>
      <div className="delta-compass-scale" aria-label={`${callHeavy ? "Call" : "Put"}-heavy delta, ${Math.round(strength * 100)} percent of nearby scale`}>
        <span>Put</span>
        <div className="delta-compass-track" data-side={callHeavy ? "call" : "put"}>
          <i style={{ transform: `scaleX(${strength})` }} />
        </div>
        <span>Call</span>
      </div>
    </div>
  );
}

function zoneBehavior(zone: ReversalZone) {
  if (zone.kind === "Acceleration zone") return "Negative gamma makes acceptance through this shelf more likely to extend the move.";
  if (zone.kind === "Transition zone") return "Mixed exposure makes this a decision area; wait for price response instead of assuming a fade.";
  return "Positive gamma gives this shelf a better chance of damping movement when the other inputs agree.";
}

function zoneInvalidation(zone: ReversalZone) {
  if (zone.kind === "Acceleration zone") return `A reclaim back through ${money(zone.center)} weakens the break thesis.`;
  return `Sustained acceptance beyond ${money(zone.high)} or ${money(zone.low)} weakens the reversal read.`;
}

function ZoneCard({ zone, primary = false }: { zone: ReversalZone; primary?: boolean }) {
  const tone = zoneTone(zone);
  return (
    <motion.article
      className={`reversal-zone-card${primary ? " reversal-zone-card--primary" : ""}`}
      data-kind={zone.kind === "Acceleration zone" ? "acceleration" : zone.kind === "Transition zone" ? "transition" : "stabilizing"}
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="reversal-zone-card-top">
        <span className={`reversal-zone-icon reversal-zone-icon--${tone}`}><Icon kind={zone.kind === "Acceleration zone" ? "spark" : primary ? "target" : "shield"} /></span>
        <span className="reversal-zone-kind">{zone.kind}</span>
        <span className={`reversal-confidence reversal-confidence--${zone.confidence.toLowerCase()}`}>{zone.confidence}</span>
      </div>
      <div className="reversal-zone-card-price">{formatZoneRange(zone)}</div>
      <div className="reversal-zone-card-meta">
        <span>{zone.side}</span>
        <span>{signedPoints(zone.distancePoints)} · {signedPercent(zone.distancePercent)}</span>
      </div>
      <DeltaCompass zone={zone} />
      <div className="reversal-score-row">
        <span>Confluence</span>
        <strong>{zone.confluence}<small>/8</small></strong>
      </div>
      <div className="reversal-score-track" aria-hidden="true"><i style={{ width: `${zone.score}%` }} /></div>
      <ul className="reversal-reason-list">
        {zone.reasons.slice(0, primary ? 5 : 3).map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      <details className="zone-details">
        <summary>Read structure <span>+</span></summary>
        <div className="zone-details-grid">
          <p><strong>Expected behavior</strong>{zoneBehavior(zone)}</p>
          <p><strong>Invalidation</strong>{zoneInvalidation(zone)}</p>
          <p><strong>Evidence</strong>{zone.confluence}/8 inputs aligned · {zone.reachability.toLowerCase()} · {zone.deltaRead.toLowerCase()}</p>
        </div>
      </details>
    </motion.article>
  );
}

function MarketNowRail({
  snapshot,
  futuresContext,
  overnight,
  zones,
}: {
  snapshot: ReversalSnapshot;
  futuresContext: FuturesContext | null;
  overnight: OvernightState | null;
  zones: ReversalZone[];
}) {
  const instrument = futuresContext?.quote.symbol === "ES" ? "es" : "nq";
  const overnightInstrument = overnight?.data[instrument];
  const nearest = [...zones].sort((left, right) => Math.abs(left.distancePoints) - Math.abs(right.distancePoints))[0] ?? null;
  const impliedPoints = snapshot.expectedMovePercent && snapshot.expectedMovePercent > 0
    ? snapshot.spot * snapshot.expectedMovePercent / 100
    : null;
  return (
    <section className="market-now-rail" aria-label="Current market context">
      <div className="market-now-label"><span className="eyebrow">Now</span><small>decision context</small></div>
      <div className="market-now-items">
        <div><span>{futuresContext?.quote.symbol ?? snapshot.symbol}</span><strong>{money(snapshot.spot)}</strong><small>{futuresContext ? "Yahoo 5m" : "index snapshot"}</small></div>
        <div><span>Nearest zone</span><strong>{nearest ? signedPoints(nearest.distancePoints) : "—"}</strong><small>{nearest?.kind ?? "Unavailable"}</small></div>
        <div><span>Implied move</span><strong>{impliedPoints === null ? "—" : `±${impliedPoints.toFixed(0)} pts`}</strong><small>{snapshot.expectedMovePercent === null || snapshot.expectedMovePercent === undefined ? "Unavailable" : `±${snapshot.expectedMovePercent.toFixed(2)}%`}</small></div>
        <div><span>Overnight range</span><strong>{overnightInstrument?.overnightRangePoints === null || overnightInstrument?.overnightRangePoints === undefined ? "—" : `${overnightInstrument.overnightRangePoints.toFixed(0)} pts`}</strong><small>{overnightInstrument?.rangePositionPercent === null || overnightInstrument?.rangePositionPercent === undefined ? "Waiting for bars" : `${overnightInstrument.rangePositionPercent.toFixed(0)}% of range`}</small></div>
      </div>
    </section>
  );
}

function ZoneLadder({ snapshot, zones }: { snapshot: ReversalSnapshot; zones: ReversalZone[] }) {
  const ordered = [...zones]
    .sort((left, right) => Math.abs(left.distancePoints) - Math.abs(right.distancePoints))
    .slice(0, 5);
  return (
    <section className="zone-ladder" aria-labelledby="zone-ladder-title">
      <div className="zone-ladder-head">
        <div><span className="eyebrow">Levels around spot</span><h2 id="zone-ladder-title">Nearby structure</h2></div>
        <span className="zone-ladder-spot">Spot {money(snapshot.spot)}</span>
      </div>
      {ordered.length ? (
        <ol>
          {ordered.map((zone) => (
            <li key={`${zone.center}-${zone.kind}`} data-kind={zone.kind === "Acceleration zone" ? "acceleration" : zone.kind === "Transition zone" ? "transition" : "reaction"}>
              <span className="zone-ladder-marker" />
              <span className="zone-ladder-range">{formatZoneRange(zone)}</span>
              <span className="zone-ladder-kind">{zone.kind}</span>
              <strong>{signedPoints(zone.distancePoints)}</strong>
            </li>
          ))}
        </ol>
      ) : <p className="reversal-empty-state">No nearby structure is available.</p>}
    </section>
  );
}

function compactExposure(value: number) {
  const magnitude = Math.abs(value);
  const units = magnitude >= 1e9 ? [1e9, "B"] as const : magnitude >= 1e6 ? [1e6, "M"] as const : magnitude >= 1e3 ? [1e3, "K"] as const : [1, ""] as const;
  return `${value >= 0 ? "+" : "−"}${(magnitude / units[0]).toFixed(magnitude / units[0] >= 10 ? 0 : 1)}${units[1]}`;
}

function ExpiryLens({ snapshot }: { snapshot: ReversalSnapshot }) {
  const buckets = snapshot.expiryBuckets ?? [];
  const maxGamma = Math.max(1, ...buckets.map((bucket) => Math.abs(bucket.netGamma)));
  return (
    <section className="expiry-lens" aria-labelledby="expiry-lens-title">
      <div className="expiry-lens-intro">
        <span className="eyebrow">Expiry pressure</span>
        <h2 id="expiry-lens-title">Which horizon owns the level</h2>
        <p>Near-dated agreement carries more weight than a wall built only from slower positioning.</p>
      </div>
      <div className="expiry-lens-grid">
        {buckets.map((bucket, index) => {
          const positive = bucket.netGamma >= 0;
          const strength = Math.max(0.035, Math.abs(bucket.netGamma) / maxGamma);
          return (
            <motion.article
              key={bucket.label}
              className="expiry-lens-row"
              initial={{ opacity: 0, x: -6 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.055, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              <header><strong>{bucket.label}</strong><span>{bucket.contractCount.toLocaleString()} contracts</span></header>
              <div className="expiry-pressure-track" aria-label={`${bucket.label} net gamma ${compactExposure(bucket.netGamma)}`}>
                <i className="expiry-pressure-axis" />
                <motion.i
                  className={`expiry-pressure-fill expiry-pressure-fill--${positive ? "positive" : "negative"}`}
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: strength }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 + index * 0.055, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <footer>
                <strong className={positive ? "positive" : "negative"}>{compactExposure(bucket.netGamma)}</strong>
                <span>Put {money(bucket.putWall)}</span>
                <span>Call {money(bucket.callWall)}</span>
              </footer>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}

function toSnapshot(payload: OptionsResponse): ReversalSnapshot {
  return {
    symbol: payload.symbol,
    spot: Number(payload.spot),
    timestamp: payload.timestamp ?? null,
    stale: payload.stale,
    netGamma: Number.isFinite(payload.netGamma) ? Number(payload.netGamma) : null,
    expectedMovePercent: Number.isFinite(payload.expectedMovePercent) ? Number(payload.expectedMovePercent) : null,
    riskReversal25: Number.isFinite(payload.riskReversal25) ? Number(payload.riskReversal25) : null,
    expiryBuckets: payload.expiryBuckets ?? [],
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

function mapSnapshotToFutures(snapshot: ReversalSnapshot, context: FuturesContext): ReversalSnapshot {
  if (futuresRatio(snapshot.spot, context.settlement.price) === null || !(context.quote.price > 0)) return snapshot;
  const mapLevel = (level: number | null | undefined) => indexLevelToFutures(level, snapshot.spot, context.settlement.price);
  return {
    ...snapshot,
    // Hold the option shelves to the snapshot/settlement basis. Advancing only
    // spot with the live quote keeps overnight distance honest instead of
    // dragging every level along with NQ or ES.
    spot: context.quote.price,
    strikes: snapshot.strikes.map((row) => ({ ...row, strike: mapLevel(row.strike) ?? row.strike })),
    levels: {
      callWall: mapLevel(snapshot.levels.callWall),
      putWall: mapLevel(snapshot.levels.putWall),
      gammaFlip: mapLevel(snapshot.levels.gammaFlip),
      maxPain: mapLevel(snapshot.levels.maxPain),
      vannaMagnet: mapLevel(snapshot.levels.vannaMagnet),
    },
    expiryBuckets: snapshot.expiryBuckets?.map((bucket) => ({
      ...bucket,
      callWall: mapLevel(bucket.callWall),
      putWall: mapLevel(bucket.putWall),
      vannaMagnet: mapLevel(bucket.vannaMagnet),
    })),
  };
}

export function ReversalZones() {
  const [viewSymbol, setViewSymbol] = useState<ViewSymbol>("NDX");
  const [payload, setPayload] = useState<OptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [futuresContext, setFuturesContext] = useState<FuturesContext | null>(null);
  const [overnightState, setOvernightState] = useState<OvernightState | null>(null);
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
    fetch(`/api/options/${viewSymbol}?updates=live&through=${through}&view=reversal`, { cache: "no-store" })
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

  useEffect(() => {
    let cancelled = false;
    const symbol = viewSymbol === "NDX" ? "NQ" : "ES";
    fetch(`/api/futures/${symbol}?mode=overnight`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Overnight context unavailable.");
        return await response.json() as OvernightResponse;
      })
      .then((data) => {
        if (!cancelled) setOvernightState({ symbol, data });
      })
      .catch(() => {
        // The rail remains useful with quote and options context alone.
      });
    return () => { cancelled = true; };
  }, [viewSymbol, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    const symbol = viewSymbol === "NDX" ? "NQ" : "ES";
    Promise.all([
      fetch(`/api/futures/${symbol}`, { cache: "no-store" }),
      fetch(`/api/futures/${symbol}?mode=live`, { cache: "no-store" }),
    ])
      .then(async ([settlementResponse, quoteResponse]) => {
        if (!settlementResponse.ok || !quoteResponse.ok) throw new Error("Futures context is unavailable.");
        return {
          settlement: await settlementResponse.json() as FuturesSettlement,
          quote: await quoteResponse.json() as FuturesQuote,
        };
      })
      .then((context) => {
        if (!cancelled && context.settlement.price > 0 && context.quote.price > 0) setFuturesContext(context);
      })
      .catch(() => {
        // Keep native index coordinates as a graceful fallback.
      });
    return () => { cancelled = true; };
  }, [viewSymbol, refreshToken]);

  const nativeSnapshot = useMemo(() => payload ? toSnapshot(payload) : null, [payload]);
  const activeFuturesContext = futuresContext?.quote.symbol === (viewSymbol === "NDX" ? "NQ" : "ES") ? futuresContext : null;
  const activeOvernight = overnightState?.symbol === (viewSymbol === "NDX" ? "NQ" : "ES") ? overnightState : null;
  const snapshot = useMemo(() => nativeSnapshot && activeFuturesContext ? mapSnapshotToFutures(nativeSnapshot, activeFuturesContext) : nativeSnapshot, [nativeSnapshot, activeFuturesContext]);
  const analysis = useMemo(() => snapshot ? buildReversalAnalysis(snapshot) : null, [snapshot]);
  const reactionZones = analysis?.zones.filter((zone) => zone.kind === "Reversal candidate" || zone.kind === "Pin / magnet") ?? [];
  const transitionZones = analysis?.zones.filter((zone) => zone.kind === "Transition zone") ?? [];
  const accelerationZones = analysis?.zones.filter((zone) => zone.kind === "Acceleration zone") ?? [];
  const bestZone = reactionZones[0] ?? null;
  const gammaFlip = snapshot?.levels.gammaFlip ?? null;
  const gammaRegime = payload && Number.isFinite(payload.netGamma)
    ? Number(payload.netGamma) > 0 ? "Stabilizing" : Number(payload.netGamma) < 0 ? "Amplifying" : "Unclear"
    : "Unclear";

  return (
    <div className="reversal-page">
      <header className="reversal-header">
        <div className="reversal-heading">
          <h1>Where price is likely to react</h1>
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

      {loading && !analysis ? <ReversalSkeleton /> : null}
      {error ? <div className="reversal-error" role="alert">{error}<button type="button" onClick={() => reload()}>Try again</button></div> : null}

      {snapshot && analysis ? (
        <>
          <div className="reversal-asof-row">
            <span><i className={snapshot.stale || activeFuturesContext?.quote.stale ? "status-dot status-dot--caution" : "status-dot"} />{activeFuturesContext ? `${activeFuturesContext.quote.symbol} ${money(activeFuturesContext.quote.price)}` : snapshot.stale ? "Cached snapshot" : "Market snapshot"}</span>
            <span>{activeFuturesContext ? `Quote ${shortDateTime(activeFuturesContext.quote.observedAt)} · ${snapshot.symbol} book ${shortDateTime(snapshot.timestamp)} · ${activeFuturesContext.settlement.contract} basis ${activeFuturesContext.settlement.tradeDate}` : `${snapshot.symbol === "NDX" ? "Nasdaq 100" : "S&P 500"} · as of ${timestamp(snapshot.timestamp)}`}</span>
          </div>

          <MarketNowRail snapshot={snapshot} futuresContext={activeFuturesContext} overnight={activeOvernight} zones={analysis.zones} />

          <section className="reversal-hero" aria-label="Current reversal read">
            {bestZone ? <ZoneCard zone={bestZone} primary /> : <div className="reversal-best-card reversal-best-card--empty"><h2>No high-confluence zone</h2></div>}
            <article className="reversal-state-card">
              <div className="reversal-state-head"><span className="eyebrow">Market posture</span><span className={`reversal-posture reversal-posture--${gammaRegime.toLowerCase()}`}>{gammaRegime}</span></div>
              <div className="reversal-state-main"><span className="reversal-state-icon"><Icon kind={gammaRegime === "Stabilizing" ? "shield" : "spark"} /></span><div><span className="reversal-state-label">Gamma regime</span><strong>{gammaRegime}</strong></div></div>
              <p className="reversal-state-copy">{gammaRegime === "Stabilizing" ? "Positive gamma is closer to a mean-reversion environment; reactions can hold when other inputs agree." : gammaRegime === "Amplifying" ? "Negative gamma raises break-and-run risk; treat nearby zones as acceleration warnings before fades." : "The flip is not available, so let the ranked zones and price response do more of the work."}</p>
              <dl className="reversal-level-list">
                <div><dt>{activeFuturesContext ? activeFuturesContext.quote.symbol : "Spot"}</dt><dd>{money(snapshot.spot)}</dd></div>
                <div><dt>Gamma flip</dt><dd>{money(snapshot.levels.gammaFlip)} <small>{gammaFlip !== null ? signedPercent(((gammaFlip - snapshot.spot) / snapshot.spot) * 100) : ""}</small></dd></div>
                <div><dt>Max pain</dt><dd>{money(snapshot.levels.maxPain)}</dd></div>
                <div><dt>Front skew</dt><dd>{snapshot.riskReversal25 === null || snapshot.riskReversal25 === undefined ? "—" : signedPercent(snapshot.riskReversal25 * 100)}</dd></div>
              </dl>
            </article>
          </section>

          <ExpiryLens snapshot={snapshot} />

          <ReversalMap analysis={analysis} snapshot={snapshot} />

          <ZoneLadder snapshot={snapshot} zones={analysis.zones} />

          <section className="reversal-zones-section">
            <div className="reversal-section-head"><div><h2>Other reaction zones</h2></div><span className="reversal-section-count">{Math.max(0, reactionZones.length - 1) + transitionZones.length} zones</span></div>
            {reactionZones.length > 1 || transitionZones.length ? <div className="reversal-zone-grid">{[...reactionZones.slice(1), ...transitionZones].slice(0, 3).map((zone) => <ZoneCard key={`${zone.center}-${zone.kind}`} zone={zone} />)}</div> : <div className="reversal-empty-state">No additional stabilizing shelf is close enough to rank.</div>}
          </section>

          <section className="reversal-zones-section reversal-zones-section--break">
            <div className="reversal-section-head"><div><h2>Break risk</h2></div><span className="reversal-section-count">{accelerationZones.length} zones</span></div>
            {accelerationZones.length ? <div className="reversal-zone-grid">{accelerationZones.slice(0, 3).map((zone) => <ZoneCard key={`${zone.center}-${zone.kind}`} zone={zone} />)}</div> : <div className="reversal-empty-state">No nearby negative-gamma shelf currently ranks as break risk.</div>}
          </section>

          <details className="reversal-explain">
            <summary>How the confluence score works <span>+</span></summary>
            <div className="reversal-explain-grid">
              <p><strong>Stabilizing gamma</strong> is the reversal input. It is stronger when a nearby strike also carries a sharp speed transition, vanna or charm concentration, and meaningful open interest.</p>
              <p><strong>Amplifying gamma</strong> is a risk flag, not a short signal. Negative gamma can make a move travel through a level instead of rejecting from it.</p>
              <p><strong>Score ≠ probability.</strong> This is a structural ranking until the app logs zone touches and outcomes well enough to calibrate hit rates.</p>
            </div>
          </details>
          <p className="data-disclaimer reversal-disclaimer">Modeled 0–45D dealer exposure. Open interest is a positioning proxy, not order flow.</p>
        </>
      ) : null}
    </div>
  );
}
