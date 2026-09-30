"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  DEFAULT_BRIDGE_PARTS,
  readBridgeParts,
  type BridgePart,
  type BridgeSource,
} from "@/lib/bridge-payload";
import { interpolateAt } from "@/lib/options-math";
import type { ExposureMagnitude } from "@/lib/exposure-magnitude";
import { isRegularMarketOpen, nextQuarterHour, nextWeekday, parseEasternTimestamp } from "@/lib/market-time";
import { PositioningTape } from "@/components/positioning-tape";
import { assessSnapshotQuality } from "@/lib/snapshot-quality";
import { readTopology, sampleTopology, type TopologyRow } from "@/lib/options-topology";
import { DxyStudy } from "@/components/dxy-study";

type Instrument = "NQ" | "ES";
type Metric = "gamma" | "delta" | "vanna" | "charm" | "vega" | "speed" | "zomma" | "vomma";
type View = "spine" | "bars";
type ExpiryMode = "single" | "through" | "custom" | "composite";
type PriceScale = "native" | "futures";
type Shelf = "levels" | "chain" | "flow" | "volatility" | "term" | "indicator" | "topology";
type UpdateMode = "eod" | "live";

type LiveStrike = {
  strike: number;
  gamma: number;
  delta: number;
  vanna: number;
  charm: number;
  vega: number;
  speed: number;
  zomma: number;
  vomma: number;
  callOi: number;
  putOi: number;
  callVolume: number;
  putVolume: number;
  callIv: number | null;
  putIv: number | null;
};

type OptionLevels = {
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
  maxPain: number | null;
  vannaMagnet: number | null;
};

type SurfacePoint = {
  strike: number;
  iv: number;
  moneyness: number;
  standardized: number;
  delta: number;
  oi: number;
  source: "call" | "put";
};

type SurfaceSlice = {
  expiry: string;
  dte: number;
  years: number;
  forward: number;
  atmIv: number;
  putIv25: number | null;
  callIv25: number | null;
  riskReversal25: number | null;
  butterfly25: number | null;
  points: SurfacePoint[];
};

type SurfaceGrid = {
  buckets: number[];
  rows: {
    expiry: string;
    dte: number;
    atmIv: number;
    riskReversal25: number | null;
    cells: (number | null)[];
  }[];
  min: number;
  max: number;
};

type TopologySurfaceRow = Pick<LiveStrike, "strike" | "gamma" | "delta" | "vanna" | "charm" | "vega" | "speed" | "zomma" | "vomma">;

type TopologySurfaceSlice = {
  expiry: string;
  dte: number;
  rows: TopologySurfaceRow[];
};

type LiveOptionsData = {
  source: string;
  symbol: "NDX" | "SPX" | "QQQ" | "SPY";
  roots: string[];
  spot: number;
  timestamp: string | null;
  retrievedAt: string;
  updateMode: UpdateMode;
  stale: boolean;
  nextRefreshAt: string;
  methodologyVersion: string;
  expiry: string;
  expiries: string[];
  selection: {
    mode: ExpiryMode;
    start: string;
    end: string;
    expiries: string[];
    omittedExpiries?: string[];
    /** Requested dates that had settled by the time of the request. */
    settledExpiries?: string[];
  };
  flow?: {
    session: string;
    resolvedAgainst: string;
    rows: {
      contract: string;
      expiry: string;
      strike: number;
      type: "call" | "put";
      volume: number;
      priorOpenInterest: number;
      openInterestChange: number | null;
      intent: "opened" | "closed" | "churned" | "pending" | "expired" | "unexplained";
      turnover: number | null;
      notional: number | null;
      extrinsicNotional: number | null;
      moneyness: number;
    }[];
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
  } | null;
  expiryLevels: {
    expiry: string;
    contractCount: number;
    /** ISO instant this expiry settles, so an exported payload can outlive it. */
    settlesAt?: string | null;
    levels: OptionLevels;
  }[];
  topology: TopologySurfaceSlice[];
  expiryStats: {
    expiry: string;
    atmIv: number | null;
    openInterest: number;
    volume: number;
  }[];
  surface: SurfaceSlice[];
  /**
   * Strikes priced away from the volatility curve fitted through the strikes
   * beside them. Demand for one contract, and nothing about dealer hedging —
   * that is gamma, and it is the wall levels above.
   */
  volDislocation: {
    expiry: string;
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
  surfaceChange: {
    comparedTo: string;
    dte: number;
    atmIv: number;
    riskReversal25: number | null;
    butterfly25: number | null;
  } | null;
  surfaceHistoryDays: number;
  contractCount: number;
  openInterestContracts: number;
  assumptions: {
    dealerSign: string;
    riskFreeRate: number;
    dividendYield: number;
    higherGreeks: string;
    standardGreeks: string;
  };
  levels: OptionLevels;
  exposureMagnitude?: Record<Metric, ExposureMagnitude>;
  strikes: LiveStrike[];
};

type FuturesAnchorData = {
  symbol: Instrument;
  contract: string;
  price: number;
  tradeDate: string;
  kind: "official-settlement";
  source: string;
  delayed: true;
};

const metrics: { id: Metric; label: string; hint: string }[] = [
  { id: "gamma", label: "Gamma", hint: "Hedging pressure" },
  { id: "delta", label: "Delta", hint: "Directional exposure" },
  { id: "vanna", label: "Vanna", hint: "Volatility sensitivity" },
  { id: "charm", label: "Charm", hint: "Time-driven flow" },
  { id: "vega", label: "Vega", hint: "Volatility exposure" },
  { id: "speed", label: "Speed", hint: "Gamma acceleration" },
  { id: "zomma", label: "Zomma", hint: "Gamma versus IV" },
  { id: "vomma", label: "Vomma", hint: "Vega acceleration" },
];

const instruments = {
  NQ: {
    source: "NDX / NDXP",
  },
  ES: {
    source: "SPX / SPXW",
  },
} as const;

const metricCopy: Record<Metric, string> = {
  gamma: "Positive gamma can slow price; negative gamma can amplify it.",
  delta: "Shows where directional dealer hedging is most concentrated.",
  vanna: "Estimates flows caused by changes in implied volatility.",
  charm: "Estimates hedging flow created by time passing.",
  vega: "Maps where the book is most sensitive to implied volatility.",
  speed: "Shows where gamma itself may change fastest as price moves.",
  zomma: "Shows where gamma is most sensitive to volatility changes.",
  vomma: "Shows where vega may accelerate as volatility changes.",
};

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSignedCompact(value: number) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatCompact(Math.abs(value))}`;
}

function formatBalance(value: number | null) {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

function levelDistance(level: number | null, spot: number) {
  return level === null ? null : (level / spot - 1) * 100;
}

function confirmationPosition(level: number | null, spot: number) {
  const distance = levelDistance(level, spot);
  if (distance === null) return 50;
  return Math.max(2, Math.min(98, 50 + (distance / 4) * 50));
}

function futuresEquivalent(level: number | null, sourceSpot: number, futuresSpot: number | null) {
  if (level === null || futuresSpot === null || !Number.isFinite(futuresSpot)) return null;
  return Math.round(((level / sourceSpot) * futuresSpot) / 0.25) * 0.25;
}

function calendarDte(expiry: string, baseDate: string) {
  return Math.max(
    0,
    Math.round((Date.parse(`${expiry}T12:00:00Z`) - Date.parse(`${baseDate}T12:00:00Z`)) / 86_400_000),
  );
}

function shortExpiry(expiry: string) {
  const date = new Date(`${expiry}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date),
    monthDay: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date),
  };
}

