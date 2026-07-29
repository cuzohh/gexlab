"use client";

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
    recommendedExposure?: {
      positionPct: number;
      cashPct: number;
      exposureLabel: string;
      basis?: string;
      hasMeasuredEdge?: boolean;
      volatilityScale: number;
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
        <i className="range-outer" style={{ left: "0%", width: "100%" }} />
        {range.low50 !== null && range.high50 !== null && (
          <i
            className="range-inner"
            style={{ left: `${position(range.low50)}%`, width: `${position(range.high50) - position(range.low50)}%` }}
          />
        )}
        <i className="range-zero" style={{ left: `${position(0)}%` }} />
        {range.median !== null && <b className="range-median" style={{ left: `${position(range.median)}%` }} />}
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
        <dl style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px dashed var(--border-subtle, rgba(255,255,255,0.1))" }}>
          <div>
            <dt>Exact Index Median Target</dt>
            <dd><strong>${forecast.dollarRange.medianPrice?.toLocaleString()}</strong></dd>
          </div>
          <div>
            <dt>90% Dollar Bounds (p05 - p95)</dt>
            <dd>
              ${forecast.dollarRange.low95Price?.toLocaleString()} – ${forecast.dollarRange.high95Price?.toLocaleString()}
            </dd>
          </div>
        </dl>
      )}
    </article>
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

      <section className="forecast-board reveal reveal--1">
        <ProbabilityCard
          title="Direction"
          question="Will the next session close higher?"
          probability={data?.forecast.direction.probability ?? null}
          baseRate={data?.forecast.direction.baseRate ?? null}
          edge={data?.forecast.direction.edge ?? null}
          evaluation={data?.evaluation.direction ?? null}
        />
        <ProbabilityCard
          title="Behaviour"
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
                  `Scaled inverse to realized vol (${(data.forecast.recommendedExposure.volatilityScale * 100).toFixed(1)}% annualised).`}
                {data.forecast.recommendedExposure.hasMeasuredEdge &&
                  ` Scaled inverse to realized vol (${(data.forecast.recommendedExposure.volatilityScale * 100).toFixed(1)}% annualised).`}
              </small>
            </div>
          </article>
        )}
        {data && <RangeBar forecast={data.forecast} />}
      </section>

      {data?.evaluation.volatility && (
        <section className="volatility-scorecard reveal reveal--2">
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

      <section className="score-section reveal reveal--2">
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
        <section className="states-section reveal reveal--3">
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
        <section className="recorder-panel reveal reveal--3">
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
        <section className="live-log reveal reveal--3">
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
