"use client";

import { useEffect, useMemo, useState } from "react";
import { OrientationHero } from "@/components/orientation-hero";
import { RegimeMap } from "@/components/regime-map";
import { describeSessionLag } from "@/lib/market-time";

type Tone = "constructive" | "caution" | "stress" | "neutral";
type View = "overview" | "regime" | "history";

type MacroData = {
  source: string;
  fetchedAt: string;
  methodologyVersion: string;
  stale?: boolean;
  marketRegime: {
    name: string;
    direction: "Bullish" | "Bearish" | "Neutral";
    behavior: "Trending" | "Mean-reverting" | "Transitional";
    directionScore: number;
    behaviorScore: number;
    confidence: number;
    asOf: string | null;
    /** Sessions behind the last completed one. 0 means as current as the source gets. */
    asOfSessionsBehind?: number | null;
    provisionalSession?: { date: string; source: string } | null;
    outlook?: {
      date: string | null;
      name: string;
      direction: "Bullish" | "Bearish" | "Neutral";
      behavior: "Trending" | "Mean-reverting" | "Transitional";
      confidence: number;
      rawConfidence: number;
      calibrated: boolean;
      samples: number;
      calibrationSamples: number;
      pivotPercent: number | null;
      pivotTo: string | null;
      basis: string;
      caveat: string;
    } | null;
    summary: string;
    playbook: string;
    method: string;
    caveat: string;
    factors: {
      label: string;
      reading: string;
      tone: Tone;
      value: string;
      note: string;
    }[];
  };
  regime: {
    name: string;
    confidence: number;
    growth: number;
    inflation: number;
    posture: string;
    riskAppetite: number;
    summary: string;
    caveat: string;
    method: string;
    riskAppetiteMethod: string;
  };
  pillars: {
    id: string;
    label: string;
    score: number;
    reading: string;
    tone: Tone;
    note: string;
  }[];
  drivers: {
    label: string;
    state: string;
    tone: Tone;
    fact: string;
    implication: string;
  }[];
  recessionRisk: {
    curve: {
      probability: number | null;
      spread: number | null;
      asOf: string | null;
      change3m: number | null;
      change12m: number | null;
    };
    current: { probability: number | null; asOf: string | null; change3m: number | null };
    nowcast: {
      value: number | null;
      asOf: string | null;
      change: number | null;
      quarter: string | null;
      inProgress: boolean;
    };
    termStructure: {
      nominal: number | null;
      expectations: number | null;
      termPremium: number | null;
      termPremiumChange: number | null;
      expectationsChange: number | null;
      asOf: string | null;
    };
    history: { date: string; spread: number; curve: number; current: number | null }[];
    method: string;
    caveat: string;
  };
  metrics: {
    id: string;
    label: string;
    group: string;
    value: number | null;
    display: string;
    change: number | null;
    changeDisplay: string;
    date: string | null;
    frequency: string;
    source: string;
    series: string;
    meaning: string;
    context: {
      spark: number[];
      zScore: number | null;
      percentile: number | null;
      windowYears: number;
      observations: number;
    } | null;
  }[];
  history: {
    sampleSize: number;
    coverageStart: string | null;
    coverageEnd: string | null;
    quantiles: (number | null)[];
    panelStart: string | null;
    panelMonths: number;
    transitions: {
      current: string;
      currentRun: number;
      medianRunMonths: number | null;
      completedRuns: number;
      method: string;
      rows: {
        from: string;
        observations: number;
        to: { regime: string; count: number; probability: number | null }[];
      }[];
    };
    eventWindows: {
      index: string;
      method: string;
      caveat: string;
      rows: {
        label: string;
        note: string;
        events: number;
        firstEvent: string;
        lastEvent: string;
        medianDayMove: number | null;
        medianAbsoluteMove: number | null;
        baselineAbsoluteMove: number | null;
        positiveShare: number;
        worst: number;
        best: number;
        medianWeekMove: number | null;
        meanDayMove: number | null;
        recent: { date: string; day: number; next: number | null; week: number | null }[];
      }[];
    };
    rows: {
      date: string;
      returnStart: string | null;
      regime: string;
      growth: number;
      inflation: number;
      outcome: number | null;
      basis: string;
      vintage: string | null;
    }[];
    daily: {
      date: string;
      direction: "Bullish" | "Bearish" | "Neutral";
      behavior: "Trending" | "Mean-reverting" | "Transitional";
      name: string;
      directionScore: number;
      behaviorScore: number;
      ndxReturn20: number | null;
    }[];
    caveat: string;
  };
  availability: {
    dataQuality: {
      status: "validated" | "warning";
      issues: string[];
      methodologyVersion: string;
    };
    series: { status: string; unavailableSeries: string[] };
    vintages: {
      status: string;
      collected: number;
      target: number;
      earliestVintage: string | null;
      latestVintage: string | null;
      pointInTimeMonths: number;
      panelMonths: number;
      reason: string;
    };
    events: {
      status: string;
      reason: string;
      scheduled?: {
        start: string;
        end: string;
        year: number;
        label: string;
        projections: boolean;
        unscheduled: boolean;
      }[];
      releases?: {
        source: "BLS" | "BEA";
        title: string;
        startsAt: string;
        importance: "major" | "standard";
      }[];
      published?: { source: string; title: string; publishedAt: string; link: string }[];
    };
    positioningSkew: {
      status: string;
      reason: string;
      observedAt: string | null;
      riskReversal25: number | null;
      percentile: number | null;
      sessions: number;
    };
    fearGreed: { status: string; reason: string };
  };
};

const GROUP_ORDER = ["Market", "Growth", "Labor", "Cycle", "Inflation", "Rates", "Credit", "Liquidity", "Stress", "Positioning", "Transmission"];

const SOURCE_ABBREVIATIONS: Record<string, string> = {
  "Bureau of Economic Analysis": "BEA",
  "Census Bureau": "Census",
  "Federal Reserve": "Fed",
};