function formatStrike(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function sourceDate(value: string) {
  const timezoneDeclared = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(timezoneDeclared ? normalized : `${normalized}Z`);
}

function bridgeWarningAfter(snapshot: Date) {
  const nextSession = nextWeekday(easternDate(snapshot.toISOString()));
  const nextQuote = parseEasternTimestamp(`${nextSession} 09:45`);
  return new Date(Math.max(snapshot.valueOf() + 24 * 60 * 60 * 1000, nextQuote ? Date.parse(nextQuote) : 0));
}

function formatSourceTime(value: string, includeDate = true) {
  return new Intl.DateTimeFormat("en-US", {
    ...(includeDate
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { hour: "numeric", minute: "2-digit" }),
    timeZoneName: "short",
  }).format(sourceDate(value));
}

function easternDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(sourceDate(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const BRIDGE_PARTS_KEY = "gexlab:bridge-parts";

// Geometry of the spot readout plate in the exposure profile, in viewBox units.
// Named because the peak-label placement has to route around the same box that
// draws it; two hand-copied numbers would drift the moment either moved.
const SPOT_PLATE_LEFT = 352;
const SPOT_PLATE_WIDTH = 120;
const SPOT_PLATE_HALF_HEIGHT = 13;
/** Roughly how wide a peak caption runs, used only to test for a collision. */
const PEAK_LABEL_WIDTH = 46;

function bridgeNumber(value: number | null) {
  return value === null || !Number.isFinite(value) ? "0" : String(Math.round(value * 100) / 100);
}

const INTENT_COPY: Record<string, { label: string; note: string; tone: string }> = {
  opened: { label: "Opened", note: "Most of what traded stayed on", tone: "constructive" },
  closed: { label: "Closed", note: "Most of what traded came off", tone: "stress" },
  churned: { label: "Churned", note: "Traded heavily, left little behind", tone: "neutral" },
  pending: { label: "Pending", note: "Resolves with the next session's open interest", tone: "neutral" },
  expired: { label: "Expired", note: "Expired the day it traded; nothing left to resolve", tone: "neutral" },
  unexplained: { label: "Unexplained", note: "Open interest moved by more than traded — exercise or a correction", tone: "caution" },
};

function compactDollars(value: number | null) {
  if (value === null) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `$${Math.round(value / 1e3)}k`;
  return `$${Math.round(value)}`;
}

/**
 * The session's largest option trades.
 *
 * Ordered by premium at risk rather than contracts or gross premium, and every
 * row carries what it left behind in open interest, because size on its own
 * cannot tell a position from a day trade. The two figures are from different
 * sessions by necessity — open interest lags — and the header says so rather
 * than letting the table imply they are simultaneous.
 */
const flowDate = (value: string) => shortExpiry(value).monthDay;

function LargeTrades({ flow }: { flow: NonNullable<LiveOptionsData["flow"]> }) {
  const { summary } = flow;
  return (
    <div className="large-trades">
      <div className="large-trades-head">
        <div>
          <p className="section-kicker">
            Session {flowDate(flow.session)} · open interest confirmed {flowDate(flow.resolvedAgainst)}
          </p>
          <h3>{summary.contracts} trades above the size floor</h3>
        </div>
        <div className="large-trades-totals">
          <span>
            <small>Call premium at risk</small>
            <strong>{compactDollars(summary.callNotional)}</strong>
          </span>
          <span>
            <small>Put premium at risk</small>
            <strong>{compactDollars(summary.putNotional)}</strong>
          </span>
          <span>
            <small>Opened</small>
            <strong>{compactDollars(summary.openedNotional)}</strong>
          </span>
          <span>
            <small>Closed</small>
            <strong>{compactDollars(summary.closedNotional)}</strong>
          </span>
        </div>
      </div>

      <div className="large-trades-table" role="grid" aria-label="Largest option trades">
        <div className="large-trades-row large-trades-row--head" role="row">
          <span role="columnheader">Contract</span>
          <span role="columnheader">Volume</span>
          <span role="columnheader">Δ open interest</span>
          <span role="columnheader">At risk</span>
          <span role="columnheader">Intent</span>
        </div>
        {flow.rows.map((row) => {
          const intent = INTENT_COPY[row.intent] ?? INTENT_COPY.pending;
          return (
            <div className="large-trades-row" role="row" key={row.contract} title={intent.note}>
              <span role="gridcell">
                <strong>
                  {row.strike.toLocaleString()} {row.type === "call" ? "C" : "P"}
                </strong>
                <em>
                  {flowDate(row.expiry)} · {row.moneyness > 0 ? "+" : ""}
                  {row.moneyness.toFixed(1)}% from spot
                </em>
              </span>
              <span role="gridcell">{row.volume.toLocaleString()}</span>
              <span role="gridcell">
                {row.openInterestChange === null
                  ? "—"
                  : `${row.openInterestChange > 0 ? "+" : ""}${row.openInterestChange.toLocaleString()}`}
              </span>
              <span role="gridcell">
                {compactDollars(row.extrinsicNotional)}
                {/* Gross premium only when it differs enough to matter: for a
                    deep in-the-money strike most of the cheque is intrinsic. */}
                {row.notional !== null &&
                  row.extrinsicNotional !== null &&
                  row.notional > row.extrinsicNotional * 1.25 && (
                    <em>{compactDollars(row.notional)} gross</em>
                  )}
              </span>
              <span role="gridcell">
                <b className={`large-trades-intent large-trades-intent--${intent.tone}`}>
                  {intent.label}
                </b>
              </span>
            </div>
          );
        })}
      </div>

      <p className="data-disclaimer">{flow.method}</p>
      <p className="data-disclaimer">{flow.caveat}</p>
    </div>
  );
}

function topologyRows(snapshot: LiveOptionsData | null, metric: Metric): TopologyRow[] {
  if (!snapshot) return [];
  const halfRange = snapshot.spot * 0.032;
  return sampleTopology(
    snapshot.strikes
      .filter((row) => row.strike >= snapshot.spot - halfRange && row.strike <= snapshot.spot + halfRange)
      .map((row) => ({ strike: row.strike, value: row[metric] })),
  );
}

function topologyPath(rows: TopologyRow[], left: number, top: number, width: number, height: number) {
  if (!rows.length) return "";
  const high = rows.at(-1)?.strike ?? 1;
  const low = rows[0]?.strike ?? 0;
  const maxAbs = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  const center = left + width / 2;
  return rows
    .map((row, index) => {
      const y = top + ((high - row.strike) / Math.max(high - low, 1)) * height;
      const x = center + (row.value / maxAbs) * (width / 2 - 8);
      return `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function TopologyStudy({
  snapshot,
  comparison,
  metric,
  surfaceGrid,
  topology,
  expiryStats,
  instrument,
  onMetric,
}: {
  snapshot: LiveOptionsData | null;
  comparison: LiveOptionsData | null;
  metric: Metric;
  surfaceGrid: SurfaceGrid | null;
  topology: TopologySurfaceSlice[];
  expiryStats: LiveOptionsData["expiryStats"];
  instrument: Instrument;
  onMetric: (metric: Metric) => void;
}) {
  const [topologyView, setTopologyView] = useState<"surface" | "iv" | "field" | "expiry">("surface");
  const primaryRows = topologyRows(snapshot, metric);
  const primaryReading = readTopology(primaryRows);
  const comparisonRows = topologyRows(comparison, metric);
  const comparisonReading = readTopology(comparisonRows);
  const maxTermIv = Math.max(...expiryStats.map((row) => row.atmIv ?? 0), 0.01);
  const totalOpenInterest = expiryStats.reduce((sum, row) => sum + Math.max(row.openInterest, 0), 0);
  const surfaceSlices = topology.filter((slice) => slice.rows.length).slice(0, 24);
  const surfaceValues = surfaceSlices.flatMap((slice) => slice.rows.map((row) => row[metric]));
  const surfaceMax = Math.max(...surfaceValues.map((value) => Math.abs(value)), 1);
  const surfaceMinMoneyness = -3.2;
  const surfaceMaxMoneyness = 3.2;
  const surfaceX = (strike: number) => {
    const moneyness = snapshot ? ((strike / snapshot.spot) - 1) * 100 : 0;
    return 96 + ((Math.max(surfaceMinMoneyness, Math.min(surfaceMaxMoneyness, moneyness)) - surfaceMinMoneyness) / (surfaceMaxMoneyness - surfaceMinMoneyness)) * 728;
  };
  const surfaceCells = surfaceSlices.flatMap((slice, sliceIndex) => {
    const rows = [...slice.rows].sort((left, right) => left.strike - right.strike);
    const y = 28 + sliceIndex * Math.max(14, 380 / Math.max(surfaceSlices.length, 1));
    const rowHeight = Math.max(12, 380 / Math.max(surfaceSlices.length, 1));
    return rows.map((row, rowIndex) => {
      const x = surfaceX(row.strike);
      const previousX = rowIndex ? surfaceX(rows[rowIndex - 1].strike) : 96;
      const nextX = rowIndex < rows.length - 1 ? surfaceX(rows[rowIndex + 1].strike) : 824;
      const left = rowIndex ? (previousX + x) / 2 : 96;
      const right = rowIndex < rows.length - 1 ? (x + nextX) / 2 : 824;
      const value = row[metric];
      return { key: `${slice.expiry}-${row.strike}`, x: left, y, width: Math.max(2, right - left), height: rowHeight, value };
    });
  });

  return (
    <div className="topology-study">
      <header className="topology-study-head">
        <div>
          <p className="section-kicker">Options topology</p>
          <h3>Where the field clusters, bends, and changes shape.</h3>
          <p>
            Topology describes the arrangement of exposure and volatility across strikes and expiries.
            It is a shape read, not a directional signal.
          </p>
        </div>
        <div className="expiry-mode" aria-label="Topology view">
          <button data-active={topologyView === "surface" || undefined} onClick={() => setTopologyView("surface")}>
            Greek surface
          </button>
          <button data-active={topologyView === "iv" || undefined} onClick={() => setTopologyView("iv")}>
            IV surface
          </button>
          <button data-active={topologyView === "field" || undefined} onClick={() => setTopologyView("field")}>
            Greek field
          </button>
          <button data-active={topologyView === "expiry" || undefined} onClick={() => setTopologyView("expiry")}>
            Expiry field
          </button>
        </div>
      </header>

      {topologyView === "surface" && (
        <div className="topology-greek-surface">
          <div className="topology-metric-picker" aria-label="Greek surface metric">
            {metrics.map((item) => (
              <button key={item.id} data-active={metric === item.id || undefined} onClick={() => onMetric(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          {!surfaceSlices.length ? (
            <div className="data-pending"><strong>Not enough per-expiry exposure rows to build the Greek surface.</strong></div>
          ) : (
            <svg className="topology-surface-map" viewBox="0 0 860 450" role="img" aria-label={`${metric} exposure surface by expiry and strike`}>
              <line x1="96" x2="824" y1="416" y2="416" className="topology-axis" />
              <line x1={surfaceX(snapshot?.spot ?? 0)} x2={surfaceX(snapshot?.spot ?? 0)} y1="20" y2="416" className="topology-spot-axis" />
              <text x="96" y="438" className="topology-axis-label">−3.2% moneyness</text>
              <text x="824" y="438" textAnchor="end" className="topology-axis-label">+3.2%</text>
              <text x={surfaceX(snapshot?.spot ?? 0)} y="438" textAnchor="middle" className="topology-axis-label">SPOT</text>
              {surfaceSlices.map((slice, index) => (
                <text key={slice.expiry} x="84" y={36 + index * Math.max(14, 380 / Math.max(surfaceSlices.length, 1))} textAnchor="end" className="topology-expiry-label">
                  {slice.dte}D
                </text>
              ))}
              {surfaceCells.map((cell) => (
                <rect
                  key={cell.key}
                  x={cell.x}
                  y={cell.y}
                  width={cell.width}
                  height={cell.height}
                  fill={cell.value >= 0 ? "var(--constructive)" : "var(--stress)"}
                  fillOpacity={0.12 + Math.min(Math.abs(cell.value) / surfaceMax, 1) * 0.78}
                  className="topology-surface-cell"
                >
                  <title>{`${metric} ${formatCompact(cell.value)}`}</title>
                </rect>
              ))}
            </svg>
          )}
          <p className="data-disclaimer">Each row is a listed expiry and each column is strike moneyness around spot. Color shows the selected Greek’s signed exposure; intensity shows magnitude within this surface.</p>
        </div>
      )}

      {topologyView === "field" && (
        <div className="topology-field-layout">
          <div className="topology-field-copy">
            <div className="topology-reading topology-reading--primary">
              <span>{snapshot?.symbol ?? (instrument === "NQ" ? "NDX" : "SPX")} · {metric}</span>
              <strong>{primaryReading.label}</strong>
              <p>{primaryReading.detail}</p>
            </div>
            <div className="topology-reading">
              <span>{comparison?.symbol ?? (instrument === "NQ" ? "QQQ" : "SPY")} · {metric}</span>
              <strong>{comparisonReading.label}</strong>
              <p>{comparison ? comparisonReading.detail : "Waiting for the comparison book."}</p>
            </div>
            <p className="data-disclaimer">
              Each line is zero-centered and normalized within its own book. The selected {metric} lens is
              highlighted in the field; use the main exposure atlas below the expiry controls to inspect an exact row.
            </p>
          </div>
          <svg className="topology-field" viewBox="0 0 720 420" role="img" aria-label="Greek exposure topology by strike">
            <line x1="360" x2="360" y1="20" y2="400" className="topology-axis" />
            {metrics.map((item, index) => {
              const top = 12 + index * 49;
              const rows = topologyRows(snapshot, item.id);
              const companionRows = topologyRows(comparison, item.id);
              const active = item.id === metric;
              return (
                <g key={item.id} className={active ? "topology-row topology-row--active" : "topology-row"}>
                  <text x="8" y={top + 19}>{item.label.toUpperCase()}</text>
                  <line x1="74" x2="646" y1={top + 25} y2={top + 25} className="topology-row-rule" />
                  <path d={topologyPath(rows, 74, top + 4, 572, 40)} className="topology-path topology-path--primary" />
                  {companionRows.length > 1 && (
                    <path d={topologyPath(companionRows, 74, top + 4, 572, 40)} className="topology-path topology-path--comparison" />
                  )}
                  {active && <circle cx="360" cy={top + 25} r="3" className="topology-focus" />}
                </g>
              );
            })}
            <text x="360" y="415" textAnchor="middle" className="topology-axis-label">ZERO · normalized field</text>
          </svg>
        </div>
      )}

      {topologyView === "iv" && (
        <div className="topology-surface">
          {!surfaceGrid ? (
            <div className="data-pending"><strong>Not enough quoted strikes to build the IV topology.</strong></div>
          ) : (
            <>
              <table className="topology-surface-table" aria-label="Implied volatility topology">
                <thead>
                  <tr>
                    <th scope="col">DTE</th>
                    {surfaceGrid.buckets.map((bucket) => <th key={bucket} scope="col">{bucket > 0 ? `+${bucket}` : bucket}</th>)}
                    <th scope="col">RR</th>
                  </tr>
                </thead>
                <tbody>
                  {surfaceGrid.rows.map((row) => (
                    <tr key={row.expiry}>
                      <th scope="row">{row.dte}</th>
                      {row.cells.map((cell, index) => (
                        <td
                          key={surfaceGrid.buckets[index]}
                          title={cell === null ? "No quote" : `${row.expiry} at ${surfaceGrid.buckets[index]} sigma: ${(cell * 100).toFixed(1)}%`}
                          style={cell === null ? undefined : { background: `color-mix(in oklab, var(--surface-hot) ${(((cell - surfaceGrid.min) / Math.max(surfaceGrid.max - surfaceGrid.min, 0.0001)) * 100).toFixed(0)}%, var(--surface-cold))` }}
                        >
                          {cell === null ? "" : (cell * 100).toFixed(0)}
                        </td>
                      ))}
                      <td className="surface-rr">{row.riskReversal25 === null ? "—" : (row.riskReversal25 * 100).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="data-disclaimer">Rows are expiries; columns are standardized moneyness. Hotter cells are richer implied volatility, not a forecast of direction.</p>
            </>
          )}
        </div>
      )}

      {topologyView === "expiry" && (
        <div className="topology-expiry">
          <div className="topology-expiry-head"><span>Expiry</span><span>ATM IV</span><span>Open-interest share</span></div>
          {expiryStats.slice(0, 12).map((row) => (
            <div className="topology-expiry-row" key={row.expiry}>
              <span><strong>{calendarDte(row.expiry, easternDate(snapshot?.timestamp ?? new Date().toISOString()))}DTE</strong><small>{shortExpiry(row.expiry).monthDay}</small></span>
              <i><b style={{ width: `${((row.atmIv ?? 0) / maxTermIv) * 100}%` }} /></i>
              <span>{row.atmIv === null ? "—" : `${(row.atmIv * 100).toFixed(1)}%`} · {totalOpenInterest ? `${((row.openInterest / totalOpenInterest) * 100).toFixed(0)}% OI` : "—"}</span>
            </div>
          ))}
          {!expiryStats.length && <div className="data-pending"><strong>Expiry topology is waiting for contract statistics.</strong></div>}
          <p className="data-disclaimer">Expiry topology combines the term shape of ATM IV with the share of open interest in each listed expiry.</p>
        </div>
      )}
    </div>
  );
}

function MarketProfileChart({
  snapshot,
  fallbackSymbol,
  metric,
  view,
  priceScale,
  futuresAnchor,
  selectedExpiry,
  onPin,
  pinned = null,
}: {
  snapshot: LiveOptionsData | null;
  fallbackSymbol: string;
  metric: Metric;
  view: View;
  priceScale: PriceScale;
  futuresAnchor: number | null;
  selectedExpiry: string;
  onPin?: (strike: number) => void;
  /** The selected strike, in this profile's own price space. */
  pinned?: number | null;
}) {
  // Declared before the waiting-for-data branch: a hook cannot sit behind a
  // conditional return.
  const [hoverStrike, setHoverStrike] = useState<number | null>(null);

  if (!snapshot) {
    return (
      <section className="market-profile market-profile--loading">
        <header>
          <div><strong>{fallbackSymbol}</strong><span>Waiting for market data</span></div>
        </header>
        <div>Loading profile…</div>
      </section>
    );
  }

  const convert = (value: number | null) =>
    priceScale === "native" ? value : futuresEquivalent(value, snapshot.spot, futuresAnchor);
  const scaleReady = priceScale === "native" || futuresAnchor !== null;
  const levels = [
    { label: "CALL", value: snapshot.levels.callWall, tone: "call" },
    { label: "FLIP", value: snapshot.levels.gammaFlip, tone: "flip" },
    { label: "PUT", value: snapshot.levels.putWall, tone: "put" },
  ].filter((level): level is { label: string; value: number; tone: string } => level.value !== null);
  const halfRange = snapshot.spot * 0.032;
  const lower = Math.min(snapshot.spot - halfRange, ...levels.map((level) => level.value));
  const upper = Math.max(snapshot.spot + halfRange, ...levels.map((level) => level.value));
  const inRange = snapshot.strikes
    .filter((row) => row.strike >= lower && row.strike <= upper)
    .sort((left, right) => right.strike - left.strike);
  const important = new Set(
    levels.map((level) =>
      inRange.reduce(
        (best, row) => Math.abs(row.strike - level.value) < Math.abs(best.strike - level.value) ? row : best,
        inRange[0],
      )?.strike,
    ),
  );
  const stride = Math.max(1, Math.ceil(inRange.length / 32));
  const rows = inRange.filter((row, index) => index % stride === 0 || important.has(row.strike));
  const top = 54;
  const bottom = 526;
  const center = 250;
  const width = 166;
  const high = rows[0]?.strike ?? snapshot.spot + 1;
  const low = rows.at(-1)?.strike ?? snapshot.spot - 1;
  const yFor = (value: number) => top + ((high - value) / Math.max(high - low, 1)) * (bottom - top);
  const maxExposure = Math.max(...inRange.map((row) => Math.abs(row[metric])), 1);
  const magnitude = snapshot.exposureMagnitude?.[metric] ?? null;
  const points = rows.map((row) => ({
    strike: row.strike,
    raw: row[metric],
    x: center + (row[metric] / maxExposure) * width,
    y: yFor(row.strike),
  }));
  // The band height each strike row occupies. The click targets are sized from
  // it, and so is the selected-row backdrop, so the highlight covers exactly
  // what was clicked.
  const band = (bottom - top) / Math.max(rows.length - 1, 1);
  // Decimation means the pinned strike is not always one of the drawn rows, so
  // the highlight lands on the row the click actually resolved to.
  const pinnedRow =
    pinned === null || !rows.length
      ? null
      : rows.reduce((best, row) =>
          Math.abs(row.strike - pinned) < Math.abs(best.strike - pinned) ? row : best,
        );
  const hovered = hoverStrike === null ? null : rows.find((row) => row.strike === hoverStrike) ?? null;
  const negativeClipId = `${snapshot.symbol.toLowerCase()}-${metric}-negative-exposure`;
  const positiveClipId = `${snapshot.symbol.toLowerCase()}-${metric}-positive-exposure`;
  const labelStride = Math.max(1, Math.ceil(rows.length / 8));
  const spotValue = convert(snapshot.spot);

  // The evenly spaced strike labels above almost never land on a peak, which
  // is exactly where the price matters. Local extrema are labelled directly
  // instead: a point is a peak when it is at least as large as both of its
  // neighbours, and only the strongest few per side are annotated so the
  // chart does not turn into a wall of text.
  const peakLabels = (() => {
    const localExtrema = points.filter((point, index) => {
      const previous = points[index - 1];
      const next = points[index + 1];
      if (!previous || !next) return false;
      const magnitude = Math.abs(point.raw);
      return (
        magnitude >= Math.abs(previous.raw) &&
        magnitude >= Math.abs(next.raw) &&
        // A low floor relative to the largest bar: when one strike dominates
        // the scale, a high threshold would suppress every other peak on the
        // chart, which is the opposite of what the labels are for.
        magnitude >= maxExposure * 0.05
      );
    });
    const strongest = (positive: boolean) =>
      localExtrema
        .filter((point) => (positive ? point.raw > 0 : point.raw < 0))
        .sort((left, right) => Math.abs(right.raw) - Math.abs(left.raw))
        .slice(0, 4);
    const chosen = [...strongest(true), ...strongest(false)].sort(
      (left, right) => left.y - right.y,
    );
    // Nudge labels apart where two peaks sit at almost the same height, so a
    // pair of nearby strikes stays readable. Each placement depends on the one
    // before it, so the running position is threaded through the accumulator
    // rather than held in a variable outside the loop.
    type PlacedPeak = (typeof chosen)[number] & {
      labelX: number;
      labelY: number;
      anchor: "start" | "end";
      /** A wall or flip rule already prints this strike's price. */
      onLevel: boolean;
    };
    return chosen.reduce<PlacedPeak[]>((placed, point) => {
      const onLevel = important.has(point.strike);
      const previousY = placed.length ? placed[placed.length - 1].labelY : -Infinity;
      // Peaks sitting on a level rule drop below it, so the text clears both
      // the dashed line and that rule's own label.
      const baseY = point.y + (onLevel ? 10 : 0);
      const labelY = Math.max(baseY, previousY + 13);
      const outward = point.raw >= 0 ? 9 : -9;
      const preferredX = point.x + outward;
      // The spot plate is an opaque box on the right of the plot at the spot
      // line. It is drawn after the labels, so a peak that landed under it
      // simply disappeared — and the peak nearest spot is the one most worth
      // reading. Labels that would sit beneath it flip to the other side of
      // their point, the same escape the plot edge already uses.
      const underSpotPlate =
        preferredX + PEAK_LABEL_WIDTH > SPOT_PLATE_LEFT &&
        Math.abs(labelY - yFor(snapshot.spot)) < SPOT_PLATE_HALF_HEIGHT + 5;
      const flips = preferredX > 462 || preferredX < 38 || underSpotPlate;
      const labelX = flips ? point.x - outward : preferredX;
      const anchor: "start" | "end" =
        (point.raw >= 0) === !flips ? "start" : "end";
      return [...placed, { ...point, labelX, labelY, anchor, onLevel }];
    }, []);
  })();

  return (
    <section className="market-profile">
      <header>
        <div>
          <strong>{snapshot.symbol}</strong>
          <span>{snapshot.symbol === "NDX" || snapshot.symbol === "SPX" ? "Index structure" : "ETF structure"}</span>
        </div>
        <div>
          <strong>{formatStrike(spotValue)}</strong>
          <span>{priceScale === "native" ? "Native spot" : `${fallbackSymbol === "NDX" || fallbackSymbol === "QQQ" ? "NQ" : "ES"} equivalent`}</span>
        </div>
      </header>
      {!scaleReady ? (
        <div className="profile-anchor-empty">Enter the futures anchor above to draw this profile.</div>
      ) : (
        <svg viewBox="0 0 500 580" role="group" aria-label={`${snapshot.symbol} ${metric} exposure by strike`}>
          <title>{`${snapshot.symbol} ${metric} exposure for ${selectedExpiry}`}</title>
          <defs>
            <clipPath id={negativeClipId}>
              <rect x="0" y="0" width={center} height="580" />
            </clipPath>
            <clipPath id={positiveClipId}>
              <rect x={center} y="0" width={500 - center} height="580" />
            </clipPath>
          </defs>
          <line x1={center} x2={center} y1={top - 16} y2={bottom + 12} className="strike-spine" />
          <text x={center} y={top - 23} textAnchor="middle" className="profile-zero-label">ZERO</text>

          {/* Selecting a strike used to change nothing on the chart it was
              clicked on. The chosen row now carries a backdrop the width of the
              plot, drawn behind the exposure so it never obscures a bar, with
              brackets at both ends. No price label: the inspector states it, and
              another number here would collide with the level rules. */}
          {pinnedRow && (
            <g className="profile-pin" key={`pin-${pinnedRow.strike}`}>
              <rect
                x="28"
                y={yFor(pinnedRow.strike) - band / 2}
                width="444"
                height={band}
              />
              <line x1="28" x2="40" y1={yFor(pinnedRow.strike)} y2={yFor(pinnedRow.strike)} />
              <line x1="460" x2="472" y1={yFor(pinnedRow.strike)} y2={yFor(pinnedRow.strike)} />
            </g>
          )}

          <g key={`${view}-${metric}-${selectedExpiry}-${priceScale}`} className="exposure-layer">
            {view === "bars" &&
              points.map((point, index) => (
                <line
                  key={point.strike}
                  x1={center}
                  x2={point.x}
                  y1={point.y}
                  y2={point.y}
                  style={{ animationDelay: `${Math.min(index * 7, 150)}ms` }}
                  className={point.raw >= 0 ? "profile-bar profile-bar--positive" : "profile-bar profile-bar--negative"}
                />
              ))}
            {view === "spine" && (
              <>
                <polyline
                  points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                  className="exposure-spine exposure-spine--negative"
                  clipPath={`url(#${negativeClipId})`}
                />
                <polyline
                  points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                  className="exposure-spine exposure-spine--positive"
                  clipPath={`url(#${positiveClipId})`}
                />
              </>
            )}
          </g>

          {(view === "bars" ? points : points.filter((_, index) => index % labelStride === 0)).map((point) => {
            const labelOnLeft = view === "bars" && point.raw >= 0;
            return (
              <g key={`label-${point.strike}`}>
                <line
                  x1={center - 4}
                  x2={center + 4}
                  y1={point.y}
                  y2={point.y}
                  className="strike-tick"
                />
                <text
                  x={labelOnLeft ? center - 9 : center + 9}
                  y={point.y + 3}
                  textAnchor={labelOnLeft ? "end" : "start"}
                  className={`strike-label${view === "bars" ? " strike-label--bar" : ""}`}
                >
                  {formatStrike(convert(point.strike))}
                </text>
              </g>
            );
          })}

          {peakLabels.map((peak) => (
            <g
              key={`peak-${peak.strike}`}
              className={`profile-peak profile-peak--${peak.raw >= 0 ? "positive" : "negative"}`}
            >
              {peak.labelY !== peak.y && (
                <line x1={peak.x} x2={peak.labelX} y1={peak.y} y2={peak.labelY} className="profile-peak-leader" />
              )}
              <circle cx={peak.x} cy={peak.y} r="2.5" />
              <text x={peak.labelX} y={peak.labelY + 3} textAnchor={peak.anchor}>
                {/* The price is omitted where a level rule already states it,
                    leaving the exposure the rule does not show. */}
                {peak.onLevel ? null : formatStrike(convert(peak.strike))}
                <tspan className="profile-peak-value">
                  {peak.onLevel ? formatCompact(peak.raw) : ` · ${formatCompact(peak.raw)}`}
                </tspan>
              </text>
            </g>
          ))}

          {levels.map((level) => (
            <g key={level.label} className={`atlas-level atlas-level--${level.tone}`}>
              <line x1="34" x2="466" y1={yFor(level.value)} y2={yFor(level.value)} />
              <text x="38" y={yFor(level.value) - 7}>
                {level.label} · {formatStrike(convert(level.value))}
              </text>
            </g>
          ))}

          <g className="spot-rule">
            <line x1="28" x2="472" y1={yFor(snapshot.spot)} y2={yFor(snapshot.spot)} />
            <circle cx={center} cy={yFor(snapshot.spot)} r="5" />
            <rect
              x={SPOT_PLATE_LEFT}
              y={yFor(snapshot.spot) - SPOT_PLATE_HALF_HEIGHT}
              width={SPOT_PLATE_WIDTH}
              height={SPOT_PLATE_HALF_HEIGHT * 2}
              rx="2"
            />
            <text x={SPOT_PLATE_LEFT + 10} y={yFor(snapshot.spot) + 4}>SPOT · {formatStrike(spotValue)}</text>
          </g>

          {/* The hovered strike, read without committing to it.
              The reaction map on the Reversal workspace has had a hover
              crosshair since it was built; this chart — the denser of the two
              and the one people actually read strike by strike — offered only
              click-to-pin and a native browser tooltip, which takes a second to
              appear and cannot be styled. Same gesture, same answer, on both
              charts now. */}
          {hovered && (
            <g className="profile-hover" aria-hidden="true">
              <line x1="24" x2="476" y1={yFor(hovered.strike)} y2={yFor(hovered.strike)} />
              <circle
                cx={center + (hovered[metric] / maxExposure) * width}
                cy={yFor(hovered.strike)}
                r="3.5"
                className={hovered[metric] >= 0 ? "profile-hover-dot--positive" : "profile-hover-dot--negative"}
              />
              {(() => {
                const y = yFor(hovered.strike);
                // Above the pointer normally, below it near the top edge.
                const flipped = y < top + 34;
                // On the side the curve is not using. Bars and peak captions
                // grow away from the spine in the direction of the sign, so a
                // plate fixed to the left sat on top of the very peak labels a
                // negative reading had just drawn there. The spot plate holds
                // the upper right, so a right-hand placement level with spot
                // goes left instead and accepts the quieter overlap.
                const nearSpot = Math.abs(y - yFor(snapshot.spot)) < SPOT_PLATE_HALF_HEIGHT + 22;
                const onRight = hovered[metric] < 0 && !nearSpot;
                const plateX = onRight ? 320 : 30;
                return (
                  <g transform={`translate(0, ${flipped ? y + 10 : y - 44})`}>
                    <rect className="profile-hover-plate" x={plateX} y="0" width="150" height="34" rx="2" />
                    <text className="profile-hover-strike" x={plateX + 8} y="14">
                      {formatStrike(convert(hovered.strike))}
                    </text>
                    <text className="profile-hover-value" x={plateX + 8} y="27">
                      {formatCompact(hovered[metric])} {metric} · OI{" "}
                      {(hovered.callOi + hovered.putOi).toLocaleString()}
                    </text>
                  </g>
                );
              })()}
            </g>
          )}

          {rows.map((row) => {
            const exposure = row[metric];
            const displayStrike = formatStrike(convert(row.strike));
            const selected = pinnedRow?.strike === row.strike;
            return (
              <rect
                key={`hit-${row.strike}`}
                x="24"
                y={yFor(row.strike) - band / 2}
                width="452"
                height={band}
                className="strike-hit"
                tabIndex={onPin ? 0 : undefined}
                role={onPin ? "button" : undefined}
                aria-pressed={onPin ? selected : undefined}
                aria-label={
                  onPin
                    ? `${snapshot.symbol} strike ${displayStrike}, ${formatCompact(exposure)} ${metric} exposure. Inspect strike.`
                    : undefined
                }
                onMouseEnter={() => setHoverStrike(row.strike)}
                onMouseLeave={() => setHoverStrike((current) => (current === row.strike ? null : current))}
                onFocus={() => setHoverStrike(row.strike)}
                onBlur={() => setHoverStrike((current) => (current === row.strike ? null : current))}
                onClick={onPin ? () => onPin(row.strike) : undefined}
                onKeyDown={
                  onPin
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onPin(row.strike);
                        }
                      }
                    : undefined
                }
              />
            );
          })}
        </svg>
      )}
      <div className="profile-magnitude" aria-label={`${snapshot.symbol} absolute ${metric} magnitude`}>
        <span>
          <small>Peak |{metric}|</small>
          <strong>{magnitude ? formatCompact(magnitude.peak) : "—"}</strong>
        </span>
        <span>
          <small>Gross</small>
          <strong>{magnitude ? formatCompact(magnitude.gross) : "—"}</strong>
        </span>
        <span>
          <small>Net / gross</small>
          <strong>{magnitude ? formatSignedCompact(magnitude.net) + " / " + formatBalance(magnitude.balance) : "—"}</strong>
        </span>
      </div>
      <footer>
        <span className="profile-direction profile-direction--negative"><i aria-hidden="true" />Negative</span>
        <span>Zero-centered · shape normalized</span>
        <span className="profile-direction profile-direction--positive"><i aria-hidden="true" />Positive</span>
      </footer>
    </section>
  );
}

