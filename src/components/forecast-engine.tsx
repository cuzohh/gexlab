"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { OrientationHero } from "@/components/orientation-hero";

type CalibrationBin = {
  lower: number;
  upper: number;
  count: number;
  predicted: number | null;
  observed: number | null;
};

type ClassifierEvaluation = {
  target: string;
  question: string;
  samples: number;
  from: string;
  to: string;
  model: { logLoss: number | null; brier: number | null; accuracy: number | null; auc: number | null };
  baseRate: { logLoss: number | null; brier: number | null; accuracy: number | null };
  skill: { logLoss: number | null; brier: number | null; accuracy: number | null };
  horizon: number;
  comparison: {
    meanAdvantage: number;
    standardError: number;
    statistic: number;
    pValue: number;
    lag: number;
    samples: number;
    effectiveSamples: number;
  } | null;
  falseDiscoveryRate: number | null;
  beatsBaseline: boolean;
  calibration: CalibrationBin[];
  confident: { threshold: number; share: number; accuracy: number | null; samples: number };
  coefficients: { feature: string; weight: number }[];
};

type SessionCharacterTarget = {
  probability: number | null;
  baseRate: number | null;
  hasMeasuredEdge: boolean;
  falseDiscoveryRate: number | null;
  question: string;
};

type EngineData = {
  modelVersion: string;
  fetchedAt: string;
  asOf: string;
  nextSession: string;
  index: string;
  stale?: boolean;
  forecast: {
    direction: { probability: number | null; baseRate: number | null; edge: number | null };
    continuation: { probability: number | null; baseRate: number | null; edge: number | null };
    expectedMove: number | null;
    typicalMove: number;
    lastPrice?: number;
    range: {
      low95: number | null;
      low50: number | null;
      median: number | null;
      high50: number | null;
      high95: number | null;
    } | null;
    dollarRange?: {
      low95Price: number | null;
      low50Price: number | null;
      medianPrice: number | null;
      high50Price: number | null;
      high95Price: number | null;
    } | null;
    moveMap?: {
      reference: number;
      asOf: string;
      source: string;
      sourceStatus: string;
      upper: { p50: number; p68: number; p90: number };
      lower: { p50: number; p68: number; p90: number };
      upperPrices: { p50: number; p68: number; p90: number };
      lowerPrices: { p50: number; p68: number; p90: number };
      impliedMove: number | null;
      statisticalMove: number;
      blend: { impliedWeight: number; historicalWeight: number; selection: string };
      regimeMatch: { samples: number; label: string };
      evaluation: { samples: number; upperMae: number; lowerMae: number; p68Coverage: number; p90Coverage: number };
      reaction: { label: string; price: number | null; distancePercent: number | null; reason: string };
      caveat: string;
    } | null;
    recommendedExposure?: {
      positionPct: number;
      cashPct: number;
      exposureLabel: string;
      basis?: string;
      hasMeasuredEdge?: boolean;
      volatilityScale: number;
    };
    sessionCharacter?: {
      wideRange: SessionCharacterTarget;
      volatilityExpansion: SessionCharacterTarget;
      caveat: string;
    } | null;
    sessionContext: {
      asOf: string;
      nextSession: string;
      relativeStrength: {
        oneDay: number | null;
        fiveDay: number | null;
        label: string;
        source: string;
      };
      impliedMove: {
        percent: number | null;
        points: number | null;
        source: string;
        horizonDays: number | null;
      };
      gamma: {
        regime: string;
        netGamma: number | null;
        flipDistancePercent: number | null;
        callWallDistancePercent: number | null;
        putWallDistancePercent: number | null;
        nearestLevel: string;
        nearestLevelDistancePercent: number | null;
      };
      volatility: {
        atmIvChange: number | null;
        riskReversalChange: number | null;
        butterflyChange: number | null;
      };
      event: {
        today: string[];
        nextSession: string[];
        isEventDay: boolean;
        isNextSessionEvent: boolean;
      };
      overnight: {
        sessionDate: string;
        status: string;
        stale?: boolean;
        regime: string;
        playbook: string;
        regimeBasis: string;
        confidence: {
          structuralScore: number | null;
          structuralLevel: string;
          directionalScore: number | null;
          directionalLevel: string;
          reasons: string[];
        };
        source: string;
        sourceDelayMinutes: number;
        observedThrough: string | null;
        history?: {
          sessions: number;
          required: number;
          firstDate: string | null;
          lastDate: string | null;
        };
        nq: {
          overnightOpen: number | null;
          last: number | null;
          priorRthClose: number | null;
          gapPoints: number | null;
          gapPercent: number | null;
          overnightHigh: number | null;
          overnightLow: number | null;
          overnightRangePoints: number | null;
          overnightRangePercent: number | null;
          rangePositionPercent: number | null;
          netMoveToRange: number | null;
          inventoryScore: number | null;
          inventoryLabel: string;
          overnightVolume: number | null;
          bars: number;
        };
        es: {
          overnightOpen: number | null;
          last: number | null;
          priorRthClose: number | null;
          gapPoints: number | null;
          gapPercent: number | null;
          overnightHigh: number | null;
          overnightLow: number | null;
          overnightRangePoints: number | null;
          overnightRangePercent: number | null;
          rangePositionPercent: number | null;
          netMoveToRange: number | null;
          inventoryScore: number | null;
          inventoryLabel: string;
          overnightVolume: number | null;
          bars: number;
        };
        note: string | null;
      };
      unavailable: string[];
    };
  };
  evaluation: {
    direction: ClassifierEvaluation | null;
    direction5d?: ClassifierEvaluation | null;
    direction20d?: ClassifierEvaluation | null;
    continuation: ClassifierEvaluation | null;
    volatilityExpansion?: ClassifierEvaluation | null;
    wideRangeDay?: ClassifierEvaluation | null;
    rallySpike5d?: ClassifierEvaluation | null;
    downsideTail?: ClassifierEvaluation | null;
    drawdown5d?: ClassifierEvaluation | null;
    volatility: {
      samples: number;
      from: string;
      to: string;
      rSquared: number | null;
      randomWalkRSquared: number | null;
      trailingAverageRSquared: number | null;
      meanAbsoluteError: number;
      randomWalkError: number;
      trailingAverageError: number;
      pinballLoss?: {
        p05: number | null;
        p50: number | null;
        p95: number | null;
      };
    } | null;
    economicStrategy?: {
      sharpeRatio: number | null;
      cagr: number | null;
      maxDrawdown: number | null;
      winRate: number | null;
      totalTurnover: number;
      trades: number;
      cumulativeReturn: number;
      benchmarkReturn: number;
    } | null;
    states: {
      overall: number;
      samples: number;
      caveat: string;
      rows: {
        label: string;
        note: string;
        samples: number;
        upRate: number;
        edge: number;
        meanReturn: number;
        zScore: number;
        notable: boolean;
      }[];
    };
    window: { initialTrain: number; refitEvery: number; embargo: number; maxTrain: number };
    featureCount: number;
    sessions: number;
    trainingStart: string;
  };
  positioning: {
    required: number;
    sessions: number;
    symbol: string | null;
    firstDate: string | null;
    lastDate: string | null;
    status: string;
    reason: string;
    coverage: { symbol: string; sessions: number; features: number; firstDate: string | null; lastDate: string | null }[];
    latestReadings: { feature: string; value: number }[];
    intraday: {
      symbol: string | null;
      observations: number;
      sessions: number;
      observationsPerSession: number;
      clusterSize: number;
      effectiveObservations: number;
      firstDate: string | null;
      lastDate: string | null;
      sessionsRemaining: number | null;
      reason: string;
      coverage: { symbol: string; observations: number; sessions: number; firstDate: string | null; lastDate: string | null }[];
    };
  };
  live: {
    records: {
      targetDate: string;
      target: string;
      probability: number | null;
      realized: number | null;
      correct: boolean | null;
      predictedAt: string;
    }[];
    settled: number;
    accuracy: number | null;
    reason: string;
  };
  method: string;
  caveat: string;
};