function formatMeetingDates(start: string, end: string) {
  const format = (value: string, withMonth: boolean) =>
    new Intl.DateTimeFormat("en-US", {
      month: withMonth ? "short" : undefined,
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  if (start === end) return format(start, true);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${format(start, true)}–${format(end, !sameMonth)}`;
}

function countdownLabel(start: string) {
  const days = Math.round(
    (Date.parse(`${start}T12:00:00Z`) - Date.parse(`${easternToday()}T12:00:00Z`)) / 86_400_000,
  );
  if (days < 0) return "in progress";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days} days`;
}

function easternToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function observationLabel(date: string | null, frequency: string) {
  if (!date) return "Unavailable";
  const parsed = new Date(`${date}T12:00:00Z`);
  const referencePeriod = frequency === "Monthly" || frequency === "Quarterly";
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "short",
    ...(referencePeriod ? { year: "numeric" } : { day: "numeric", year: "numeric" }),
    timeZone: "UTC",
  }).format(parsed);
  return `${referencePeriod ? "Ref." : "Obs."} ${formatted}`;
}

type MetricContext = NonNullable<MacroData["metrics"][number]["context"]>;

function Sparkline({ context }: { context: MetricContext }) {
  const values = context.spark;
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 56;
      const y = 16 - ((value - low) / span) * 14;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const tone =
    context.zScore === null ? "neutral" : context.zScore >= 1 ? "high" : context.zScore <= -1 ? "low" : "mid";
  return (
    <svg className={`metric-spark metric-spark--${tone}`} viewBox="0 0 56 18" aria-hidden="true">
      <polyline points={points} />
      <circle cx={56} cy={(16 - ((values.at(-1)! - low) / span) * 14).toFixed(1)} r={1.8} />
    </svg>
  );
}

function contextLabel(context: MetricContext) {
  const rank =
    context.percentile === null
      ? "unranked"
      : context.percentile >= 90
        ? "highest decile"
        : context.percentile <= 10
          ? "lowest decile"
          : `${context.percentile}th percentile`;
  const distance =
    context.zScore === null
      ? "no spread"
      : `${context.zScore > 0 ? "+" : ""}${context.zScore.toFixed(2)}σ`;
  return `${distance} · ${rank} of the last ${context.windowYears} years`;
}

function outcomeTone(value: number | null): Tone {
  if (value === null) return "neutral";
  return value > 0.5 ? "constructive" : value < -0.5 ? "stress" : "caution";
}

function DataStatus({ data, error }: { data: MacroData | null; error: string }) {
  return (
    <div className="macro-source-line">
      <span><i />{data ? data.stale ? "Saved macro snapshot" : "Macro data connected" : error ? "Macro connection failed" : "Connecting to macro data"}</span>
      <span>{data ? `${data.metrics.length} observations loaded` : error || "Checking published observations"}</span>
      <span>
        {data
          ? `${data.availability.dataQuality.status === "validated" ? "Validated" : "Review"} · ${new Date(data.fetchedAt).toLocaleString()}`
          : "No placeholder values are shown"}
      </span>
    </div>
  );
}

/**
 * The next session's regime.
 *
 * Presented as persistence rather than prediction, because that is what it is:
 * both scores run on 20- and 60-session windows, so tomorrow inherits nineteen
 * of twenty observations from today. The confidence is the measured frequency
 * of the label surviving one more session, recalibrated on forecasts that had
 * already resolved — not a claim of directional edge, which the engine has
 * separately shown does not exist at this horizon.
 *
 * The pivot is the more useful half. A probability is a summary; "it takes a
 * 1.2% move to change this" is exact, and it is what makes the number legible
 * on a day when the market ran hard and the label did not move.
 */
function RegimeOutlook({
  outlook,
}: {
  outlook: NonNullable<NonNullable<MacroData["marketRegime"]["outlook"]>>;
}) {
  const tone =
    outlook.direction === "Bullish" ? "constructive" : outlook.direction === "Bearish" ? "stress" : "caution";
  return (
    <div className="regime-outlook">
      <div className="regime-outlook-head">
        <p className="section-kicker">
          Next session{outlook.date ? ` · ${shortDate(outlook.date)}` : ""}
        </p>
        <h3>{outlook.name}</h3>
      </div>
      <div className="regime-outlook-figures">
        <span>
          <small>Label holds</small>
          <strong className={`regime-outlook-value regime-outlook-value--${tone}`}>
            {outlook.confidence}%
          </strong>
          <em>
            {outlook.calibrated
              ? `Calibrated on ${outlook.calibrationSamples} resolved forecasts`
              : `Uncalibrated · ${outlook.samples} resampled sessions`}
          </em>
        </span>
        <span>
          <small>Move that would change it</small>
          <strong className="regime-outlook-value">
            {outlook.pivotPercent === null
              ? "—"
              : `${outlook.pivotPercent > 0 ? "+" : ""}${outlook.pivotPercent.toFixed(2)}%`}
          </strong>
          <em>
            {outlook.pivotPercent === null
              ? "No move inside ±15% reaches a threshold"
              : `Shared index move to reach ${outlook.pivotTo}`}
          </em>
        </span>
      </div>
      <p className="regime-outlook-caveat">{outlook.caveat}</p>
    </div>
  );
}