// Responses are pure functions of the server's stored snapshot, so a selection
// the user already visited can be replayed from memory until that snapshot is
// due for refresh. Switching expiry scope then costs nothing.
const MIN_RESPONSE_CACHE_MS = 30_000;
const MAX_RESPONSE_CACHE_MS = 15 * 60_000;
const MAX_CACHED_RESPONSES = 48;

type CachedResponse = { data: LiveOptionsData; expiresAt: number };
const GLOBAL_RESPONSE_CACHE = new Map<string, CachedResponse>();

function responseExpiry(data: LiveOptionsData, now = Date.now()) {
  if (data.stale) return now + MIN_RESPONSE_CACHE_MS;
  const declared = Date.parse(data.nextRefreshAt);
  const horizon = Number.isFinite(declared) ? declared : now + MIN_RESPONSE_CACHE_MS;
  return Math.min(Math.max(horizon, now + MIN_RESPONSE_CACHE_MS), now + MAX_RESPONSE_CACHE_MS);
}

function rememberResponse(cache: Map<string, CachedResponse>, key: string, data: LiveOptionsData) {
  cache.delete(key);
  cache.set(key, { data, expiresAt: responseExpiry(data) });
  while (cache.size > MAX_CACHED_RESPONSES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function OptionsAtlas() {
  const [instrument, setInstrument] = useState<Instrument>("NQ");
  const [metric, setMetric] = useState<Metric>("gamma");
  const [view, setView] = useState<View>("spine");
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("single");
  const [selectedExpiries, setSelectedExpiries] = useState<string[]>([]);
  const [priceScale, setPriceScale] = useState<PriceScale>("native");
  const [scope, setScope] = useState("");
  // Null until the reader picks one. A hardcoded default used to be snapped to
  // the nearest listed strike, which put the inspector on whichever strike was
  // closest to 23,200 — far out of the money on an index trading near 27,800 —
  // and presented it as a selection nobody had made.
  const [pinnedStrike, setPinnedStrike] = useState<number | null>(null);
  const [shelf, setShelf] = useState<Shelf>("levels");
  const [surfaceView, setSurfaceView] = useState<"smile" | "surface">("smile");
  const [notice, setNotice] = useState("");
  // Which action confirmed, so the tick lands on the button that was pressed.
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const [marketData, setMarketData] = useState<LiveOptionsData | null>(null);
  const [comparisonData, setComparisonData] = useState<LiveOptionsData | null>(null);
  const [comparisonError, setComparisonError] = useState("");
  const [futuresAnchors, setFuturesAnchors] = useState<Record<Instrument, string>>({ NQ: "", ES: "" });
  const [anchorTimes, setAnchorTimes] = useState<Record<Instrument, string>>({ NQ: "", ES: "" });
  const [automaticAnchors, setAutomaticAnchors] = useState<Partial<Record<Instrument, FuturesAnchorData>>>({});
  const [anchorErrors, setAnchorErrors] = useState<Partial<Record<Instrument, string>>>({});
  const [bridgeParts, setBridgeParts] =
    useState<Record<BridgePart, boolean>>(DEFAULT_BRIDGE_PARTS);
  const [dataState, setDataState] = useState<"loading" | "ready" | "error">("loading");
  const [dataError, setDataError] = useState("");
  const [updateMode, setUpdateMode] = useState<UpdateMode>("eod");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const expiryRailRef = useRef<HTMLDivElement>(null);
  const lastRefreshTickRef = useRef(refreshTick);
  const displayedInstrumentRef = useRef<Instrument | null>(null);

  useEffect(() => {
    const selectStudy = (event: Event) => {
      const study = (event as CustomEvent<string>).detail;
      if (["topology", "levels", "chain", "volatility", "term", "indicator"].includes(study)) {
        setShelf(study as Shelf);
      }
    };
    window.addEventListener("gexlab:study", selectStudy);
    return () => window.removeEventListener("gexlab:study", selectStudy);
  }, []);

  useEffect(() => {
    const savedMode = window.localStorage.getItem("gexlab:options-update-mode");
    const savedParts = readBridgeParts(window.localStorage.getItem(BRIDGE_PARTS_KEY));
    queueMicrotask(() => {
      if (savedMode === "live") setUpdateMode("live");
      setBridgeParts(savedParts);
      setPreferencesLoaded(true);
    });
  }, []);

  useEffect(() => {
    // Guarded on the load having happened, so the defaults cannot overwrite a
    // stored preference on the first render.
    if (!preferencesLoaded) return;
    window.localStorage.setItem(BRIDGE_PARTS_KEY, JSON.stringify(bridgeParts));
  }, [bridgeParts, preferencesLoaded]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem("gexlab:options-update-mode", updateMode);
    if (updateMode !== "live") return;

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = Math.max(nextQuarterHour(new Date(), 20).valueOf() - Date.now(), 1_000);
      timer = setTimeout(() => {
        if (document.visibilityState === "visible" && isRegularMarketOpen()) {
          setRefreshTick((value) => value + 1);
        }
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [preferencesLoaded, updateMode]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    const cache = GLOBAL_RESPONSE_CACHE;
    // A scheduled live refresh is the one thing that must ignore the cache.
    if (lastRefreshTickRef.current !== refreshTick) {
      lastRefreshTickRef.current = refreshTick;
      cache.clear();
    }
    // Only a different instrument invalidates what is on screen. Changing
    // expiry scope keeps the previous profile rendered until the new one
    // arrives, so a cached selection swaps without a loading flash.
    const replacesInstrument = displayedInstrumentRef.current !== instrument;
    queueMicrotask(() => {
      setDataError("");
      setComparisonError("");
      if (replacesInstrument) {
        setDataState("loading");
        setMarketData(null);
        setComparisonData(null);
      } else {
        setRefreshing(true);
      }
    });
    const controller = new AbortController();
    const source = instrument === "NQ" ? "NDX" : "SPX";
    const companion = instrument === "NQ" ? "QQQ" : "SPY";
    const params = new URLSearchParams({ updates: updateMode });
    if ((expiryMode === "custom" || expiryMode === "composite") && selectedExpiries.length) {
      params.set("expiries", [...selectedExpiries].sort().join(","));
    } else if (scope) {
      params.set(expiryMode === "through" ? "through" : "expiry", scope);
    }
    const fetchOptions = async (symbol: string, queryParams: URLSearchParams) => {
      const query = `${symbol}?${queryParams.toString()}`;
      const cached = cache.get(query);
      if (cached && cached.expiresAt > Date.now()) return cached.data;
      const response = await fetch(`/api/options/${query}`, {
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `${symbol} market-data request failed.`);
      const data = payload as LiveOptionsData;
      rememberResponse(cache, query, data);
      return data;
    };

    void (async () => {
      try {
        const payload = await fetchOptions(source, params);
        // A cache hit resolves without touching the signal, so the abort has
        // to be checked explicitly or a superseded selection could land last.
        if (controller.signal.aborted) return;
        displayedInstrumentRef.current = instrument;
        setMarketData(payload);
        setDataState("ready");
        setRefreshing(false);

        // The clock can invalidate a selection while it is being held: hold the
        // 0DTE book through the close and the server drops it and answers with
        // the nearest live expiry. Drop it here too, or every later poll keeps
        // asking for a settled date and keeps being corrected.
        const settled = payload.selection.settledExpiries ?? [];
        if (settled.length) {
          setSelectedExpiries((current) => current.filter((date) => !settled.includes(date)));
          setScope((current) => (settled.includes(current) ? payload.selection.start : current));
          announce(
            `${settled.map(shortExpiry).join(", ")} settled · showing ${shortExpiry(payload.selection.start)}`,
            null,
          );
        }

        // Bind the ETF request to the primary response's exact effective scope.
        // This prevents a missing ETF expiry from silently becoming a different date.
        const comparisonParams = new URLSearchParams({ updates: updateMode });
        if (payload.selection.mode === "custom") {
          comparisonParams.set("expiries", payload.selection.expiries.join(","));
          comparisonParams.set("partialExpiries", "1");
        } else if (payload.selection.mode === "through") {
          comparisonParams.set("through", payload.selection.end);
        } else {
          comparisonParams.set("expiry", payload.selection.start);
        }
        try {
          const confirmation = await fetchOptions(companion, comparisonParams);
          if (controller.signal.aborted) return;
          setComparisonData(confirmation);
          const omitted = confirmation.selection.omittedExpiries?.length ?? 0;
          setComparisonError(
            omitted
              ? `${companion} does not list ${omitted} of the selected expiries; the comparison uses the ${confirmation.selection.expiries.length} shared dates only.`
              : "",
          );
        } catch (comparisonReason) {
          if (controller.signal.aborted) return;
          if (comparisonReason instanceof Error && comparisonReason.name === "AbortError") return;
          setComparisonData(null);
          setComparisonError(
            comparisonReason instanceof Error
              ? comparisonReason.message
              : "ETF confirmation unavailable for the exact selected expiry.",
          );
        }
        // Open on the at-the-money strike, but only when nothing is pinned.
        // This used to reassign unconditionally, so in live mode every poll
        // dragged the inspector off whatever the reader had selected and back
        // to spot.
        setPinnedStrike((current) =>
          current ??
          payload.strikes.reduce((best, row) =>
            Math.abs(row.strike - payload.spot) < Math.abs(best - payload.spot)
              ? row.strike
              : best,
          payload.strikes[0]?.strike ?? payload.spot),
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!(error instanceof Error)) {
          setRefreshing(false);
          setDataState("error");
          setDataError("Unknown market-data error.");
          return;
        }
        if (error.name === "AbortError") return;
        setRefreshing(false);
        setDataState("error");
        setDataError(error.message);
      }
    })();

    return () => controller.abort();
  }, [expiryMode, instrument, preferencesLoaded, refreshTick, scope, selectedExpiries, updateMode]);

  useEffect(() => {
    if (automaticAnchors[instrument] || anchorErrors[instrument]) return;
    const controller = new AbortController();
    fetch(`/api/futures/${instrument}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `${instrument} settlement request failed.`);
        setAutomaticAnchors((current) => ({ ...current, [instrument]: payload as FuturesAnchorData }));
        setAnchorErrors((current) => ({ ...current, [instrument]: "" }));
      })
      .catch((error: Error) => {
        if (error.name === "AbortError") return;
        setAnchorErrors((current) => ({ ...current, [instrument]: error.message }));
      });
    return () => controller.abort();
  }, [anchorErrors, automaticAnchors, instrument]);

  const cfg = instruments[instrument];
  const spot = marketData?.spot ?? 0;
  const callWall = marketData?.levels.callWall ?? null;
  const putWall = marketData?.levels.putWall ?? null;
  const gammaFlip = marketData?.levels.gammaFlip ?? null;
  const maxPain = marketData?.levels.maxPain ?? null;
  const vannaMagnet = marketData?.levels.vannaMagnet ?? null;
  const callAlignment =
    marketData && comparisonData &&
    marketData.levels.callWall !== null && comparisonData.levels.callWall !== null
      ? Math.abs(
          Number(levelDistance(marketData.levels.callWall, marketData.spot)) -
          Number(levelDistance(comparisonData.levels.callWall, comparisonData.spot)),
        )
      : null;
  const putAlignment =
    marketData && comparisonData &&
    marketData.levels.putWall !== null && comparisonData.levels.putWall !== null
      ? Math.abs(
          Number(levelDistance(marketData.levels.putWall, marketData.spot)) -
          Number(levelDistance(comparisonData.levels.putWall, comparisonData.spot)),
        )
      : null;
  const confirmationState =
    callAlignment !== null && putAlignment !== null
      ? callAlignment <= 0.35 && putAlignment <= 0.35
        ? "Aligned"
        : callAlignment <= 0.75 && putAlignment <= 0.75
          ? "Partial"
          : "Divergent"
      : "Pending";
  const manualAnchor =
    futuresAnchors[instrument].trim() && Number(futuresAnchors[instrument]) > 0
      ? Number(futuresAnchors[instrument])
      : null;
  const automaticAnchor = automaticAnchors[instrument] ?? null;
  const futuresAnchor = manualAnchor ?? automaticAnchor?.price ?? null;
  const snapshotDate = easternDate(marketData?.timestamp ?? new Date().toISOString());
  const currentEasternDate = easternDate(new Date().toISOString());
  const dteBase = currentEasternDate > snapshotDate ? currentEasternDate : snapshotDate;
  const selectedExpiry = scope || marketData?.expiry || "";
  const snapshotQuality = assessSnapshotQuality({
    state: dataState,
    stale: marketData?.stale,
    timestamp: marketData?.timestamp,
    updateMode: marketData?.updateMode ?? updateMode,
    contractCount: marketData?.contractCount,
    strikeCount: marketData?.strikes.length,
    expiryCount: marketData?.expiries.length,
  });
  const selectedDte = selectedExpiry ? calendarDte(selectedExpiry, dteBase) : null;
  const selectionCount =
    expiryMode === "custom" || expiryMode === "composite"
      ? selectedExpiries.length
      : marketData?.selection?.expiries.length ?? 1;
  const conversionRows = [
    { label: "Put wall", key: "putWall" as const },
    { label: "Profile crossing", key: "gammaFlip" as const },
    { label: "Call wall", key: "callWall" as const },
  ].map((row) => {
    const primary = marketData
      ? futuresEquivalent(marketData.levels[row.key], marketData.spot, futuresAnchor)
      : null;
    const companion = comparisonData
      ? futuresEquivalent(comparisonData.levels[row.key], comparisonData.spot, futuresAnchor)
      : null;
    return {
      ...row,
      primary,
      companion,
      difference: primary !== null && companion !== null ? Math.abs(primary - companion) : null,
    };
  });
  const displayedLevel = (snapshot: LiveOptionsData | null, level: number | null) => {
    if (!snapshot || level === null) return null;
    return priceScale === "native"
      ? level
      : futuresEquivalent(level, snapshot.spot, futuresAnchor);
  };
  const bridgeConvert = (value: number | null) => {
    if (!marketData || value === null) return null;
    return priceScale === "native"
      ? value
      : futuresEquivalent(value, marketData.spot, futuresAnchor);
  };
  const concentrationLevels = (metricName: "gamma" | "delta", positive: boolean, count: number) => {
    const values = [...(marketData?.strikes ?? [])]
      .filter((row) => positive ? row[metricName] > 0 : row[metricName] < 0)
      .sort((left, right) => Math.abs(right[metricName]) - Math.abs(left[metricName]))
      .slice(0, count)
      .map((row) => bridgeConvert(row.strike));
    return [...values, ...Array(Math.max(0, count - values.length)).fill(null)];
  };
  const bridgeFixedValues = marketData
    ? [
        bridgeParts.aggregateWalls ? bridgeConvert(marketData.levels.callWall) : null,
        bridgeParts.aggregateWalls ? bridgeConvert(marketData.levels.putWall) : null,
        bridgeParts.flips ? bridgeConvert(marketData.levels.gammaFlip) : null,
        bridgeParts.maxPain ? bridgeConvert(marketData.levels.maxPain) : null,
        bridgeParts.vanna ? bridgeConvert(marketData.levels.vannaMagnet) : null,
        ...(bridgeParts.gamma ? concentrationLevels("gamma", true, 5) : Array(5).fill(null)),
        ...(bridgeParts.gamma ? concentrationLevels("gamma", false, 5) : Array(5).fill(null)),
        ...(bridgeParts.delta ? concentrationLevels("delta", true, 3) : Array(3).fill(null)),
        ...(bridgeParts.delta ? concentrationLevels("delta", false, 3) : Array(3).fill(null)),
      ]
    : Array(21).fill(null);
  const bridgeExpiryValues = (marketData?.expiryLevels ?? [])
    .map((slice) => {
      const label = `${calendarDte(slice.expiry, dteBase)}DTE`;
      const call = bridgeParts.expiryWalls ? bridgeConvert(slice.levels.callWall) : null;
      const put = bridgeParts.expiryWalls ? bridgeConvert(slice.levels.putWall) : null;
      const flip = bridgeParts.flips ? bridgeConvert(slice.levels.gammaFlip) : null;
      return [label, bridgeNumber(call), bridgeNumber(put), bridgeNumber(flip)].join(":");
    })
    .join(";");
  const bridgeSection = `${bridgeFixedValues.map(bridgeNumber).join(",")}~${bridgeExpiryValues}`;
  const emptyBridgeSection = "~";
  // The MotiveWave study still reads the original fixed-width payload.
  const legacyBridgePayload =
    instrument === "NQ"
      ? `${priceScale === "futures" ? "F" : "N"}#${emptyBridgeSection}|${bridgeSection}`
      : `${priceScale === "futures" ? "F" : "N"}#${bridgeSection}|${emptyBridgeSection}`;

  // Every book is published at its own spot and strike increment, and the
  // payload builder rescales both onto one reference price. Carrying the
  // increment is what lets the chart draw a QQQ level as the ~41-index-point
  // band a $1 strike grid actually covers instead of borrowing NDX's 25.
  const bridgeSourceFor = (snapshot: LiveOptionsData | null, role: "P" | "C"): BridgeSource[] => {
    if (!snapshot) return [];
    // The front slice of the current selection carries the expected move. Its
    // year fraction comes from the surface, which already accounts for the
    // AM/PM settlement of the root rather than assuming a whole session.
    const front = snapshot.selection.expiries[0] ?? snapshot.expiry;
    const frontSurface = snapshot.surface.find((slice) => slice.expiry === front) ?? null;
    return [
      {
        name: snapshot.symbol,
        role,
        spot: snapshot.spot,
        strikes: snapshot.strikes.map((row) => ({
          strike: row.strike,
          gamma: row.gamma,
          delta: row.delta,
          callVolume: row.callVolume,
          putVolume: row.putVolume,
        })),
        levels: snapshot.levels,
        expiries: snapshot.expiryLevels.map((slice) => ({
          label: `${calendarDte(slice.expiry, dteBase)}DTE`,
          dte: calendarDte(slice.expiry, dteBase),
          levels: slice.levels,
          settlesAt: slice.settlesAt ?? null,
        })),
        frontAtmIv: frontSurface?.atmIv ?? null,
        frontYears: frontSurface?.years ?? null,
        frontSettlesAt:
          snapshot.expiryLevels.find((slice) => slice.expiry === front)?.settlesAt ?? null,
      },
    ];
  };
  const bridgeReferenceSpot =
    priceScale === "futures" ? futuresAnchor ?? 0 : marketData?.spot ?? 0;
  const strikes = useMemo(() => {
    if (marketData?.strikes.length) {
      const span = instrument === "NQ" ? 520 : 170;
      const levelValues = [callWall, putWall, gammaFlip, maxPain, vannaMagnet]
        .filter((value): value is number => value !== null);
      const lowerBound = Math.min(marketData.spot - span, ...levelValues) - span * 0.08;
      const upperBound = Math.max(marketData.spot + span, ...levelValues) + span * 0.08;
      const visible = marketData.strikes
        .filter((row) => row.strike >= lowerBound && row.strike <= upperBound)
        .map((row) => row.strike)
        .sort((left, right) => right - left);
      if (visible.length > 4) {
        const stride = Math.max(1, Math.ceil(visible.length / 56));
        const important = new Set(
          levelValues.map((value) =>
              visible.reduce((best, strike) =>
                Math.abs(strike - value) < Math.abs(best - value) ? strike : best,
              ),
            ),
        );
        return visible.filter((strike, index) => index % stride === 0 || important.has(strike));
      }
    }
    return [];
  }, [callWall, gammaFlip, instrument, marketData, maxPain, putWall, vannaMagnet]);

  const nearest = (value: number) =>
    strikes.reduce((best, strike) => (Math.abs(strike - value) < Math.abs(best - value) ? strike : best));

  const pin = pinnedStrike !== null && strikes.length ? nearest(pinnedStrike) : null;
  const distance = pin !== null && marketData ? pin - spot : null;
  const pinnedData = marketData?.strikes.find((row) => row.strike === pin);
  const chainRows = useMemo(
    () =>
      [...(marketData?.strikes ?? [])]
        .sort((left, right) => Math.abs(left.strike - (pin ?? spot)) - Math.abs(right.strike - (pin ?? spot)))
        .slice(0, 9)
        .sort((left, right) => right.strike - left.strike),
    [marketData, pin, spot],
  );
  // The smile is read from one expiry's own quotes. Averaging implied
  // volatility across the expiries in a combined selection produces a curve
  // that belongs to no tradeable expiry, so the pooled strike rows are not
  // used here even though they carry IV.
  const smileSlice = useMemo(() => {
    const slices = marketData?.surface ?? [];
    if (!slices.length) return null;
    const selected = new Set(marketData?.selection.expiries ?? []);
    return slices.find((slice) => selected.has(slice.expiry)) ?? slices[0];
  }, [marketData]);
  const smilePoints = useMemo(
    () =>
      (smileSlice?.points ?? [])
        .filter((point) => Math.abs(point.standardized) <= 3)
        .sort((left, right) => left.moneyness - right.moneyness),
    [smileSlice],
  );
  const skewMin = Math.min(...smilePoints.map((point) => point.iv), Infinity);
  const skewMax = Math.max(...smilePoints.map((point) => point.iv), -Infinity);
  const skewPath = smilePoints.length
    ? smilePoints
        .map((point, index) => {
          const span = Math.max(
            Math.abs(smilePoints[0].moneyness),
            Math.abs(smilePoints[smilePoints.length - 1].moneyness),
            0.001,
          );
          const x = 262 + (point.moneyness / span) * 240;
          const y = 104 - ((point.iv - skewMin) / Math.max(skewMax - skewMin, 0.001)) * 82;
          return `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" ")
    : "";

  // Surface grid: expiries down the term axis, standardized moneyness across.
  // Standardizing by atm IV and sqrt(T) is what makes a 3DTE column comparable
  // to a 90DTE one; raw strike distance is not.
  const surfaceGrid = useMemo<SurfaceGrid | null>(() => {
    const slices = (marketData?.surface ?? []).filter((slice) => slice.points.length >= 3);
    if (!slices.length) return null;
    const buckets = [-2.5, -1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25, 1.75, 2.5];
    const rows = slices.slice(0, 14).map((slice) => ({
      expiry: slice.expiry,
      dte: slice.dte,
      atmIv: slice.atmIv,
      riskReversal25: slice.riskReversal25,
      // Sampled by interpolation rather than by averaging whatever falls in a
      // tolerance window: strike grids are not evenly spaced in standardized
      // moneyness, so a fixed window leaves holes wherever quotes are sparse.
      cells: (() => {
        const sorted = [...slice.points].sort(
          (left, right) => left.standardized - right.standardized,
        );
        const xs = sorted.map((point) => point.standardized);
        const ys = sorted.map((point) => point.iv);
        return buckets.map((bucket) => interpolateAt(xs, ys, bucket));
      })(),
    }));
    const values = rows.flatMap((row) => row.cells.filter((cell): cell is number => cell !== null));
    if (!values.length) return null;
    return { buckets, rows, min: Math.min(...values), max: Math.max(...values) };
  }, [marketData]);
  const maxTermIv = Math.max(
    ...(marketData?.expiryStats.map((row) => row.atmIv ?? 0) ?? []),
    0.01,
  );

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  // The chain table and the level ledger live in the shelf below the inspector
  // they drive, so a click there changed a panel that was off-screen. Selections
  // made beside the inspector do not scroll: moving the page under a reader who
  // can already see the result is worse than not moving it.
  function pinStrike(strike: number, reveal = false) {
    setPinnedStrike(strike);
    if (reveal) inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Copying is the one action here with no visible result — the payload goes to
  // the clipboard and the page looks unchanged. The button that fired confirms
  // in place so the feedback is where the click was, and the footer carries the
  // wording. One shared timer, because a second copy before the first expired
  // used to have the older timeout clear the newer notice.
  function announce(message: string, id: string | null) {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice(message);
    setConfirmed(id);
    noticeTimer.current = window.setTimeout(() => {
      setNotice("");
      setConfirmed(null);
      noticeTimer.current = null;
    }, 2200);
  }

  async function copy(value: string, message: string, id: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Denied permission, or a context the API refuses to run in. Saying so
      // beats a silent no-op that looks like the copy worked.
      announce("Clipboard blocked by the browser", null);
      return;
    }
    announce(message, id);
  }

  async function copyBridge() {
    if (!marketData) return;
    // The builder and indicator sources are useful only after an intentional
    // copy action. Keeping them out of the initial workspace chunk avoids
    // parsing tens of thousands of script characters just to view a profile.
    const { buildBridgePayload } = await import("@/lib/bridge-payload");
    const generatedAt = marketData.timestamp ? sourceDate(marketData.timestamp) : new Date();
    const payload = buildBridgePayload(
      [
        ...bridgeSourceFor(marketData, "P"),
        ...(bridgeParts.confirmation ? bridgeSourceFor(comparisonData, "C") : []),
      ],
      {
        space: priceScale === "futures" ? "F" : "N",
        instrument,
        referenceSpot: bridgeReferenceSpot,
        generatedAt,
        warnAfter: bridgeWarningAfter(generatedAt),
        parts: bridgeParts,
      },
    );
    await copy(payload, `${instrument} bridge copied`, "bridge");
  }

  async function copyPineScript() {
    const { PINE_SCRIPT } = await import("@/lib/indicator");
    await copy(PINE_SCRIPT, "Pine script copied", "pine");
  }

  async function copyMotiveWaveStudy() {
    const { MOTIVEWAVE_STUDY } = await import("@/lib/motivewave-indicator");
    await copy(MOTIVEWAVE_STUDY, "MotiveWave study copied", "study");
  }

  function exportCsv() {
    if (!marketData) return;
    const header = [
      "symbol", "expiry", "strike", "gamma", "delta", "vanna", "charm", "vega",
      "speed", "zomma", "vomma", "call_oi", "put_oi", "call_volume", "put_volume",
      "call_iv", "put_iv",
    ];
    const rows = marketData.strikes.map((row) => [
      marketData.symbol, marketData.expiry, row.strike, row.gamma, row.delta, row.vanna,
      row.charm, row.vega, row.speed, row.zomma, row.vomma, row.callOi, row.putOi,
      row.callVolume, row.putVolume, row.callIv ?? "", row.putIv ?? "",
    ]);
    const csv = [header, ...rows].map((row) => row.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gexlab-${marketData.symbol}-${marketData.expiry}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    announce("Snapshot exported", "csv");
  }

  return (
    <section className="atlas" id="exposure">
      <header className="atlas-masthead">
        <div>
          <p className="section-kicker">
            Options workspace ·{" "}
            {dataState === "ready" ? (refreshing ? "recalculating scope" : "market snapshot") : dataState}
          </p>
          <h1>See the pressure around price.</h1>
          <p>
            {dataState === "ready"
              ? `${marketData?.roots.join(" / ")} positioning is calculated from ${marketData?.contractCount.toLocaleString()} contracts for ${marketData?.expiry}. Native index strikes map to the ${instrument} chart through the indicator.`
              : dataState === "error"
                ? `The ${cfg.source} request failed: ${dataError}`
                : `Loading the ${cfg.source} option chain.`}
          </p>
          {/* Without this the only way out of a failed request was switching
              instrument, which resets the whole selection, or reloading the
              page. Bumping the refresh tick reuses the fetch path and clears
              the response cache, so a retry cannot be served the failure again
              from memory. */}
          {dataState === "error" && (
            <button
              className="quiet-action"
              onClick={() => {
                setDataError("");
                setDataState("loading");
                setRefreshTick((value) => value + 1);
              }}
            >
              Retry the request
            </button>
          )}
        </div>
        <div className="atlas-context" aria-label="Structure controls">
          <div className="atlas-switch" aria-label="Futures chart target">
            {(["NQ", "ES"] as Instrument[]).map((value) => (
              <button
                key={value}
                data-active={instrument === value || undefined}
                onClick={() => {
                  setInstrument(value);
                  setExpiryMode("single");
                  setScope("");
                  setSelectedExpiries([]);
                  setMarketData(null);
                  setComparisonData(null);
                  setDataState("loading");
                  setDataError("");
                  setComparisonError("");
                  // Null, not zero: zero snapped to the lowest listed strike and
                  // showed it as the selection for the new instrument.
                  setPinnedStrike(null);
                }}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="atlas-freshness">
            <span>Contracts</span>
            <strong>{marketData?.roots.join(" / ") || cfg.source}</strong>
          </div>
          <div className="atlas-freshness">
            <span>Conversion</span>
            <strong>Index → {instrument}</strong>
          </div>
          <div className="atlas-freshness">
            <span>Updated</span>
            <strong>
              {marketData?.timestamp ? formatSourceTime(marketData.timestamp) : "Loading"}
              {marketData?.stale ? " · saved" : ""}
            </strong>
          </div>
          <div
            className={`atlas-freshness atlas-quality atlas-quality--${snapshotQuality.tone}`}
            title={snapshotQuality.detail}
          >
            <span>Data quality</span>
            <strong><i aria-hidden="true" />{snapshotQuality.label}</strong>
          </div>
          <div className="update-mode" aria-label="Options update mode">
            <button
              data-active={updateMode === "eod" || undefined}
              onClick={() => setUpdateMode("eod")}
              title="Use the latest completed snapshot without recurring requests"
            >
              EOD
            </button>
            <button
              data-active={updateMode === "live" || undefined}
              onClick={() => setUpdateMode("live")}
              title="Check for a newer snapshot once per 15-minute window"
            >
              Live
            </button>
          </div>
        </div>
      </header>

      <section className="expiry-deck" aria-label="Contract expiry scope">
        <header>
          <div>
            <p className="section-kicker">Contract expiry</p>
            <h2>
              {expiryMode === "custom" || expiryMode === "composite"
                ? `${selectedExpiries.length || marketData?.selection.expiries.length || 0} expiries selected`
                : selectedExpiry
                ? `${shortExpiry(selectedExpiry).weekday}, ${shortExpiry(selectedExpiry).monthDay}`
                : "Loading dates"}
              {expiryMode !== "custom" && expiryMode !== "composite" && selectedDte !== null && <span>{selectedDte}DTE</span>}
            </h2>
          </div>
          <div className="expiry-mode" aria-label="Expiry calculation mode">
            <button
              data-active={expiryMode === "single" || undefined}
              onClick={() => {
                setScope((current) => current || marketData?.expiry || "");
                setExpiryMode("single");
              }}
            >
              One expiry
            </button>
            <button
              data-active={expiryMode === "through" || undefined}
              onClick={() => {
                setScope((current) => current || marketData?.expiry || "");
                setExpiryMode("through");
              }}
            >
              Through date
            </button>
            <button
              disabled={!marketData}
              data-active={expiryMode === "custom" || undefined}
              onClick={() => {
                const initial = marketData?.selection.expiries.length
                  ? marketData.selection.expiries
                  : selectedExpiry ? [selectedExpiry] : [];
                setSelectedExpiries((current) => current.length ? current : initial);
                setExpiryMode("custom");
              }}
            >
              Pick dates
            </button>
            <button
              disabled={!marketData?.expiries.length}
              data-active={expiryMode === "composite" || undefined}
              title="Combine every currently listed expiry"
              onClick={() => {
                const allExpiries = marketData?.expiries ?? [];
                setSelectedExpiries(allExpiries);
                setScope(allExpiries.at(-1) ?? "");
                setExpiryMode("composite");
              }}
            >
              Composite
            </button>
          </div>
        </header>
        <div className="expiry-rail-shell">
          <button
            className="expiry-rail-step"
            aria-label="Show earlier expiries"
            onClick={() => expiryRailRef.current?.scrollBy({ left: -320, behavior: "smooth" })}
          >
            ←
          </button>
          <div className="expiry-rail" ref={expiryRailRef} aria-label="Available expiries">
            {!marketData?.expiries.length && <span className="expiry-loading">Loading available contracts…</span>}
            {marketData?.expiries.map((expiry, index) => {
              const date = shortExpiry(expiry);
              const dte = calendarDte(expiry, dteBase);
              const active =
                expiryMode === "custom" || expiryMode === "composite"
                  ? selectedExpiries.includes(expiry)
                  : selectedExpiry === expiry;
              return (
                <button
                  key={expiry}
                  aria-pressed={active}
                  data-active={active || undefined}
                  style={{ animationDelay: `${Math.min(index * 22, 260)}ms` }}
                  onClick={() => {
                    if (expiryMode === "custom" || expiryMode === "composite") {
                      if (expiryMode === "composite") setExpiryMode("custom");
                      setSelectedExpiries((current) => {
                        if (current.includes(expiry)) {
                          return current.length === 1 ? current : current.filter((date) => date !== expiry);
                        }
                        return [...current, expiry].sort();
                      });
                    } else {
                      setScope(expiry);
                    }
                  }}
                >
                  <span>{date.weekday}</span>
                  <strong>{date.monthDay}</strong>
                  <small>{dte === 0 ? "0DTE" : `${dte}DTE`}</small>
                  {index === 0 && <i>Front</i>}
                </button>
              );
            })}
          </div>
          <button
            className="expiry-rail-step"
            aria-label="Show later expiries"
            onClick={() => expiryRailRef.current?.scrollBy({ left: 320, behavior: "smooth" })}
          >
            →
          </button>
        </div>
        <p className="expiry-reading">
          {expiryMode === "single"
            ? "Showing only the selected contract expiry."
            : expiryMode === "through"
              ? `Combining ${selectionCount} listed ${selectionCount === 1 ? "expiry" : "expiries"} from the front contract through the selected date.`
              : expiryMode === "composite"
                ? `Composite combines all ${selectionCount} currently listed expiries into one exposure profile. Click any date to remove it and make a custom composite.`
                : `Combining only the ${selectionCount} highlighted ${selectionCount === 1 ? "expiry" : "expiries"}. Click any date to add or remove it.`}
        </p>
      </section>

      <section className="confirmation-board" aria-label="Index and ETF options confirmation">
        <div className="confirmation-heading">
          <div>
            <p className="section-kicker">Cross-market confirmation</p>
            <h2>{marketData?.symbol ?? (instrument === "NQ" ? "NDX" : "SPX")} with {comparisonData?.symbol ?? (instrument === "NQ" ? "QQQ" : "SPY")}</h2>
          </div>
          <div className="comparison-heading-tools">
            <span className={`confirmation-state confirmation-state--${confirmationState.toLowerCase()}`}>
              {confirmationState}
            </span>
            <div className="price-scale-toggle" aria-label="Displayed price scale">
              <button
                data-active={priceScale === "native" || undefined}
                onClick={() => setPriceScale("native")}
              >
                Native strikes
              </button>
              <button
                data-active={priceScale === "futures" || undefined}
                onClick={() => setPriceScale("futures")}
              >
                {instrument} converted
              </button>
            </div>
          </div>
        </div>
        {priceScale === "futures" && (
          <div className="comparison-anchor">
            <span>
              <strong>
                {instrument} anchor
                {manualAnchor
                  ? " · manual override"
                  : automaticAnchor
                    ? ` · ${automaticAnchor.contract}`
                    : ""}
              </strong>
              <small>
                {manualAnchor
                  ? `${manualAnchor.toLocaleString()} entered manually. Clear it to restore the automatic settlement.`
                  : automaticAnchor
                    ? `${automaticAnchor.price.toLocaleString()} official settlement · ${new Date(`${automaticAnchor.tradeDate}T12:00:00`).toLocaleDateString()}`
                    : anchorErrors[instrument] || "Loading the official settlement…"}
              </small>
            </span>
            <input
              aria-label={`Manual ${instrument} futures price override`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.25"
              placeholder="Manual override"
              value={futuresAnchors[instrument]}
              onChange={(event) => {
                const value = event.target.value;
                setFuturesAnchors((current) => ({ ...current, [instrument]: value }));
                setAnchorTimes((current) => ({
                  ...current,
                  [instrument]: value ? new Date().toISOString() : "",
                }));
              }}
            />
          </div>
        )}
        <div className="confirmation-lanes">
          {[marketData, comparisonData].map((snapshot, index) => {
            const fallback = index === 0 ? (instrument === "NQ" ? "NDX" : "SPX") : (instrument === "NQ" ? "QQQ" : "SPY");
            const displayedSpot = displayedLevel(snapshot, snapshot?.spot ?? null);
            const displayRows = [
              { label: "Call wall", value: displayedLevel(snapshot, snapshot?.levels.callWall ?? null), tone: "call" },
              { label: "Gamma flip", value: displayedLevel(snapshot, snapshot?.levels.gammaFlip ?? null), tone: "flip" },
              { label: "Put wall", value: displayedLevel(snapshot, snapshot?.levels.putWall ?? null), tone: "put" },
            ];
            return (
              <article key={fallback}>
                <header>
                  <div>
                    <strong>{snapshot?.symbol ?? fallback}</strong>
                    <span>
                      {index === 0 ? "Primary index" : "ETF confirmation"}
                      {snapshot?.timestamp ? ` · ${formatSourceTime(snapshot.timestamp, false)}` : ""}
                    </span>
                  </div>
                  <div>
                    <strong>{displayedSpot?.toLocaleString() ?? (snapshot ? "—" : "Loading")}</strong>
                    <span>{priceScale === "native" ? "Spot" : `${instrument} equivalent`}</span>
                  </div>
                </header>
                <dl className="comparison-levels" key={`${fallback}-${priceScale}`}>
                  {displayRows.map((row) => (
                    <div key={row.label} data-tone={row.tone}>
                      <dt>{row.label}</dt>
                      <dd>{formatStrike(row.value)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="confirmation-track">
                  <i className="confirmation-mid" />
                  {snapshot && snapshot.levels.putWall !== null && (
                    <i
                      className="confirmation-marker confirmation-marker--put"
                      style={{ left: `${confirmationPosition(snapshot.levels.putWall, snapshot.spot)}%` }}
                      title={`Put wall ${snapshot.levels.putWall.toLocaleString()} · ${levelDistance(snapshot.levels.putWall, snapshot.spot)?.toFixed(2)}% from spot`}
                    >
                      <span>PUT</span>
                    </i>
                  )}
                  {snapshot && snapshot.levels.gammaFlip !== null && (
                    <i
                      className="confirmation-marker confirmation-marker--flip"
                      style={{ left: `${confirmationPosition(snapshot.levels.gammaFlip, snapshot.spot)}%` }}
                      title={`Profile crossing ${snapshot.levels.gammaFlip.toLocaleString()}`}
                    />
                  )}
                  {snapshot && snapshot.levels.callWall !== null && (
                    <i
                      className="confirmation-marker confirmation-marker--call"
                      style={{ left: `${confirmationPosition(snapshot.levels.callWall, snapshot.spot)}%` }}
                      title={`Call wall ${snapshot.levels.callWall.toLocaleString()} · ${levelDistance(snapshot.levels.callWall, snapshot.spot)?.toFixed(2)}% from spot`}
                    >
                      <span>CALL</span>
                    </i>
                  )}
                </div>
                <footer>
                  <span>−2% from spot</span>
                  <span>{snapshot?.expiry ?? (scope || "Front expiry")}</span>
                  <span>+2% from spot</span>
                </footer>
              </article>
            );
          })}
        </div>
        <p className="confirmation-reading">
          {priceScale === "futures" && !futuresAnchor
            ? `The automatic settlement is unavailable. Enter a manual ${instrument} quote above to convert both columns.`
            : comparisonError
            ? `${comparisonData ? "Comparison note" : `${instrument === "NQ" ? "QQQ" : "SPY"} confirmation failed`}: ${comparisonError}`
            : confirmationState === "Aligned"
              ? `The index and ETF walls sit at similar percentage distances from spot. This strengthens confluence, but does not guarantee a reaction.`
              : confirmationState === "Divergent"
                ? `The index and ETF structures disagree after normalizing for price scale. Treat the index wall with less cross-market confirmation.`
                : priceScale === "futures"
                  ? `Both columns use the same ${instrument} anchor, so their relative structures can be compared directly.`
                  : `Native strikes are shown exactly as supplied. Percentage distance—not raw price—is used to judge alignment.`}
        </p>

        <details className="futures-converter">
          <summary>
            <span>
              <small>Futures mapping</small>
              <strong>Compare levels in {instrument} terms</strong>
            </span>
            <em>
              {futuresAnchor
                ? `${instrument} ${futuresAnchor.toLocaleString()} · ${manualAnchor ? "manual" : "official settle"}`
                : "Unavailable"}
            </em>
          </summary>
          <div className="futures-converter-body">
            <div className="converter-intro">
            <p className="section-kicker">Futures anchor</p>
            <h3>Compare every source in {instrument} terms.</h3>
            <p>
              The app automatically uses the official front-contract settlement. You can override
              it with a current broker quote. Each source strike is mapped by percentage distance
              from its own spot, then rounded to the 0.25 futures tick.
            </p>
            <label>
              Manual {instrument} override
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.25"
                placeholder={automaticAnchor ? `Auto ${automaticAnchor.price.toLocaleString()}` : `Enter ${instrument} quote`}
                value={futuresAnchors[instrument]}
                onChange={(event) => {
                  const value = event.target.value;
                  setFuturesAnchors((current) => ({ ...current, [instrument]: value }));
                  if (!value) {
                    setAnchorTimes((current) => ({ ...current, [instrument]: "" }));
                  }
                }}
                onBlur={() => {
                  if (futuresAnchors[instrument]) {
                    setAnchorTimes((current) => ({
                      ...current,
                      [instrument]: new Date().toISOString(),
                    }));
                  }
                }}
              />
            </label>
            <small>
              {anchorTimes[instrument]
                ? `Anchor recorded ${new Date(anchorTimes[instrument]).toLocaleString()}`
                : automaticAnchor
                  ? `Automatic ${automaticAnchor.contract} settlement for ${automaticAnchor.tradeDate}.`
                  : anchorErrors[instrument] || "Loading the official settlement."}
            </small>
            </div>
            <div className="conversion-ledger">
            <header>
              <span>Level</span>
              <strong>{marketData?.symbol ?? "Index"} → {instrument}</strong>
              <strong>{comparisonData?.symbol ?? "ETF"} → {instrument}</strong>
              <span>Gap</span>
            </header>
            {conversionRows.map((row) => (
              <div key={row.key}>
                <span>{row.label}</span>
                <strong>{formatStrike(row.primary)}</strong>
                <strong>{formatStrike(row.companion)}</strong>
                <span>{row.difference === null ? "—" : `${row.difference.toFixed(2)} pt`}</span>
              </div>
            ))}
            <p>
              Formula: futures anchor × source strike ÷ source spot. Exact at the anchor for equal
              percentage moves; tracking error and timestamp mismatch remain possible.
            </p>
            </div>
          </div>
        </details>
      </section>

      <div className="atlas-workspace">
        <nav className="analysis-index" aria-label="Exposure measure">
          <p className="section-kicker">Analysis index</p>
          {metrics.map((item, index) => (
            <button
              key={item.id}
              data-active={metric === item.id || undefined}
              onClick={() => setMetric(item.id)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
              {metric === item.id ? <motion.b className="analysis-active-mark" layoutId="analysis-active" /> : null}
            </button>
          ))}
        </nav>

        <figure className="exposure-atlas">
          <header className="atlas-plot-head">
            <div>
              <p className="section-kicker">{metric} exposure</p>
              <h2>
                {marketData?.symbol ?? (instrument === "NQ" ? "NDX" : "SPX")} +{" "}
                {comparisonData?.symbol ?? (instrument === "NQ" ? "QQQ" : "SPY")}
              </h2>
            </div>
            <div className="plot-controls">
              <div aria-label="Chart view" className="plot-view-control">
                {(["spine", "bars"] as View[]).map((value) => (
                  <button
                    key={value}
                    data-active={view === value || undefined}
                    onClick={() => setView(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div aria-label="Chart price scale" className="plot-scale-control">
                <button
                  data-active={priceScale === "native" || undefined}
                  onClick={() => setPriceScale("native")}
                >
                  Native
                </button>
                <button
                  data-active={priceScale === "futures" || undefined}
                  onClick={() => setPriceScale("futures")}
                >
                  {instrument} terms
                </button>
              </div>
            </div>
          </header>

          {/* No --preview modifier: it printed "PREVIEW GEOMETRY · WAITING FOR
              MARKET DATA" over a panel that draws no geometry at all while
              loading, and implied fabricated numbers were on screen. Each
              profile already says it is waiting in its own header. */}
          <div className="atlas-canvas">
            <div className="profile-comparison">
              <MarketProfileChart
                snapshot={marketData}
                fallbackSymbol={instrument === "NQ" ? "NDX" : "SPX"}
                metric={metric}
                view={view}
                priceScale={priceScale}
                futuresAnchor={futuresAnchor}
                selectedExpiry={selectedExpiry}
                onPin={pinStrike}
                pinned={pin}
              />
              <MarketProfileChart
                snapshot={comparisonData}
                fallbackSymbol={instrument === "NQ" ? "QQQ" : "SPY"}
                metric={metric}
                view={view}
                priceScale={priceScale}
                futuresAnchor={futuresAnchor}
                selectedExpiry={selectedExpiry}
              />
            </div>
          </div>
          <figcaption>
            <span>How to read it</span>
            <p>
              {metricCopy[metric]} Both profiles are normalized within their own market so the shape stays readable. The magnitude strip uses the unnormalized near-spot window, so compare size there rather than by bar length. Select an index strike to inspect it.{" "}
              {["gamma", "delta", "vega"].includes(metric)
                ? "The base Greek comes from the market snapshot."
                : "This higher-order Greek is modeled from snapshot IV."}
            </p>
            <div className="atlas-legend">
              <i className="legend-positive" /> Positive
              <i className="legend-negative" /> Negative
              <span>{expiryMode === "single" ? `${selectedDte ?? "—"}DTE only` : `${selectionCount} expiries combined`}</span>
            </div>
          </figcaption>
        </figure>

        <aside className="strike-inspector" ref={inspectorRef} data-pinned={pin !== null || undefined}>
          <p className="section-kicker">Pinned strike</p>
          {/* Keyed so a new selection remounts the number and the settle replays. */}
          <strong className="pinned-value" key={pin ?? "none"}>{pin?.toLocaleString() ?? "—"}</strong>
          {/* No tone while nothing is pinned: the falsy branch used to paint
              "Waiting for a strike" in the below-spot colour. */}
          <p
            className={`distance${
              distance === null ? "" : distance >= 0 ? " distance--above" : " distance--below"
            }`}
          >
            {distance === null ? "Waiting for a strike" : `${distance >= 0 ? "+" : ""}${distance.toLocaleString()} from spot`}
          </p>

          <dl className="inspector-primary">
            <div>
              <dt>{metric} exposure</dt>
              <dd>{pinnedData ? formatCompact(pinnedData[metric]) : "—"}</dd>
            </div>
            <div>
              <dt>Call open interest</dt>
              <dd>{pinnedData?.callOi.toLocaleString() ?? "—"}</dd>
            </div>
            <div>
              <dt>Put open interest</dt>
              <dd>{pinnedData?.putOi.toLocaleString() ?? "—"}</dd>
            </div>
            <div>
              <dt>Call / put volume</dt>
              <dd>{pinnedData ? `${pinnedData.callVolume.toLocaleString()} / ${pinnedData.putVolume.toLocaleString()}` : "— / —"}</dd>
            </div>
            <div>
              <dt>Implied volatility</dt>
              <dd>
                {pinnedData
                  ? `${pinnedData.callIv === null ? "—" : `${(pinnedData.callIv * 100).toFixed(1)}%`} / ${pinnedData.putIv === null ? "—" : `${(pinnedData.putIv * 100).toFixed(1)}%`}`
                  : "—"}
              </dd>
            </div>
          </dl>

          <div className="inspector-reading">
            <p className="section-kicker">What it may mean</p>
            <p>
              {pinnedData
                ? `${pinnedData[metric] >= 0 ? "Positive" : "Negative"} ${metric} exposure is concentrated here. This is an estimate from open interest, not observed dealer inventory or live options flow.`
                : pin === null
                  ? "Select a strike on either profile, in the chain, or from the level ledger."
                  : "No market-data row is available for this strike."}
            </p>
          </div>
          <button className="quiet-action" disabled={!marketData} onClick={() => setPinnedStrike(spot)}>
            {pin === null ? "Inspect spot" : "Return to spot"}
          </button>
        </aside>
      </div>

      <PositioningTape symbol={marketData?.symbol ?? (instrument === "NQ" ? "NDX" : "SPX")} />

      {instrument === "NQ" && <DxyStudy />}

      <section className="research-shelf" id="research">
        <nav aria-label="Related structure studies">
          {([
            ["levels", "Levels"],
            ["chain", "Chain"],
            ["flow", "Large trades"],
            ["volatility", "Volatility"],
            ["term", "Term structure"],
            ["indicator", "Indicator"],
          ] as [Shelf, string][]).map(([id, label]) => (
            <button
              key={id}
              data-active={shelf === id || undefined}
              onClick={() => {
                setShelf(id);
                window.history.replaceState(null, "", "#research");
              }}
            >
              {label}
              {shelf === id ? <motion.i className="shelf-active-mark" layoutId="shelf-active" /> : null}
            </button>
          ))}
        </nav>

        <div className="shelf-content">
          {shelf === "topology" && (
            <TopologyStudy
              snapshot={marketData}
              comparison={comparisonData}
              metric={metric}
              surfaceGrid={surfaceGrid}
              topology={marketData?.topology ?? []}
              expiryStats={marketData?.expiryStats ?? []}
              instrument={instrument}
              onMetric={setMetric}
            />
          )}

          {shelf === "levels" && (
            <div>
              <p className="data-disclaimer">
                {dataState === "ready"
                  ? `Market snapshot · ${marketData?.expiry} · calls-positive / puts-negative estimate`
                  : "Waiting for the option chain"}
              </p>
              <div className="level-ledger">
                {[
                  ["Call wall", callWall, "Largest nearby positive gamma strike above spot (±6% wall window)", "stress"],
                  ["Vanna magnet", vannaMagnet, "Largest absolute modeled vanna strike", "map"],
                  ["Gamma flip", gammaFlip, "Nearest modeled zero-gamma price after repricing the selected book", "caution"],
                  ["Max pain", maxPain, "Minimum intrinsic payout at expiry", "comparison"],
                  ["Put wall", putWall, "Largest nearby negative gamma strike below spot (±6% wall window)", "constructive"],
                ].filter(([, value]) => value !== null).map(([label, value, note, tone]) => (
                  <button
                    key={label}
                    aria-pressed={pin !== null && pin === nearest(Number(value))}
                    data-active={(pin !== null && pin === nearest(Number(value))) || undefined}
                    onClick={() => pinStrike(Number(value), true)}
                  >
                    <i className={`level-tone level-tone--${tone}`} />
                    <span>{label}</span>
                    <strong>{formatStrike(Number(value))}</strong>
                    <small>{note}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* A grid rather than a table: the rows are selectable, and only a
              grid's row supports aria-selected. Under role="table" the rows
              announced as rows and never said they could be activated. */}
          {shelf === "chain" && (
            <div className="chain-table" role="grid" aria-label={`${cfg.source} option chain`}>
              <div className="chain-row chain-row--head" role="row">
                <span role="columnheader">Call OI</span>
                <span role="columnheader">Call vol.</span>
                <strong role="columnheader">Strike</strong>
                <span role="columnheader">Put vol.</span>
                <span role="columnheader">Put OI</span>
              </div>
              {chainRows.map((row) => (
                <button
                  className="chain-row"
                  role="row"
                  key={row.strike}
                  aria-selected={pin === row.strike}
                  data-active={pin === row.strike || undefined}
                  onClick={() => pinStrike(row.strike, true)}
                >
                  <span role="gridcell">{row.callOi.toLocaleString()}</span>
                  <span role="gridcell">{row.callVolume.toLocaleString()}</span>
                  <strong role="gridcell">{row.strike.toLocaleString()}</strong>
                  <span role="gridcell">{row.putVolume.toLocaleString()}</span>
                  <span role="gridcell">{row.putOi.toLocaleString()}</span>
                </button>
              ))}
              {!chainRows.length && <div className="data-pending"><strong>Loading option chain</strong></div>}
            </div>
          )}

          {shelf === "flow" && (
            marketData?.flow ? (
              <LargeTrades flow={marketData.flow} />
            ) : (
              <div className="data-pending">
                <strong>Two sessions of chain history are needed</strong>
                <p>
                  A trade&apos;s intent comes from what it left behind in open interest, which
                  arrives the session after it traded. This fills in once a second end-of-day
                  chain has been captured.
                </p>
              </div>
            )
          )}

          {shelf === "volatility" && (
            <div className="study-layout">
              <div>
                <p className="section-kicker">
                  {surfaceView === "smile" ? "Implied volatility smile" : "Implied volatility surface"}
                </p>
                <h3>
                  {smileSlice
                    ? `${(smileSlice.atmIv * 100).toFixed(1)}% at the money, ${smileSlice.dte}DTE.`
                    : "No expiry has enough two-sided quotes for a smile."}
                </h3>
                <p>
                  {surfaceView === "smile"
                    ? "One expiry's out-of-the-money quotes against log-moneyness. In-the-money strikes are excluded because their spreads dominate the fit."
                    : "Every listed expiry, standardized by at-the-money IV and the square root of time so the near and far columns are comparable."}
                </p>
                <div className="expiry-mode" aria-label="Volatility view">
                  <button
                    data-active={surfaceView === "smile" || undefined}
                    onClick={() => setSurfaceView("smile")}
                  >
                    Smile
                  </button>
                  <button
                    data-active={surfaceView === "surface" || undefined}
                    onClick={() => setSurfaceView("surface")}
                  >
                    Surface
                  </button>
                </div>
                {smileSlice && (
                  <dl className="surface-shape">
                    <div>
                      <dt>25d risk reversal</dt>
                      <dd>
                        {smileSlice.riskReversal25 === null
                          ? "—"
                          : `${(smileSlice.riskReversal25 * 100).toFixed(2)} pts`}
                      </dd>
                    </div>
                    <div>
                      <dt>25d butterfly</dt>
                      <dd>
                        {smileSlice.butterfly25 === null
                          ? "—"
                          : `${(smileSlice.butterfly25 * 100).toFixed(2)} pts`}
                      </dd>
                    </div>
                    <div>
                      <dt>Versus prior session</dt>
                      <dd>
                        {marketData?.surfaceChange
                          ? `${marketData.surfaceChange.atmIv >= 0 ? "+" : ""}${(marketData.surfaceChange.atmIv * 100).toFixed(2)} pts ATM vs ${marketData.surfaceChange.comparedTo}`
                          : `No prior session recorded yet (${marketData?.surfaceHistoryDays ?? 0} stored)`}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
              {surfaceView === "smile" ? (
                <svg className="study-chart" viewBox="0 0 520 130" role="img" aria-label="Implied volatility smile">
                  <line x1="20" x2="500" y1="108" y2="108" />
                  <line x1="262" x2="262" y1="15" y2="108" className="study-dash" />
                  <text x="242" y="125">FORWARD</text>
                  {skewPath && <path d={skewPath} />}
                </svg>
              ) : (
                <div className="surface-grid" aria-label="Implied volatility surface">
                  {!surfaceGrid && <p>Not enough quoted strikes to build a surface.</p>}
                  {surfaceGrid && (
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">DTE</th>
                          {surfaceGrid.buckets.map((bucket) => (
                            <th key={bucket} scope="col">
                              {bucket > 0 ? `+${bucket}` : bucket}
                            </th>
                          ))}
                          <th scope="col">RR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {surfaceGrid.rows.map((row) => (
                          <tr key={row.expiry}>
                            <th scope="row">{row.dte}</th>
                            {row.cells.map((cell, index) => (
                              <td
                                key={surfaceGrid.buckets[index]}
                                title={
                                  cell === null
                                    ? "No quote"
                                    : `${row.expiry} at ${surfaceGrid.buckets[index]} sigma: ${(cell * 100).toFixed(1)}%`
                                }
                                style={
                                  cell === null
                                    ? undefined
                                    : {
                                        background: `color-mix(in oklab, var(--surface-hot) ${(
                                          ((cell - surfaceGrid.min) /
                                            Math.max(surfaceGrid.max - surfaceGrid.min, 0.0001)) *
                                          100
                                        ).toFixed(0)}%, var(--surface-cold))`,
                                      }
                                }
                              >
                                {cell === null ? "" : (cell * 100).toFixed(0)}
                              </td>
                            ))}
                            <td className="surface-rr">
                              {row.riskReversal25 === null
                                ? "—"
                                : (row.riskReversal25 * 100).toFixed(1)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p>
                    Columns are standardized moneyness in units of one at-the-money standard
                    deviation. Cell values are IV in percent; RR is the 25 delta risk reversal.
                  </p>
                </div>
              )}

              {/*
                * Strikes priced away from the curve fitted through the strikes
                * beside them. It sits under the smile because it is the same
                * object read one strike at a time, and deliberately nowhere
                * near the wall levels: a rich strike is somebody's demand for
                * a contract, while a wall is dealer gamma that moves the
                * underlying. Conflating the two is the entire error in the
                * "IV wall" idea this answers.
                */}
              <div className="dislocation-study">
                <p className="section-kicker">Strike dislocation</p>
                {!marketData?.volDislocation ? (
                  <p>No expiry has enough tightly quoted strikes to fit a curve worth comparing against.</p>
                ) : (
                  <>
                    <h3>
                      {marketData.volDislocation.strikes.length
                        ? `${marketData.volDislocation.strikes.length} strike${marketData.volDislocation.strikes.length === 1 ? "" : "s"} priced off the ${marketData.volDislocation.expiry} curve.`
                        : `Every readable strike on ${marketData.volDislocation.expiry} sits on its own curve.`}
                    </h3>
                    {marketData.volDislocation.strikes.length ? (
                      <table className="dislocation-table">
                        <thead>
                          <tr>
                            <th scope="col">Strike</th>
                            <th scope="col">IV</th>
                            <th scope="col">Curve</th>
                            <th scope="col">Away by</th>
                            <th scope="col">OI</th>
                            <th scope="col">Volume</th>
                            <th scope="col">± quote</th>
                          </tr>
                        </thead>
                        <tbody>
                          {marketData.volDislocation.strikes.map((row) => (
                            <tr key={row.strike}>
                              <th scope="row">{row.strike.toLocaleString()}</th>
                              <td>{row.iv.toFixed(1)}%</td>
                              <td>{row.fitted.toFixed(1)}%</td>
                              <td data-rich={row.residual > 0 || undefined}>
                                {row.residual > 0 ? "+" : ""}{row.residual.toFixed(2)}
                              </td>
                              <td>{row.openInterest.toLocaleString()}</td>
                              <td>{row.volume.toLocaleString()}</td>
                              <td>±{row.ivUncertainty.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                    <p>
                      {marketData.volDislocation.readable} strikes quoted tightly enough to read, {marketData.volDislocation.rejected.total} discarded
                      ({marketData.volDislocation.rejected.illiquid} too thin, {marketData.volDislocation.rejected.unquoted} unquoted).
                      Typical distance from the curve is {(marketData.volDislocation.noise).toFixed(2)} volatility points, and a strike is only
                      reported when it clears both that scatter and the volatility its own bid-ask leaves undetermined.
                    </p>
                    <p>
                      Read as demand for a contract. It is not support or resistance, and it is not dealer hedging pressure — that is
                      gamma, and it is the wall levels on the exposure plot. Open interest alone cannot make a strike rich: the same
                      size built by sellers leaves dealers long and quoting it cheaper.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {shelf === "term" && (
            <div className="term-study">
              {marketData?.expiryStats.slice(0, 8).map((row) => (
                <div key={row.expiry}>
                  <span>{row.expiry}</span>
                  <i><b style={{ width: `${((row.atmIv ?? 0) / maxTermIv) * 100}%` }} /></i>
                  <strong>{row.atmIv === null ? "—" : `${(row.atmIv * 100).toFixed(1)}%`}</strong>
                </div>
              ))}
              <p>OI-weighted IV by expiry. Event interpretation and prior-close change require snapshot history.</p>
            </div>
          )}

          {shelf === "indicator" && (
            <div className="indicator-drawer">
              <div>
                <p className="section-kicker">Chart bridge</p>
                <h3>Carry the same levels onto your chart.</h3>
                <p>
                  Build a compact payload from the exact expiries selected above. It carries each
                  book’s spot and strike increment, so the indicator sizes every zone from the grid
                  the level was actually measured on, and it can carry the{" "}
                  {instrument === "NQ" ? "QQQ" : "SPY"} book alongside the index one for a second,
                  independently listed read on the same levels.
                </p>
                <div className="bridge-options" aria-label="Bridge contents">
                  {([
                    ["expiryWalls", "Expiry walls"],
                    ["flips", "Gamma flips"],
                    ["aggregateWalls", "Combined walls"],
                    ["maxPain", "Max pain"],
                    ["vanna", "Vanna magnet"],
                    ["gamma", "Gamma concentrations"],
                    ["delta", "Delta concentrations"],
                    ["confirmation", `${instrument === "NQ" ? "QQQ" : "SPY"} confirmation book`],
                    ["profile", "Exposure histogram"],
                    ["volumeWalls", "Volume walls"],
                    ["expectedMove", "Expected move"],
                  ] as [BridgePart, string][]).map(([part, label]) => (
                    <button
                      key={part}
                      role="switch"
                      aria-checked={bridgeParts[part]}
                      data-active={bridgeParts[part] || undefined}
                      onClick={() =>
                        setBridgeParts((current) => ({ ...current, [part]: !current[part] }))
                      }
                    >
                      <i />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <p className="bridge-scope">
                  {selectionCount} selected {selectionCount === 1 ? "expiry" : "expiries"} ·{" "}
                  {priceScale === "native" ? "native index strikes" : `${instrument} futures-ready prices`}
                </p>
                <div className="conversion-formula" aria-label="Default futures conversion formula">
                  <span>Index strike</span>
                  <i>×</i>
                  <span>held futures / index ratio</span>
                  <i>=</i>
                  <strong>futures target</strong>
                </div>
              </div>
              <div className="indicator-actions">
                <button
                  data-confirmed={confirmed === "bridge" || undefined}
                  disabled={dataState !== "ready" || !marketData || (priceScale === "futures" && !futuresAnchor)}
                  onClick={() => void copyBridge()}
                >
                  <span>Copy bridge</span>
                  <i aria-hidden="true" />
                </button>
                <button
                  data-confirmed={confirmed === "pine" || undefined}
                  onClick={() => void copyPineScript()}
                >
                  <span>Copy Pine</span>
                  <i aria-hidden="true" />
                </button>
                <button
                  data-confirmed={confirmed === "study" || undefined}
                  title="Java study source for MotiveWave. Save as GexLabLevels.java, compile against mwave_sdk.jar, and place the classes in your MotiveWave Extensions folder."
                  onClick={() => void copyMotiveWaveStudy()}
                >
                  <span>Copy MotiveWave</span>
                  <i aria-hidden="true" />
                </button>
                <button
                  data-confirmed={confirmed === "legacy" || undefined}
                  disabled={dataState !== "ready" || !marketData || (priceScale === "futures" && !futuresAnchor)}
                  title="The MotiveWave study reads the earlier fixed-width payload rather than the one the Pine indicator now uses."
                  onClick={() => copy(legacyBridgePayload, `${instrument} MotiveWave bridge copied`, "legacy")}
                >
                  <span>Copy MotiveWave bridge</span>
                  <i aria-hidden="true" />
                </button>
                <button
                  data-confirmed={confirmed === "csv" || undefined}
                  disabled={!marketData}
                  onClick={exportCsv}
                >
                  <span>Export CSV</span>
                  <i aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <footer className="atlas-status" data-refreshing={refreshing || undefined}>
        <span>
          <i />{" "}
          {dataState === "ready"
            ? refreshing
              ? "Recalculating the selected scope"
              : "Market snapshot ready"
            : dataState === "error"
              ? "Market-data connection failed"
              : "Connecting to market data"}
        </span>
        <span>NDX / NDXP → NQ · SPX / SPXW → ES · QQQ / SPY confirm and ship in the bridge</span>
        <span aria-live="polite" className="status-notice">
          {/* Keyed so React remounts the text and the settle animation replays,
              which is what makes a changed notice read as new rather than as
              text that was always there. */}
          <em key={notice || pin}>
            {notice || (pin === null ? "Select a strike to inspect" : `Inspecting ${pin.toLocaleString()}`)}
          </em>
        </span>
      </footer>
    </section>
  );
}