function percent(value: number | null, digits = 1) {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function signed(value: number | null, suffix = "", digits = 2) {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function ProbabilityCard({
  title,
  question,
  probability,
  baseRate,
  edge,
  evaluation,
}: {
  title: string;
  question: string;
  probability: number | null;
  baseRate: number | null;
  edge: number | null;
  evaluation: ClassifierEvaluation | null;
}) {
  const meaningful = edge !== null && Math.abs(edge) >= 1;
  return (
    <article className={`forecast-card forecast-card--${meaningful ? "active" : "flat"}`}>
      <span className="section-kicker">{title}</span>
      <strong>{percent(probability)}</strong>
      <p className="forecast-question">{question}</p>
      <div className="forecast-scale" aria-label={`${title} probability against its base rate`}>
        <i className="forecast-scale-track" />
        {baseRate !== null && (
          <i className="forecast-scale-base" style={{ left: `${baseRate * 100}%` }} />
        )}
        {probability !== null && (
          <b className="forecast-scale-mark" style={{ left: `${probability * 100}%` }} />
        )}
      </div>
      <dl>
        <div>
          <dt>Base rate</dt>
          <dd>{percent(baseRate)}</dd>
        </div>
        <div>
          <dt>Edge over base rate</dt>
          <dd>{signed(edge, " pp")}</dd>
        </div>
      </dl>
      <p className="forecast-verdict">
        {evaluation === null
          ? "Not yet evaluated."
          : evaluation.beatsBaseline
            ? `Beats the base rate out of sample across ${evaluation.samples.toLocaleString()} sessions.`
            : `Does not beat the base rate out of sample across ${evaluation.samples.toLocaleString()} sessions. Treat this number as description, not signal.`}
      </p>
    </article>
  );
}

/**
 * How the next session behaves, as opposed to which way it goes.
 *
 * These are the only two targets in the engine that beat their baseline after a
 * multiple-testing correction, and until now they existed only as backtest
 * metrics: the page led with direction, which has no measured edge, and said
 * nothing about the two that do. Every input is known at the prior close, so
 * this is readable before the opening bell.
 *
 * Each row shows its own base rate, because a probability means nothing without
 * one — 40% is a strong reading against a 24% base and a weak one against 50%.
 */
function SessionCharacter({
  character,
  session,
}: {
  character: NonNullable<NonNullable<EngineData["forecast"]["sessionCharacter"]>>;
  session: string;
}) {
  const rows = [
    { key: "wideRange", label: "Wide range", target: character.wideRange },
    { key: "volatilityExpansion", label: "Volatility expansion", target: character.volatilityExpansion },
  ];
  return (
    <section id="behavior" className="session-character reveal reveal--2">
      <div className="section-heading">
        <span className="card-kicker">Before the open · {session}</span>
        <h2>How the next session behaves</h2>
        <p>{character.caveat}</p>
      </div>
      <div className="session-character-grid">
        {rows.map(({ key, label, target }) => {
          const probability = target.probability;
          const base = target.baseRate;
          const lift = probability !== null && base !== null ? (probability - base) * 100 : null;
          return (
            <article className="card session-character-card" key={key}>
              <div className="card-header">
                <span className="card-kicker">{label}</span>
                <h3>{target.question}</h3>
              </div>
              <div className="probability-display">
                <span className="probability-value">
                  {probability === null ? "—" : `${(probability * 100).toFixed(0)}%`}
                </span>
                <span className="probability-meta">
                  {base === null ? "no base rate" : `base rate ${(base * 100).toFixed(0)}%`}
                  {lift === null ? "" : ` · ${lift >= 0 ? "+" : ""}${lift.toFixed(1)}pp`}
                </span>
              </div>
              {/* Where the probability sits against its base rate, so the lift
                  is visible rather than arithmetic the reader has to do. */}
              <div className="session-character-scale" aria-hidden="true">
                <i className="session-character-fill" style={{ width: `${(probability ?? 0) * 100}%` }} />
                {base !== null && (
                  <i className="session-character-base" style={{ left: `${base * 100}%` }} />
                )}
              </div>
              <div className="card-footer">
                <small>
                  {target.hasMeasuredEdge
                    ? `Beats its base rate out of sample${
                        target.falseDiscoveryRate === null
                          ? ""
                          : ` (q = ${target.falseDiscoveryRate.toExponential(1)})`
                      }.`
                    : "No measured edge over its base rate; shown for context only."}
                </small>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RangeBar({ forecast }: { forecast: EngineData["forecast"] }) {
  const range = forecast.range;
  if (!range || range.low95 === null || range.high95 === null) return null;
  const span = range.high95 - range.low95;
  const position = (value: number) => ((value - range.low95!) / span) * 100;

  return (
    <article className="range-panel">
      <span className="section-kicker">Expected size of the move</span>
      <strong>±{forecast.expectedMove === null ? "—" : forecast.expectedMove.toFixed(2)}%</strong>
      <p className="forecast-question">
        Typical session over the last year moved {forecast.typicalMove.toFixed(2)}%.
        {forecast.expectedMove !== null &&
          (forecast.expectedMove > forecast.typicalMove
            ? " Tomorrow is forecast wider than that."
            : " Tomorrow is forecast tighter than that.")}
      </p>
      <div className="range-plot" aria-label="Forecast distribution of the next session's return">
        <motion.i className="range-outer" style={{ left: "0%", width: "100%", transformOrigin: "left center" }} initial={false} animate={{ opacity: 1, scaleX: 1 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} />
        {range.low50 !== null && range.high50 !== null && (
          <motion.i
            className="range-inner"
            style={{ left: `${position(range.low50)}%`, width: `${position(range.high50) - position(range.low50)}%` }}
            initial={false}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ delay: 0.12, duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        <motion.i className="range-zero" style={{ left: `${position(0)}%` }} initial={false} animate={{ opacity: 1, scaleY: 1 }} transition={{ delay: 0.32, duration: 0.3 }} />
        {range.median !== null && <motion.b className="range-median" style={{ left: `${position(range.median)}%` }} initial={false} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.34, duration: 0.32 }} />}
        <span className="range-label range-label--low">{range.low95.toFixed(2)}%</span>
        <span className="range-label range-label--high">+{range.high95.toFixed(2)}%</span>
      </div>
      <dl>
        <div>
          <dt>Middle half of outcomes</dt>
          <dd>
            {range.low50 === null ? "—" : `${range.low50.toFixed(2)}%`} to{" "}
            {range.high50 === null ? "—" : `+${range.high50.toFixed(2)}%`}
          </dd>
        </div>
        <div>
          <dt>90% of outcomes</dt>
          <dd>
            {range.low95.toFixed(2)}% to +{range.high95.toFixed(2)}%
          </dd>
        </div>
      </dl>
      {forecast.dollarRange && forecast.dollarRange.low95Price !== null && forecast.dollarRange.high95Price !== null && (
        // Plain rows in the same list style as the percentage bounds above.
        // The value used to be wrapped in <strong>, which this panel styles as
        // its headline number at up to 3rem: in a two-column list of "label |
        // value" that pushed the value column to a third of the card and left
        // the label wrapping one word per line. The border was drawn from
        // --border-subtle, which this stylesheet does not define, so it fell
        // back to a hard-coded translucent white — invisible on the dark theme
        // and a pale line across the light one.
        <dl className="range-panel-prices">
          <div>
            <dt>Exact index median target</dt>
            <dd>${forecast.dollarRange.medianPrice?.toLocaleString()}</dd>
          </div>
          <div>
            <dt>90% dollar bounds (p05–p95)</dt>
            <dd>
              ${forecast.dollarRange.low95Price?.toLocaleString()} – ${forecast.dollarRange.high95Price?.toLocaleString()}
            </dd>
          </div>
        </dl>
      )}
    </article>
  );
}

function MoveMapPanel({ moveMap }: { moveMap: NonNullable<EngineData["forecast"]["moveMap"]> }) {
  const price = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  const percent = (value: number) => `${value.toFixed(2)}%`;
  const low = moveMap.lowerPrices.p90;
  const high = moveMap.upperPrices.p90;
  const at = (value: number) => `${Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100))}%`;
  const reactionTone = moveMap.reaction.label === "GEX reaction candidate" ? "constructive" : moveMap.reaction.label === "Acceleration overlap" ? "stress" : "neutral";
  return (
    <article className="move-map-panel">
      <header className="move-map-head">
        <div>
          <span className="section-kicker">Calibrated move map</span>
          <h2>Reach first. Reversal only with structure.</h2>
        </div>
        <span className={`move-map-state move-map-state--${reactionTone}`}>{moveMap.reaction.label}</span>
      </header>
      <div className="move-map-scale" role="img" aria-label={`Projected lower 90 percent reach ${price(low)}, reference ${price(moveMap.reference)}, and upper 90 percent reach ${price(high)}`}>
        <motion.i className="move-map-outer" initial={false} animate={{ opacity: 1, scaleX: 1 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} />
        <motion.i className="move-map-inner" style={{ left: at(moveMap.lowerPrices.p68), width: `calc(${at(moveMap.upperPrices.p68)} - ${at(moveMap.lowerPrices.p68)})`, transformOrigin: "left center" }} initial={false} animate={{ opacity: 1, scaleX: 1 }} transition={{ delay: 0.12, duration: 0.48, ease: [0.16, 1, 0.3, 1] }} />
        <motion.b className="move-map-reference" style={{ left: at(moveMap.reference) }} initial={false} animate={{ opacity: 1, scaleY: 1 }} transition={{ delay: 0.3, duration: 0.3 }}><span>REF {price(moveMap.reference)}</span></motion.b>
        <b className="move-map-marker move-map-marker--upper" style={{ left: at(moveMap.upperPrices.p68) }}><span>+1σ {price(moveMap.upperPrices.p68)}</span></b>
        <b className="move-map-marker move-map-marker--lower" style={{ left: at(moveMap.lowerPrices.p68) }}><span>−1σ {price(moveMap.lowerPrices.p68)}</span></b>
        {moveMap.reaction.price !== null && <b className={`move-map-reaction move-map-reaction--${reactionTone}`} style={{ left: at(moveMap.reaction.price) }}><span>{price(moveMap.reaction.price)}</span></b>}
        <small className="move-map-edge move-map-edge--low">90% {price(low)}</small>
        <small className="move-map-edge move-map-edge--high">90% {price(high)}</small>
      </div>
      <div className="move-map-grid">
        <p><span>Upward excursion</span><strong>+{percent(moveMap.upper.p68)}</strong><small>68% reach · {price(moveMap.upperPrices.p68)}</small></p>
        <p><span>Downward excursion</span><strong>−{percent(moveMap.lower.p68)}</strong><small>68% reach · {price(moveMap.lowerPrices.p68)}</small></p>
        <p><span>Blend</span><strong>{moveMap.impliedMove === null ? "Historical" : `${Math.round(moveMap.blend.impliedWeight * 100)}% implied`}</strong><small>{moveMap.blend.selection} · {moveMap.evaluation.samples} scored sessions</small></p>
        <p><span>Regime analogue</span><strong>{moveMap.regimeMatch.label}</strong><small>{moveMap.regimeMatch.samples || "No"} volatility-curve comparables</small></p>
      </div>
      <p className="move-map-reason"><strong>{moveMap.reaction.reason}</strong> {moveMap.caveat}</p>
      <details className="move-map-evaluation">
        <summary>Calibration record</summary>
        <p>{moveMap.evaluation.samples} rolling sessions · upper MAE {percent(moveMap.evaluation.upperMae)} · lower MAE {percent(moveMap.evaluation.lowerMae)} · joint 68% coverage {moveMap.evaluation.p68Coverage.toFixed(0)}% · joint 90% coverage {moveMap.evaluation.p90Coverage.toFixed(0)}%.</p>
      </details>
    </article>
  );
}

function SessionContextPanel({ context }: { context: EngineData["forecast"]["sessionContext"] }) {
  const signedPercent = (value: number | null, digits = 2) =>
    value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
  const ivPoints = context.volatility.riskReversalChange === null
    ? "—"
    : `${context.volatility.riskReversalChange > 0 ? "+" : ""}${(context.volatility.riskReversalChange * 100).toFixed(2)} pts`;
  const eventText = context.event.today.length
    ? context.event.today.join(" · ")
    : context.event.nextSession.length
      ? `${context.event.nextSession.join(" · ")} next session`
      : "No tracked major event";
  const overnight = context.overnight;
  const overnightPoints = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
  const overnightPercent = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  const observedThrough = overnight.observedThrough
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(overnight.observedThrough))
    : "—";

  const inventoryScore = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
  const historyText = overnight.history
    ? `${overnight.history.sessions}/${overnight.history.required} sessions logged`
    : "Session log is starting";

  return (
    <section id="context" className="session-context reveal reveal--2">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Pre-session context · {context.asOf}</p>
          <h2>What is changing around the map?</h2>
        </div>
        <p>Observed inputs only. This panel is context, not a trade instruction.</p>
      </div>
      <div className="session-context-grid">
        <article>
          <span>NQ / ES relative strength</span>
          <strong>{context.relativeStrength.label}</strong>
          <p>{signedPercent(context.relativeStrength.fiveDay)} over five sessions · {signedPercent(context.relativeStrength.oneDay)} yesterday</p>
          <small>{context.relativeStrength.source}</small>
        </article>
        <article>
          <span>Implied move</span>
          <strong>{context.impliedMove.percent === null ? "—" : `±${context.impliedMove.percent.toFixed(2)}%`}</strong>
          <p>{context.impliedMove.points === null ? "Unavailable" : `about ±${context.impliedMove.points.toFixed(0)} index points`} · {context.impliedMove.horizonDays ?? "—"}D</p>
          <small>{context.impliedMove.source}</small>
        </article>
        <article>
          <span>Gamma regime</span>
          <strong>{context.gamma.regime}</strong>
          <p>{context.gamma.nearestLevel} {signedPercent(context.gamma.nearestLevelDistancePercent)} from spot</p>
          <small>Flip {signedPercent(context.gamma.flipDistancePercent)} · call wall {signedPercent(context.gamma.callWallDistancePercent)} · put wall {signedPercent(context.gamma.putWallDistancePercent)}</small>
        </article>
        <article>
          <span>IV / skew change</span>
          <strong>{context.volatility.atmIvChange === null ? "—" : signedPercent(context.volatility.atmIvChange * 100)}</strong>
          <p>ATM IV session change · RR25 {ivPoints}</p>
          <small>Butterfly {context.volatility.butterflyChange === null ? "—" : signedPercent(context.volatility.butterflyChange * 100)}</small>
        </article>
        <article>
          <span>Overnight futures · {overnight.sessionDate}</span>
          <strong>{overnight.status === "unavailable" ? "Unavailable" : `NQ ${overnightPercent(overnight.nq.gapPercent)}`}</strong>
          <p>
            NQ gap {overnightPoints(overnight.nq.gapPoints)} pts · range {overnightPoints(overnight.nq.overnightRangePoints)} pts
            <br />ES gap {overnightPercent(overnight.es.gapPercent)} · range {overnightPoints(overnight.es.overnightRangePoints)} pts
          </p>
          <small>
            {overnight.stale ? "Saved overnight snapshot · refresh failed" : overnight.source}
            {!overnight.stale && ` · ~${overnight.sourceDelayMinutes}m delay`}
            {` · through ${observedThrough}`}
          </small>
        </article>
        <article>
          <span>Overnight auction read</span>
          <strong>{overnight.regime}</strong>
          <p>{overnight.playbook} · NQ inventory {overnight.nq.inventoryLabel} ({inventoryScore(overnight.nq.inventoryScore)})</p>
          <small>
            Structure {overnight.confidence.structuralScore === null ? "—" : `${overnight.confidence.structuralScore}/100`} ({overnight.confidence.structuralLevel}) · direction {overnight.confidence.directionalScore === null ? "—" : `${overnight.confidence.directionalScore}/100`} ({overnight.confidence.directionalLevel})
            <br />{historyText} · hypothesis until validated
          </small>
        </article>
        <article className={context.event.isEventDay || context.event.isNextSessionEvent ? "session-context-event" : undefined}>
          <span>Major-event state</span>
          <strong>{context.event.isEventDay ? "Event day" : context.event.isNextSessionEvent ? "Event next session" : "No major event"}</strong>
          <p>{eventText}</p>
          <small>Tracked: CPI, payrolls, PPI, and scheduled FOMC decisions.</small>
        </article>
      </div>
      {context.unavailable.length > 0 && (
        <p className="session-context-note">
          {context.unavailable.join(" · ")}
        </p>
      )}
    </section>
  );
}

function ScoreTable({ evaluation }: { evaluation: ClassifierEvaluation | null }) {
  if (!evaluation) return null;
  return (
    <article className="score-block">
      <header>
        <h3>{evaluation.question}</h3>
        <span className={`state-label state-label--${evaluation.beatsBaseline ? "constructive" : "stress"}`}>
          {evaluation.beatsBaseline ? "Beats base rate" : "No measured skill"}
        </span>
      </header>
      <table className="score-table">
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Model</th>
            <th scope="col">Base rate</th>
            <th scope="col">Difference</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Log loss <small>lower is better</small></th>
            <td>{evaluation.model.logLoss?.toFixed(4) ?? "—"}</td>
            <td>{evaluation.baseRate.logLoss?.toFixed(4) ?? "—"}</td>
            <td className={(evaluation.skill.logLoss ?? 0) > 0 ? "gain" : "loss"}>
              {signed(evaluation.skill.logLoss, "", 4)}
            </td>
          </tr>
          <tr>
            <th scope="row">
              Log-loss advantage{" "}
              <small>
                Diebold-Mariano, HAC lag {evaluation.comparison?.lag ?? 0}
              </small>
            </th>
            <td colSpan={2}>
              {evaluation.comparison
                ? `${signed(evaluation.comparison.meanAdvantage, "", 4)} ± ${evaluation.comparison.standardError.toFixed(4)}`
                : "—"}
            </td>
            <td className={evaluation.beatsBaseline ? "gain" : "loss"}>
              {evaluation.comparison
                ? `p ${evaluation.comparison.pValue < 0.001 ? "< 0.001" : evaluation.comparison.pValue.toFixed(3)}`
                : "—"}
              {evaluation.falseDiscoveryRate !== null && (
                <small>
                  {" "}q {evaluation.falseDiscoveryRate < 0.001 ? "< 0.001" : evaluation.falseDiscoveryRate.toFixed(3)}
                </small>
              )}
            </td>
          </tr>
          <tr>
            <th scope="row">Brier score <small>lower is better</small></th>
            <td>{evaluation.model.brier?.toFixed(4) ?? "—"}</td>
            <td>{evaluation.baseRate.brier?.toFixed(4) ?? "—"}</td>
            <td className={(evaluation.skill.brier ?? 0) > 0 ? "gain" : "loss"}>
              {signed(evaluation.skill.brier, "", 4)}
            </td>
          </tr>
          <tr>
            <th scope="row">Accuracy</th>
            <td>{percent(evaluation.model.accuracy)}</td>
            <td>{percent(evaluation.baseRate.accuracy)}</td>
            <td className={(evaluation.skill.accuracy ?? 0) > 0 ? "gain" : "loss"}>
              {evaluation.skill.accuracy === null ? "—" : signed(evaluation.skill.accuracy * 100, " pp")}
            </td>
          </tr>
          <tr>
            <th scope="row">Area under ROC <small>0.5 is random</small></th>
            <td>{evaluation.model.auc?.toFixed(3) ?? "—"}</td>
            <td>0.500</td>
            <td className={(evaluation.model.auc ?? 0.5) > 0.5 ? "gain" : "loss"}>
              {evaluation.model.auc === null ? "—" : signed(evaluation.model.auc - 0.5, "", 3)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="calibration-strip" aria-label="Calibration: predicted probability against observed frequency">
        {evaluation.calibration.map((bin) => (
          <div key={bin.lower} className="calibration-bin">
            <div className="calibration-bars">
              <i
                className="calibration-predicted"
                style={{ height: `${(bin.predicted ?? 0) * 100}%` }}
                title={`Predicted ${percent(bin.predicted)}`}
              />
              <i
                className="calibration-observed"
                style={{ height: `${(bin.observed ?? 0) * 100}%` }}
                title={`Observed ${percent(bin.observed)}`}
              />
            </div>
            <span>{(bin.lower * 100).toFixed(1)}–{(bin.upper * 100).toFixed(1)}%</span>
            <small>{bin.count}</small>
          </div>
        ))}
      </div>
      <p className="calibration-note">
        Sessions are split into five equal groups by how strongly the model leaned; the left bar is what it
        predicted, the right bar is what happened. If the right bars rise with the left ones, the ranking
        carries information even when the level is flat. Sessions
        scored {evaluation.from} to {evaluation.to}. On the {evaluation.confident.share.toFixed(0)}% of sessions
        where it moved at least {(evaluation.confident.threshold * 100).toFixed(0)} points from the base rate it
        was right {percent(evaluation.confident.accuracy)} of the time.
      </p>
      {evaluation.comparison && (
        <p className="calibration-note">
          {evaluation.horizon > 1 ? (
            <>
              This question looks {evaluation.horizon} sessions ahead, so consecutive forecasts share all but
              one day of their window and the {evaluation.comparison.samples.toLocaleString()} scored sessions
              carry roughly {evaluation.comparison.effectiveSamples.toLocaleString()} independent
              observations. The verdict above is the log-loss difference divided by a standard error that
              accounts for that overlap, not a comparison of the two numbers.
            </>
          ) : (
            <>
              The verdict above is the log-loss difference divided by its standard error across{" "}
              {evaluation.comparison.samples.toLocaleString()} scored sessions, not a comparison of the two
              numbers: a model can finish a ten-thousandth ahead and have shown nothing.
            </>
          )}{" "}
          q is the p-value after a false-discovery-rate correction across all nine targets, since testing
          nine questions at once is expected to produce a winner or two by chance.
        </p>
      )}
      {evaluation.coefficients.length > 0 && (
        <details className="learn-panel">
          <summary>What the current fit leans on</summary>
          <ul className="coefficient-list">
            {evaluation.coefficients.map((coefficient) => (
              <li key={coefficient.feature}>
                <span>{coefficient.feature}</span>
                <i>
                  <b
                    className={coefficient.weight >= 0 ? "positive" : "negative"}
                    style={{ width: `${Math.min(Math.abs(coefficient.weight) * 200, 100)}%` }}
                  />
                </i>
                <strong>{signed(coefficient.weight, "", 3)}</strong>
              </li>
            ))}
          </ul>
          <p>
            Standardized coefficients from the most recent fit. A near-zero set is the model reporting that it
            found little to lean on.
          </p>
        </details>
      )}
    </article>
  );
}

export function ForecastEngine() {
  const [data, setData] = useState<EngineData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/engine", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "The forecast request failed.");
        return payload as EngineData;
      })
      .then(setData)
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, []);

  const headline = (() => {
    if (!data) return error ? "The forecast is unavailable." : "Fitting the model…";
    const move = data.forecast.expectedMove;
    const direction = data.evaluation.direction;
    if (move === null) return "Waiting for enough sessions.";
    const sizing = move > data.forecast.typicalMove ? "a wider session than usual" : "a quieter session than usual";
    return direction?.beatsBaseline
      ? `${percent(data.forecast.direction.probability)} higher, ${sizing}.`
      : `${sizing}, with no directional edge.`;
  })();

  return (
    <div className="page-shell">
      <OrientationHero
        eyebrow={`Forecast engine · ${data ? `next session ${data.nextSession}` : error ? "unavailable" : "loading"}`}
        question="What is the next session likely to do?"
        answer={headline}
        detail={data
          ? `${data.index}. Every score on this page comes from walk-forward evaluation across ${data.evaluation.sessions.toLocaleString()} sessions since ${data.evaluation.trainingStart}: fit on the past, predict the block that follows, never look back.`
          : error || "Loading the model, its out-of-sample record, and its live log."}
        caveat={data?.caveat ?? "No forecast is shown before the model has been scored against its baseline."}
      />

      <section id="forecast" className="forecast-board reveal reveal--1">
        <ProbabilityCard
          title="Direction"
          question="Will the next session close higher?"
          probability={data?.forecast.direction.probability ?? null}
          baseRate={data?.forecast.direction.baseRate ?? null}
          edge={data?.forecast.direction.edge ?? null}
          evaluation={data?.evaluation.direction ?? null}
        />
        <ProbabilityCard
          title="Behavior"
          question="Will it continue in the same direction as this session?"
          probability={data?.forecast.continuation.probability ?? null}
          baseRate={data?.forecast.continuation.baseRate ?? null}
          edge={data?.forecast.continuation.edge ?? null}
          evaluation={data?.evaluation.continuation ?? null}
        />
        {data?.forecast.recommendedExposure && (
          <article className="card exposure-card">
            <div className="card-header">
              <span className="card-kicker">Vol-Scaled Allocation</span>
              <h3>Recommended Position Exposure</h3>
            </div>
            <div className="probability-display">
              <span className="probability-value">
                {data.forecast.recommendedExposure.positionPct > 0 ? `+${data.forecast.recommendedExposure.positionPct}%` : `${data.forecast.recommendedExposure.positionPct}%`}
              </span>
              <span className="probability-meta">
                {data.forecast.recommendedExposure.exposureLabel}
              </span>
            </div>
            <div className="card-footer">
              <p>Position: <strong>{data.forecast.recommendedExposure.positionPct}%</strong> · Cash: <strong>{data.forecast.recommendedExposure.cashPct}%</strong></p>
              <small>
                {data.forecast.recommendedExposure.basis ??
                  `Scaled inverse to realized vol (${(data.forecast.recommendedExposure.volatilityScale * 100).toFixed(1)}% annualized).`}
                {data.forecast.recommendedExposure.hasMeasuredEdge &&
                  ` Scaled inverse to realized vol (${(data.forecast.recommendedExposure.volatilityScale * 100).toFixed(1)}% annualized).`}
              </small>
            </div>
          </article>
        )}
        {data && <RangeBar forecast={data.forecast} />}
        {data?.forecast.moveMap && <MoveMapPanel moveMap={data.forecast.moveMap} />}
      </section>

      {data?.forecast.sessionCharacter && (
        <SessionCharacter
          character={data.forecast.sessionCharacter}
          session={data.nextSession}
        />
      )}

      {data?.forecast.sessionContext && <SessionContextPanel context={data.forecast.sessionContext} />}

      {data?.evaluation.volatility && (
        <section id="move-size" className="volatility-scorecard reveal reveal--2">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Where the model actually works</p>
              <h2>Size of move, scored against two baselines</h2>
            </div>
            <p>{data.evaluation.volatility.samples.toLocaleString()} out-of-sample sessions, {data.evaluation.volatility.from} to {data.evaluation.volatility.to}.</p>
          </div>
          <div className="baseline-grid">
            <article>
              <span>Model</span>
              <strong>{data.evaluation.volatility.rSquared?.toFixed(3) ?? "—"}</strong>
              <p>R², variance of the next move explained</p>
              <small>Mean absolute error {data.evaluation.volatility.meanAbsoluteError.toFixed(3)} pp</small>
            </article>
            <article>
              <span>20-session average</span>
              <strong>{data.evaluation.volatility.trailingAverageRSquared?.toFixed(3) ?? "—"}</strong>
              <p>The baseline worth beating</p>
              <small>Mean absolute error {data.evaluation.volatility.trailingAverageError.toFixed(3)} pp</small>
            </article>
            <article>
              <span>Yesterday&rsquo;s move</span>
              <strong>{data.evaluation.volatility.randomWalkRSquared?.toFixed(3) ?? "—"}</strong>
              <p>A single noisy session as the forecast</p>
              <small>Mean absolute error {data.evaluation.volatility.randomWalkError.toFixed(3)} pp</small>
            </article>
          </div>
        </section>
      )}

      <section id="scoring" className="score-section reveal reveal--2">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Out-of-sample record</p>
            <h2>Does it beat doing nothing?</h2>
          </div>
          <p>The base rate — always predicting the historical frequency — is the honest thing to beat.</p>
        </div>
        <div className="score-grid">
          <ScoreTable evaluation={data?.evaluation.direction ?? null} />
          <ScoreTable evaluation={data?.evaluation.continuation ?? null} />
          {data?.evaluation.direction5d && <ScoreTable evaluation={data.evaluation.direction5d} />}
          {data?.evaluation.direction20d && <ScoreTable evaluation={data.evaluation.direction20d} />}
          {data?.evaluation.volatilityExpansion && <ScoreTable evaluation={data.evaluation.volatilityExpansion} />}
          {data?.evaluation.wideRangeDay && <ScoreTable evaluation={data.evaluation.wideRangeDay} />}
          {data?.evaluation.rallySpike5d && <ScoreTable evaluation={data.evaluation.rallySpike5d} />}
          {data?.evaluation.downsideTail && <ScoreTable evaluation={data.evaluation.downsideTail} />}
          {data?.evaluation.drawdown5d && <ScoreTable evaluation={data.evaluation.drawdown5d} />}
        </div>
        {!data && <div className="macro-loading">{error || "Fitting and scoring the model…"}</div>}
      </section>

      {data && (
        <section id="states" className="states-section reveal reveal--3">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Conditional base rates · descriptive</p>
              <h2>Where direction is less of a coin flip</h2>
            </div>
            <p>Up-session frequency in each state against the {data.evaluation.states.overall.toFixed(1)}% unconditional rate.</p>
          </div>
          <div className="states-table-wrapper">
            <table className="states-table">
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th scope="col">Sessions</th>
                  <th scope="col">Higher next</th>
                  <th scope="col">Edge</th>
                  <th scope="col">Mean return</th>
                  <th scope="col">Standard errors</th>
                </tr>
              </thead>
              <tbody>
                {data.evaluation.states.rows.map((row) => (
                  <tr key={row.label} className={row.notable ? "states-row--notable" : undefined}>
                    <th scope="row">
                      {row.label}
                      <small>{row.note}</small>
                    </th>
                    <td>{row.samples.toLocaleString()}</td>
                    <td>{row.upRate.toFixed(1)}%</td>
                    <td className={row.edge >= 0 ? "gain" : "loss"}>{signed(row.edge, " pp", 1)}</td>
                    <td className={row.meanReturn >= 0 ? "gain" : "loss"}>{signed(row.meanReturn, "%", 2)}</td>
                    <td>{signed(row.zScore, "σ", 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="states-caveat">{data.evaluation.states.caveat}</p>
        </section>
      )}

      {data && (
        <section id="recorder" className="recorder-panel reveal reveal--3">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Positioning recorder · {data.positioning.status}</p>
              <h2>Building the history that cannot be downloaded</h2>
            </div>
            <p>
              {data.positioning.intraday.effectiveObservations} of {data.positioning.required} effective
              observations.
              {data.positioning.intraday.sessionsRemaining === null
                ? " No estimate until a full session has been sampled at the intended rate."
                : ` About ${data.positioning.intraday.sessionsRemaining} trading sessions to go at the current rate.`}
            </p>
          </div>
          <div className="recorder-progress" aria-label="Recorded observations against the minimum the model needs">
            <i
              style={{
                width: `${Math.min(
                  (data.positioning.intraday.effectiveObservations / data.positioning.required) * 100,
                  100,
                )}%`,
              }}
            />
          </div>
          <dl className="recorder-stats">
            <div>
              <dt>Intraday snapshots</dt>
              <dd>{data.positioning.intraday.observations.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Per session</dt>
              <dd>{data.positioning.intraday.observationsPerSession}</dd>
            </div>
            <div>
              <dt>Effective, after clustering</dt>
              <dd>
                {data.positioning.intraday.effectiveObservations.toLocaleString()}
                <small> ÷{data.positioning.intraday.clusterSize}</small>
              </dd>
            </div>
            <div>
              <dt>Settled daily readings</dt>
              <dd>{data.positioning.sessions}</dd>
            </div>
          </dl>
          <div className="recorder-grid">
            <div>
              <h3>What is being recorded</h3>
              {data.positioning.latestReadings.length ? (
                <ul className="recorder-readings">
                  {data.positioning.latestReadings.map((reading) => (
                    <li key={reading.feature}>
                      <span>{reading.feature.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                      <strong>
                        {Math.abs(reading.value) >= 1000
                          ? reading.value.toExponential(2)
                          : reading.value.toFixed(3)}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="event-empty">
                  Nothing recorded yet. The first row is written the next time a settled option snapshot is
                  loaded.
                </p>
              )}
            </div>
            <div>
              <h3>Coverage</h3>
              {data.positioning.coverage.length ? (
                <ul className="recorder-coverage">
                  {data.positioning.coverage.map((entry) => (
                    <li key={entry.symbol}>
                      <strong>{entry.symbol}</strong>
                      <span>{entry.sessions} sessions · {entry.features} features</span>
                      <em>{entry.firstDate} → {entry.lastDate}</em>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="event-empty">No symbol has recorded a session yet.</p>
              )}
              <p className="states-caveat">{data.positioning.reason}</p>
              <p className="states-caveat">{data.positioning.intraday.reason}</p>
            </div>
          </div>
        </section>
      )}

      {data && (
        <section id="log" className="live-log reveal reveal--3">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Live record · {data.modelVersion}</p>
              <h2>Forecasts made before the session, scored after</h2>
            </div>
            <p>
              {data.live.settled
                ? `${data.live.settled} settled · ${data.live.accuracy?.toFixed(1)}% correct so far`
                : "No forecast has settled yet."}
            </p>
          </div>
          {data.live.records.length > 0 ? (
            <ul className="live-list">
              {data.live.records.map((record) => (
                <li key={`${record.targetDate}-${record.target}`}>
                  <time dateTime={record.targetDate}>{shortDate(record.targetDate)}</time>
                  <span>{record.target}</span>
                  <strong>{percent(record.probability)}</strong>
                  <em>{record.realized === null ? "pending" : signed(record.realized, "%")}</em>
                  <i className={`live-mark live-mark--${record.correct === null ? "pending" : record.correct ? "hit" : "miss"}`}>
                    {record.correct === null ? "—" : record.correct ? "hit" : "miss"}
                  </i>
                </li>
              ))}
            </ul>
          ) : (
            <p className="event-empty">The first forecast was recorded today; nothing has settled yet.</p>
          )}
          <p className="states-caveat">{data.live.reason}</p>
        </section>
      )}

      <div className="macro-source-line">
        <span><i />{data ? (data.stale ? "Saved forecast snapshot" : "Model fitted") : error ? "Model unavailable" : "Fitting"}</span>
        <span>
          {data
            ? `${data.evaluation.featureCount} features · walk-forward refit every ${data.evaluation.window.refitEvery} sessions with a ${data.evaluation.window.embargo}-session embargo`
            : error || "Reading cached observations"}
        </span>
        <span>{data ? `${data.modelVersion} · ${new Date(data.fetchedAt).toLocaleString()}` : "No prediction is shown before it is scored"}</span>
      </div>
    </div>
  );
}