function MarketBehaviorMap({ data }: { data: MacroData | null }) {
  const state = data?.marketRegime;
  const left = state ? Math.max(4, Math.min(96, (state.directionScore + 100) / 2)) : 50;
  const top = state ? Math.max(5, Math.min(95, 100 - state.behaviorScore)) : 50;
  const tone =
    state?.direction === "Bullish"
      ? "constructive"
      : state?.direction === "Bearish"
        ? "stress"
        : "caution";

  return (
    <figure className="market-behavior-figure">
      <header>
        <div>
          <p className="section-kicker">Market behavior · end of day</p>
          <h2>{state?.name ?? "Classifying the price path…"}</h2>
        </div>
        <span>{state ? `${state.confidence}% signal clarity` : "Waiting for daily closes"}</span>
      </header>
      <div
        className="behavior-plane"
        role="img"
        aria-label={state
          ? `${state.direction} direction and ${state.behavior.toLowerCase()} behavior. Direction score ${state.directionScore}; behavior score ${state.behaviorScore}.`
          : "Market direction and behavior map loading."}
      >
        <i className="behavior-axis behavior-axis--horizontal" />
        <i className="behavior-axis behavior-axis--vertical" />
        <span className="behavior-end behavior-end--trend">Trending</span>
        <span className="behavior-end behavior-end--mean">Mean-reverting</span>
        <span className="behavior-end behavior-end--bear">Bearish</span>
        <span className="behavior-end behavior-end--bull">Bullish</span>
        <span className="behavior-quadrant behavior-quadrant--tl">Downtrend</span>
        <span className="behavior-quadrant behavior-quadrant--tr">Uptrend</span>
        <span className="behavior-quadrant behavior-quadrant--bl">Weak · rotating</span>
        <span className="behavior-quadrant behavior-quadrant--br">Firm · rotating</span>
        <b
          className={`behavior-marker behavior-marker--${tone}`}
          style={{ left: `${left}%`, top: `${top}%` }}
          aria-hidden="true"
        ><i /></b>
      </div>
      <figcaption>
        <span><small>Direction</small><strong>{state?.directionScore ?? "—"}</strong><em>−100 bearish · +100 bullish</em></span>
        <span><small>Path behavior</small><strong>{state?.behaviorScore ?? "—"}</strong><em>0 rotational · 100 trending</em></span>
        <span>
          <small>Data through</small>
          <strong>{state?.asOf ?? "—"}</strong>
          {/* The lag is structural, not a failed fetch: FRED publishes an equity
              close on the next business day, so on a weekday evening the newest
              reading available is the session before. Saying only the date
              invites reading a working feed as broken, and the regime as having
              ignored the session that just traded. */}
          <em>
            {state?.provisionalSession
              ? "Provisional · exchange close, ahead of the FRED release"
              : describeSessionLag(state?.asOfSessionsBehind ?? null)}
          </em>
        </span>
      </figcaption>
      {state?.outlook && <RegimeOutlook outlook={state.outlook} />}
    </figure>
  );
}

type DailyRegime = MacroData["history"]["daily"][number];

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function RegimeHistoryChart({ rows }: { rows: DailyRegime[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = rows[selectedIndex ?? Math.max(rows.length - 1, 0)];
  const width = 1000;
  const chartLeft = 56;
  const chartRight = 974;
  const chartTop = 34;
  const chartBottom = 238;
  const laneTop = 272;
  const x = (index: number) =>
    chartLeft + (index / Math.max(rows.length - 1, 1)) * (chartRight - chartLeft);
  const y = (score: number) =>
    chartTop + ((100 - score) / 200) * (chartBottom - chartTop);
  const tone = (row: DailyRegime) =>
    row.direction === "Bullish" ? "constructive" : row.direction === "Bearish" ? "stress" : "neutral";

  if (!rows.length) {
    return <div className="regime-history-empty">Daily regime history is still loading.</div>;
  }

  return (
    <section className="regime-path-panel reveal reveal--1">
      <header className="visual-heading">
        <div>
          <p className="section-kicker">90-session regime path</p>
          <h2>How direction and behavior evolved</h2>
        </div>
        <div className={`regime-path-readout regime-path-readout--${tone(selected)}`}>
          <span>{shortDate(selected.date)}</span>
          <strong>{selected.name}</strong>
          <small>
            Direction {selected.directionScore > 0 ? "+" : ""}{selected.directionScore}
            {" · "}path {selected.behaviorScore}
          </small>
        </div>
      </header>
      <div
        className="regime-path-chart"
        onMouseLeave={() => setSelectedIndex(null)}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const relative = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
          setSelectedIndex(Math.round(relative * (rows.length - 1)));
        }}
      >
        <svg
          viewBox={`0 0 ${width} 330`}
          role="img"
          aria-label="Daily market direction score and trend behavior over the last ninety sessions"
        >
          <rect className="regime-zone regime-zone--bull" x={chartLeft} y={chartTop} width={chartRight - chartLeft} height={y(15) - chartTop} />
          <rect className="regime-zone regime-zone--neutral" x={chartLeft} y={y(15)} width={chartRight - chartLeft} height={y(-15) - y(15)} />
          <rect className="regime-zone regime-zone--bear" x={chartLeft} y={y(-15)} width={chartRight - chartLeft} height={chartBottom - y(-15)} />
          {[15, 0, -15].map((score) => (
            <g key={score}>
              <line className={score === 0 ? "regime-zero-line" : "regime-threshold-line"} x1={chartLeft} x2={chartRight} y1={y(score)} y2={y(score)} />
              <text className="regime-axis-label" x={chartLeft - 12} y={y(score) + 4} textAnchor="end">{score > 0 ? `+${score}` : score}</text>
            </g>
          ))}
          {rows.slice(1).map((row, index) => {
            const previous = rows[index];
            return (
              <line
                key={row.date}
                className={`regime-score-segment regime-score-segment--${tone(row)}`}
                x1={x(index)}
                y1={y(previous.directionScore)}
                x2={x(index + 1)}
                y2={y(row.directionScore)}
              />
            );
          })}
          <text className="regime-lane-label" x={chartLeft} y={laneTop - 12}>PATH BEHAVIOR</text>
          {rows.map((row, index) => {
            const cellWidth = Math.max(2, (chartRight - chartLeft) / rows.length - 1);
            return (
              <rect
                key={`lane-${row.date}`}
                className={`regime-behavior-cell regime-behavior-cell--${row.behavior.toLowerCase().replace("-", "")}`}
                x={x(index) - cellWidth / 2}
                y={laneTop}
                width={cellWidth}
                height={18}
                rx={1}
              />
            );
          })}
          {selectedIndex !== null && (
            <g className="regime-crosshair">
              <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={chartTop} y2={laneTop + 18} />
              <circle cx={x(selectedIndex)} cy={y(rows[selectedIndex].directionScore)} r={5} />
            </g>
          )}
          <text className="regime-date-label" x={chartLeft} y={320}>{shortDate(rows[0].date)}</text>
          <text className="regime-date-label" x={(chartLeft + chartRight) / 2} y={320} textAnchor="middle">{shortDate(rows[Math.floor(rows.length / 2)].date)}</text>
          <text className="regime-date-label" x={chartRight} y={320} textAnchor="end">{shortDate(rows.at(-1)!.date)}</text>
        </svg>
      </div>
      <footer className="regime-path-legend">
        <span><i className="legend-line legend-line--bull" />Bullish direction</span>
        <span><i className="legend-line legend-line--bear" />Bearish direction</span>
        <span><i className="legend-cell legend-cell--trend" />Trending path</span>
        <span><i className="legend-cell legend-cell--mean" />Mean-reverting path</span>
        <p>Move across the chart to inspect any session. Scores are replayed using only observations available through that date.</p>
      </footer>
    </section>
  );
}

function signedText(value: number | null, suffix: string, digits = 1) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function RecessionRiskPanel({ risk }: { risk: MacroData["recessionRisk"] | undefined }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const rows = risk?.history ?? [];
  const selected = rows[selectedIndex ?? Math.max(rows.length - 1, 0)] ?? null;
  const width = 1000;
  const chartLeft = 48;
  const chartRight = 976;
  const chartTop = 20;
  const chartBottom = 186;
  const x = (index: number) =>
    chartLeft + (index / Math.max(rows.length - 1, 1)) * (chartRight - chartLeft);
  const y = (probability: number) =>
    chartTop + (1 - probability / 100) * (chartBottom - chartTop);
  const line = (accessor: (row: (typeof rows)[number]) => number | null) =>
    rows
      .map((row, index) => {
        const value = accessor(row);
        return value === null ? null : `${x(index)},${y(value)}`;
      })
      .filter((point): point is string => point !== null)
      .join(" ");
  const curveTone =
    risk?.curve.probability === null || risk === undefined
      ? "neutral"
      : risk.curve.probability >= 40
        ? "stress"
        : risk.curve.probability >= 20
          ? "caution"
          : "constructive";
  const structure = risk?.termStructure;
  const premiumShare =
    structure?.nominal && structure.termPremium !== null && structure.nominal !== 0
      ? Math.max(0, Math.min(100, (structure.termPremium / structure.nominal) * 100))
      : null;

  return (
    <section className="recession-panel reveal reveal--2">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Cycle risk · forward and current</p>
          <h2>How close is the cycle to turning?</h2>
        </div>
        <p>Three separate readings: odds twelve months out, whether a downturn is already underway, and what the quarter in progress is tracking.</p>
      </div>

      <div className="recession-stat-row">
        <article className={`recession-stat recession-stat--${curveTone}`}>
          <span>12-month recession odds</span>
          <strong>{risk?.curve.probability === null || !risk ? "—" : `${risk.curve.probability.toFixed(1)}%`}</strong>
          <em>{signedText(risk?.curve.change3m ?? null, " pp over 3 months")}</em>
          <p>Probit on the {risk?.curve.spread === null || !risk ? "—" : `${risk.curve.spread.toFixed(2)} pp`} average 10y–3m spread{risk?.curve.asOf ? ` · ${monthLabel(risk.curve.asOf)}` : ""}.</p>
        </article>
        <article className="recession-stat">
          <span>Already in recession</span>
          <strong>{risk?.current.probability === null || !risk ? "—" : `${risk.current.probability.toFixed(2)}%`}</strong>
          <em>{signedText(risk?.current.change3m ?? null, " pp over 3 months", 2)}</em>
          <p>Smoothed dynamic-factor estimate of the current state{risk?.current.asOf ? ` · ${monthLabel(risk.current.asOf)}` : ""}.</p>
        </article>
        <article className="recession-stat">
          <span>GDPNow · {risk?.nowcast.quarter ?? "latest quarter"}</span>
          <strong>{risk?.nowcast.value === null || !risk ? "—" : `${risk.nowcast.value > 0 ? "+" : ""}${risk.nowcast.value.toFixed(1)}%`}</strong>
          <em>{signedText(risk?.nowcast.change ?? null, " pp versus prior quarter")}</em>
          <p>Annualized real growth implied by the releases already published. {risk?.nowcast.inProgress ? "The quarter is still open, so this moves with each new input." : "The quarter has closed; this is its final nowcast."}</p>
        </article>
      </div>

      {rows.length > 1 && (
        <div
          className="recession-chart"
          onMouseLeave={() => setSelectedIndex(null)}
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const relative = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
            setSelectedIndex(Math.round(relative * (rows.length - 1)));
          }}
        >
          <svg
            viewBox={`0 0 ${width} 220`}
            role="img"
            aria-label="Twelve-month curve recession probability and current-state recession probability over the last five years"
          >
            {[0, 25, 50, 75, 100].map((level) => (
              <g key={level}>
                <line className="recession-grid-line" x1={chartLeft} x2={chartRight} y1={y(level)} y2={y(level)} />
                <text className="regime-axis-label" x={chartLeft - 12} y={y(level) + 4} textAnchor="end">{level}%</text>
              </g>
            ))}
            <polyline className="recession-line recession-line--curve" points={line((row) => row.curve)} />
            <polyline className="recession-line recession-line--current" points={line((row) => row.current)} />
            {selectedIndex !== null && selected && (
              <g className="regime-crosshair">
                <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={chartTop} y2={chartBottom} />
                <circle cx={x(selectedIndex)} cy={y(selected.curve)} r={4} />
              </g>
            )}
            <text className="regime-date-label" x={chartLeft} y={210}>{monthLabel(rows[0].date)}</text>
            <text className="regime-date-label" x={(chartLeft + chartRight) / 2} y={210} textAnchor="middle">{monthLabel(rows[Math.floor(rows.length / 2)].date)}</text>
            <text className="regime-date-label" x={chartRight} y={210} textAnchor="end">{monthLabel(rows.at(-1)!.date)}</text>
          </svg>
          <div className="recession-legend">
            <span><i className="legend-line legend-line--curve" />Curve odds, 12 months ahead</span>
            <span><i className="legend-line legend-line--current" />Smoothed current state</span>
            {selected && (
              <strong>
                {monthLabel(selected.date)} · curve {selected.curve.toFixed(1)}%
                {selected.current === null ? "" : ` · current ${selected.current.toFixed(2)}%`}
              </strong>
            )}
          </div>
        </div>
      )}

      <div className="term-structure-block">
        <div>
          <p className="section-kicker">What the long end is pricing</p>
          <h3>{structure?.nominal === null || !structure ? "Unavailable" : `${structure.nominal.toFixed(2)}% ten-year yield`}</h3>
          <p>
            {structure && structure.expectations !== null && structure.termPremium !== null
              ? `${structure.expectations.toFixed(2)}% expected policy path plus ${structure.termPremium.toFixed(2)}% term premium. Over the last twenty observations the premium moved ${signedText(structure.termPremiumChange, " pp", 2)} and the expected path moved ${signedText(structure.expectationsChange, " pp", 2)}.`
              : "The term-premium estimate has not loaded."}
          </p>
        </div>
        {premiumShare !== null && (
          <div className="term-structure-bar" aria-label="Split of the ten-year yield between expected policy and term premium">
            <i className="term-structure-expectations" style={{ width: `${100 - premiumShare}%` }}><b>Expected path</b></i>
            <i className="term-structure-premium" style={{ width: `${premiumShare}%` }}><b>Term premium</b></i>
          </div>
        )}
      </div>

      <details className="learn-panel">
        <summary>How are these calculated?</summary>
        <p>{risk?.method ?? "Waiting for the calculation inputs."}</p>
        <p>{risk?.caveat ?? ""}</p>
      </details>
    </section>
  );
}

function TransitionMatrix({ history }: { history: MacroData["history"] | undefined }) {
  const transitions = history?.transitions;
  if (!transitions) return null;
  const shorten = (name: string) =>
    name.replace("Disinflationary ", "Disinfl. ").replace("expansion", "expansion");

  return (
    <section className="transition-panel reveal reveal--2">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Regime persistence · {history!.panelMonths} months from {history!.panelStart ?? "—"}</p>
          <h2>Where this environment has gone next</h2>
        </div>
        <p>Share of months in each classification that were followed by each other classification.</p>
      </div>
      <div className="transition-grid-wrapper">
        <table className="transition-grid">
          <thead>
            <tr>
              <th scope="col">From \ next month</th>
              {transitions.rows.map((row) => (
                <th scope="col" key={row.from}>{shorten(row.from)}</th>
              ))}
              <th scope="col">Months</th>
            </tr>
          </thead>
          <tbody>
            {transitions.rows.map((row) => (
              <tr key={row.from} className={row.from === transitions.current ? "transition-row--current" : undefined}>
                <th scope="row">{shorten(row.from)}</th>
                {row.to.map((cell) => (
                  <td key={cell.regime}>
                    <i
                      className="transition-cell"
                      style={{ opacity: cell.probability === null ? 0 : 0.08 + (cell.probability / 100) * 0.72 }}
                      aria-hidden="true"
                    />
                    <span>{cell.probability === null ? "—" : `${cell.probability.toFixed(0)}%`}</span>
                  </td>
                ))}
                <td className="transition-count">{row.observations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="transition-readout">
        <article>
          <span>Current run</span>
          <strong>{transitions.currentRun} months</strong>
          <p>in {transitions.current.toLowerCase()}</p>
        </article>
        <article>
          <span>Median completed run</span>
          <strong>{transitions.medianRunMonths === null ? "—" : `${transitions.medianRunMonths.toFixed(0)} months`}</strong>
          <p>across {transitions.completedRuns} past episodes of this regime</p>
        </article>
        <p className="transition-note">{transitions.method}</p>
      </div>
    </section>
  );
}

function EventWindowPanel({ history }: { history: MacroData["history"] | undefined }) {
  const windows = history?.eventWindows;
  if (!windows?.rows.length) return null;

  return (
    <section className="event-study-panel reveal reveal--3">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Scheduled events · {windows.index}</p>
          <h2>How this index has moved on release days</h2>
        </div>
        <p>Dates come from the publishers&rsquo; own historical schedules, not from a reconstruction.</p>
      </div>
      <div className="event-study-grid">
        {windows.rows.map((row) => {
          const excess =
            row.medianAbsoluteMove !== null && row.baselineAbsoluteMove !== null
              ? row.medianAbsoluteMove - row.baselineAbsoluteMove
              : null;
          return (
            <article key={row.label}>
              <header>
                <h3>{row.label}</h3>
                <span>{row.events} events · {row.firstEvent.slice(0, 7)} to {row.lastEvent.slice(0, 7)}</span>
              </header>
              <dl>
                <div>
                  <dt>Median absolute move</dt>
                  <dd>{row.medianAbsoluteMove === null ? "—" : `${row.medianAbsoluteMove.toFixed(2)}%`}</dd>
                </div>
                <div>
                  <dt>Typical session</dt>
                  <dd>{row.baselineAbsoluteMove === null ? "—" : `${row.baselineAbsoluteMove.toFixed(2)}%`}</dd>
                </div>
                <div>
                  <dt>Median direction</dt>
                  <dd>{row.medianDayMove === null ? "—" : `${row.medianDayMove > 0 ? "+" : ""}${row.medianDayMove.toFixed(2)}%`}</dd>
                </div>
                <div>
                  <dt>Higher close</dt>
                  <dd>{row.positiveShare.toFixed(0)}% of events</dd>
                </div>
                <div>
                  <dt>Range</dt>
                  <dd>{row.worst.toFixed(1)}% to {row.best > 0 ? "+" : ""}{row.best.toFixed(1)}%</dd>
                </div>
                <div>
                  <dt>Median 5 sessions after</dt>
                  <dd>{row.medianWeekMove === null ? "—" : `${row.medianWeekMove > 0 ? "+" : ""}${row.medianWeekMove.toFixed(2)}%`}</dd>
                </div>
              </dl>
              <p className={`event-verdict event-verdict--${excess === null ? "neutral" : excess > 0.05 ? "wide" : "quiet"}`}>
                {excess === null
                  ? "Not enough sessions to compare against a typical day."
                  : excess > 0.05
                    ? `Moves ${excess.toFixed(2)} pp more than a typical session.`
                    : `Moves no more than a typical session (${excess.toFixed(2)} pp).`}
              </p>
              <p className="event-note">{row.note}</p>
              <ul className="event-recent">
                {row.recent.map((event) => (
                  <li key={event.date}>
                    <time dateTime={event.date}>{shortDate(event.date)}</time>
                    <strong className={event.day >= 0 ? "up" : "down"}>
                      {event.day > 0 ? "+" : ""}{event.day.toFixed(2)}%
                    </strong>
                    <span>{event.week === null ? "—" : `${event.week > 0 ? "+" : ""}${event.week.toFixed(2)}% by session 5`}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      <details className="learn-panel">
        <summary>How is this measured?</summary>
        <p>{windows.method}</p>
        <p>{windows.caveat}</p>
      </details>
    </section>
  );
}

export function MacroDashboard({ view }: { view: View }) {
  const [data, setData] = useState<MacroData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/macro", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Macro request failed.");
        return payload as MacroData;
      })
      .then(setData)
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, []);

  const trail = useMemo(
    () => data?.history.rows.slice(0, 3).reverse().map((row) => ({
      growth: row.growth,
      inflation: row.inflation,
    })) ?? [],
    [data],
  );
  const upcomingCalendar = useMemo(() => {
    const meetings = (data?.availability.events.scheduled ?? []).map((meeting) => ({
      key: `fomc-${meeting.start}`,
      sort: `${meeting.start}T12:00:00Z`,
      date: formatMeetingDates(meeting.start, meeting.end),
      title: `FOMC meeting${meeting.projections ? " · projections" : ""}`,
      source: "Fed",
      countdown: countdownLabel(meeting.start),
    }));
    const releases = (data?.availability.events.releases ?? []).map((release) => {
      const instant = new Date(release.startsAt);
      const easternDay = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
      }).format(instant);
      return {
        key: `${release.source}-${release.startsAt}-${release.title}`,
        sort: release.startsAt,
        date: new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(instant),
        title: release.title,
        source: release.source,
        countdown: countdownLabel(easternDay),
      };
    });
    return [...meetings, ...releases]
      .sort((left, right) => left.sort.localeCompare(right.sort))
      .slice(0, 8);
  }, [data]);

  if (view === "overview") {
    return (
      <div className="page-shell">
        <OrientationHero
          eyebrow={`Macro overview · ${data ? "official data" : error ? "connection error" : "loading"}`}
          question="How is this market behaving?"
          answer={data?.marketRegime.name ?? (error ? "Macro data is unavailable." : "Reading the environment…")}
          detail={data
            ? `${data.marketRegime.summary} The economic backdrop is ${data.regime.name.toLowerCase()}, with risk appetite at ${data.regime.riskAppetite}/100.`
            : error || "Loading growth, inflation, rates, liquidity, stress, and positioning."}
          confidence={data?.marketRegime.confidence}
          confidenceLabel="Signal clarity"
          caveat={data?.marketRegime.caveat ?? "No regime conclusion is shown until the official observations load."}
        />

        <section className="market-state-board reveal reveal--1">
          <MarketBehaviorMap data={data} />
          <aside className="market-state-reading">
            <div>
              <p className="section-kicker">What this changes</p>
              <h2>{data?.marketRegime.behavior ?? "Waiting for the path"}</h2>
              <p>{data?.marketRegime.playbook ?? "The practical reading appears after the daily price, credit, and volatility inputs load."}</p>
            </div>
            <div className="market-factor-list">
              {data?.marketRegime.factors.map((factor) => (
                <article key={factor.label}>
                  <span><i className={`tone-dot tone-dot--${factor.tone}`} />{factor.label}</span>
                  <strong>{factor.reading}</strong>
                  <p>{factor.value}</p>
                  <small>{factor.note}</small>
                </article>
              ))}
            </div>
            <details className="learn-panel">
              <summary>How is behavior detected?</summary>
              <p>{data?.marketRegime.method ?? "Waiting for calculation inputs."}</p>
            </details>
          </aside>
        </section>

        <section className="today-composition reveal reveal--2">
          <RegimeMap
            compact
            regime={data?.regime.name}
            growth={data?.regime.growth}
            inflation={data?.regime.inflation}
            trail={trail}
          />
          <aside className="context-rail">
            <div className="context-block">
              <p className="section-kicker">Current posture</p>
              <strong className="posture-word">{data?.regime.posture ?? "Loading"}</strong>
              <p>{data
                ? `Risk appetite is ${data.regime.riskAppetite}/100. This is a transparent GEXLab composite, not a proprietary Fear & Greed index.`
                : "The posture will appear after all required observations are checked."}</p>
            </div>
            <div className="risk-scale" aria-label="Risk appetite composite">
              <div><span>Defensive</span><strong>{data?.regime.riskAppetite ?? "—"}</strong><span>Risk-on</span></div>
              <i><b style={{ left: `${data?.regime.riskAppetite ?? 50}%` }} /></i>
            </div>
            <details className="learn-panel" open>
              <summary>How is this calculated?</summary>
              <p>{data
                ? `${data.regime.method} ${data.regime.riskAppetiteMethod}`
                : "Waiting for the calculation inputs."}</p>
            </details>
          </aside>
        </section>

        <section className="daily-drivers reveal reveal--3">
          <div className="section-heading">
            <div>
              <p className="section-kicker">What matters now</p>
              <h2>The observed evidence behind the read</h2>
            </div>
            <p>Fact, interpretation, and possible implication are kept separate.</p>
          </div>
          <div className="driver-list">
            {data?.drivers.map((driver, index) => (
              <article className="driver-row" key={driver.label}>
                <span className="driver-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="driver-name">
                  <h3>{driver.label}</h3>
                  <span className={`state-label state-label--${driver.tone}`}>{driver.state}</span>
                </div>
                <p>{driver.fact}</p>
                <p className="driver-implication">{driver.implication}</p>
              </article>
            ))}
            {!data && <div className="macro-loading">{error || "Loading official observations…"}</div>}
          </div>
        </section>

        <section className="availability-strip reveal reveal--3">
          <article><span>Economic data</span><strong>{data ? "Series connected" : "Checking"}</strong><p>{data?.availability.series.unavailableSeries.length ? `Unavailable: ${data.availability.series.unavailableSeries.join(", ")}` : "Series-level dates are shown throughout."}</p></article>
          <article>
            <span>Event calendar</span>
            <strong>
              {!data
                ? "Checking"
                : data.availability.events.status === "unavailable"
                  ? "Not connected"
                  : "Calendar connected"}
            </strong>
            <p>{data?.availability.events.reason ?? "Checking the official source."}</p>
          </article>
          <article>
            <span>Options skew</span>
            <strong>
              {!data
                ? "Checking"
                : data.availability.positioningSkew.riskReversal25 === null
                  ? "Not connected"
                  : `${(data.availability.positioningSkew.riskReversal25 * 100).toFixed(2)} pts`}
            </strong>
            <p>{data?.availability.positioningSkew.reason ?? "Checking the option surface."}</p>
          </article>
        </section>

        {Boolean(upcomingCalendar.length || data?.availability.events.published?.length) && (
          <section className="event-board reveal reveal--3" aria-label="Official economic events">
            <div>
              <p className="section-kicker">Upcoming · official calendar</p>
              <ul>
                {upcomingCalendar.map((event) => (
                  <li key={event.key}>
                    <strong>{event.date}</strong>
                    <span>{event.title}</span>
                    <i title={`${event.source} · ${event.countdown}`}>{event.source}</i>
                  </li>
                ))}
              </ul>
              {!upcomingCalendar.length && (
                <p className="event-empty">No upcoming major release is scheduled.</p>
              )}
            </div>
            <div>
              <p className="section-kicker">Published · official releases</p>
              <ul>
                {(data!.availability.events.published ?? []).slice(0, 6).map((item) => (
                  <li key={`${item.source}-${item.publishedAt}-${item.title}`}>
                    <strong>{new Date(item.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}</strong>
                    <span>{item.title}</span>
                    <i title={item.source}>{SOURCE_ABBREVIATIONS[item.source] ?? item.source}</i>
                  </li>
                ))}
              </ul>
              {!data!.availability.events.published?.length && (
                <p className="event-empty">No official release feed responded.</p>
              )}
            </div>
          </section>
        )}
        <DataStatus data={data} error={error} />
      </div>
    );
  }

  if (view === "regime") {
    return (
      <div className="page-shell">
        <OrientationHero
          eyebrow={`Macro regime · ${data ? "official observations" : "loading"}`}
          question="What is driving the market environment?"
          answer={data?.regime.name ?? "Calculating the regime…"}
          detail={data
            ? `${data.regime.summary} The pillar scores show where the inputs agree and where they conflict.`
            : error || "Loading the latest available macro releases."}
          confidence={data?.regime.confidence}
          confidenceLabel="Pillar agreement"
          caveat={data?.regime.caveat ?? "No conclusion is produced from missing inputs."}
        />

        <section className="regime-composition reveal reveal--1">
          <RegimeMap
            regime={data?.regime.name}
            growth={data?.regime.growth}
            inflation={data?.regime.inflation}
            trail={trail}
          />
          <div className="pillar-panel">
            <div className="section-heading section-heading--stacked">
              <div><p className="section-kicker">Pillar read</p><h2>What agrees—and what does not</h2></div>
              <p>Right is more supportive. These positions are model outputs, not published statistics.</p>
            </div>
            <div className="pillar-list">
              {data?.pillars.map((pillar) => (
                <article className="pillar-row" key={pillar.id}>
                  <div className="pillar-title">
                    <h3>{pillar.label}</h3>
                    <span className={`state-label state-label--${pillar.tone}`}>{pillar.reading} · {pillar.score}</span>
                  </div>
                  <div className="pillar-track" aria-label={`${pillar.label}: ${pillar.score} out of 100`}>
                    <span className="pillar-midpoint" />
                    <i className={`pillar-position pillar-position--${pillar.tone}`} style={{ left: `${pillar.score}%` }} />
                  </div>
                  <p>{pillar.note}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <RecessionRiskPanel risk={data?.recessionRisk} />

        <section className="macro-ledger reveal reveal--2">
          <div className="section-heading">
            <div><p className="section-kicker">Data ledger</p><h2>Every observation behind the model</h2></div>
            <p>Values are published observations. Scores and implications are GEXLab calculations.</p>
          </div>
          {GROUP_ORDER.map((group) => {
            const rows = data?.metrics.filter((row) => row.group === group) ?? [];
            if (!rows.length) return null;
            return (
              <section className="metric-group" key={group}>
                <h3>{group}</h3>
                <div>
                  {rows.map((row) => (
                    <details className="metric-row" key={row.id}>
                      <summary>
                        <span>{row.label}<small>{row.frequency} observation · {row.series}</small></span>
                        <strong>{row.display}</strong>
                        <em>{row.changeDisplay}</em>
                        {row.context ? <Sparkline context={row.context} /> : <i className="metric-spark-empty" />}
                        <time dateTime={row.date ?? undefined}>{observationLabel(row.date, row.frequency)}</time>
                      </summary>
                      <p>{row.meaning} Latest observation: {row.date ?? "unavailable"} · {row.frequency}.</p>
                      {row.context && (
                        <p className="metric-context">
                          {contextLabel(row.context)} · {row.context.observations} observations in the comparison window.
                        </p>
                      )}
                    </details>
                  ))}
                </div>
              </section>
            );
          })}
          {!data && <div className="macro-loading">{error || "Loading official observations…"}</div>}
        </section>
        <DataStatus data={data} error={error} />
      </div>
    );
  }

  const quantiles = data?.history.quantiles ?? [];
  const finite = quantiles.filter((value): value is number => value !== null);
  const min = Math.min(...finite, -1);
  const max = Math.max(...finite, 1);
  const position = (value: number) => 7 + ((value - min) / Math.max(max - min, 0.01)) * 86;
  const labels = ["10th", "25th", "Median", "75th", "90th"];

  return (
    <div className="page-shell">
      <OrientationHero
        eyebrow={`Regime history · ${data ? "daily replay + monthly context" : "loading"}`}
        question="How did this environment develop?"
        answer={data ? `${data.history.daily.length} sessions of regime progression.` : "Rebuilding the daily path…"}
        detail={data
          ? "The daily path shows when direction and market behavior changed. The monthly section below compares similar growth-and-inflation backdrops."
          : error || "Loading daily market state and revised macro history."}
        caveat={data?.history.caveat ?? "No historical conclusion is displayed before the source data loads."}
      />

      <RegimeHistoryChart rows={data?.history.daily ?? []} />

      <section className="history-overview reveal reveal--2">
        <article className="distribution-panel">
          <div className="visual-heading">
            <div><p className="section-kicker">Similar-regime distribution</p><h2>Twenty-session Nasdaq-100 outcomes</h2></div>
            <span className="sample-label">Revised data · n = {data?.history.sampleSize ?? "—"}</span>
          </div>
          <div className="distribution-plot" aria-label="Distribution of subsequent twenty-session Nasdaq-100 returns">
            <div className="distribution-range" />
            {min <= 0 && max >= 0 && <div className="distribution-zero" style={{ left: `${position(0)}%` }}><i /><span>0%</span></div>}
            {quantiles.map((outcome, index) => outcome === null ? null : (
              <div className={`outcome-marker ${index === 2 ? "outcome-marker--median" : ""}`} style={{ left: `${position(outcome)}%` }} key={labels[index]}>
                <i /><strong>{outcome > 0 ? "+" : ""}{outcome.toFixed(1)}%</strong><span>{labels[index]}</span>
              </div>
            ))}
          </div>
          <p className="plot-reading"><span>How to read this</span>
            The center is the median result; the outer marks show how wide outcomes have been. This is conditional history, not a forecast.
          </p>
        </article>
        <aside className="sample-quality">
          <p className="section-kicker">Sample quality</p>
          <div className="quality-score"><strong>{(data?.history.sampleSize ?? 0) >= 40 ? "Fair" : "Thin"}</strong><span>sample depth</span></div>
          <dl>
            <div><dt>Observations</dt><dd>{data?.history.sampleSize ?? "—"}</dd></div>
            <div><dt>Coverage start</dt><dd>{data?.history.coverageStart ?? "—"}</dd></div>
            <div><dt>Coverage end</dt><dd>{data?.history.coverageEnd ?? "—"}</dd></div>
            <div><dt>Return horizon</dt><dd>20 sessions</dd></div>
            <div>
              <dt>Point-in-time months</dt>
              <dd>
                {data
                  ? `${data.availability.vintages.pointInTimeMonths} of ${data.availability.vintages.panelMonths}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>As-published copies</dt>
              <dd>{data ? `${data.availability.vintages.collected} of ${data.availability.vintages.target}` : "—"}</dd>
            </div>
          </dl>
          {data && (
            <p className="vintage-note">{data.availability.vintages.reason}</p>
          )}
          <p>{data ? `${data.history.caveat} Monthly samples and their 20-session return windows can overlap.` : "Loading methodology."}</p>
        </aside>
      </section>

      <TransitionMatrix history={data?.history} />

      <EventWindowPanel history={data?.history} />

      <section className="regime-timeline-section reveal reveal--2">
        <div className="section-heading">
          <div><p className="section-kicker">Recent monthly classifications</p><h2>How the environment changed</h2></div>
          <p>Macro releases are aligned to each month using currently revised series.</p>
        </div>
        <div className="regime-timeline">
          {data?.history.rows.map((row) => (
            <article key={row.date}>
              <i className={`timeline-mark timeline-mark--${outcomeTone(row.outcome)}`} aria-hidden="true" />
              <div><span>{row.date}</span><h3>{row.regime}</h3></div>
              <p>
                20 sessions from {row.returnStart ?? "pending"}
                <small className={`basis-tag basis-tag--${row.basis === "point-in-time" ? "vintage" : "revised"}`}>
                  {row.basis === "point-in-time" ? `as published ${row.vintage}` : "revised data"}
                </small>
              </p>
              <strong>{row.outcome === null ? "Pending" : `${row.outcome > 0 ? "+" : ""}${row.outcome.toFixed(1)}%`}</strong>
            </article>
          ))}
        </div>
      </section>
      <DataStatus data={data} error={error} />
    </div>
  );
}
