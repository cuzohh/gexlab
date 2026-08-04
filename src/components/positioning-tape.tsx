"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

type Observation = {
  time: string;
  sessionDate: string;
  spot: number | null;
  netGamma: number | null;
  flipDistancePercent: number | null;
  callWallDistancePercent: number | null;
  putWallDistancePercent: number | null;
  frontAtmIv: number | null;
};

type PositioningHistory = {
  symbol: string;
  observations: Observation[];
  sessions: number;
  observationCount: number;
  intraday: boolean;
  note: string;
};

const width = 920;
const height = 190;
const padX = 26;
const padY = 20;

function compact(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (magnitude >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

function shortTime(iso: string, intraday: boolean) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.valueOf())) return iso.slice(0, 10);
  return parsed.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    ...(intraday ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

/**
 * The recorded path of dealer positioning.
 *
 * Every other series on this site can be refetched from a public archive if it
 * is lost. This one cannot: no public source carries a past option chain, so
 * the only way to have a history of where the gamma flip sat is to have been
 * running when it sat there. The chart is therefore drawn from whatever was
 * captured rather than from a fixed window, and it says how much that is.
 */
export function PositioningTape({ symbol }: { symbol: string }) {
  const reducedMotion = useReducedMotion();
  // The loaded symbol travels with the result rather than being cleared by the
  // effect that starts the fetch. Switching books then reads as loading because
  // what is held is for the previous book, with no state written during render.
  const [loaded, setLoaded] = useState<{
    symbol: string;
    history: PositioningHistory | null;
    error: string | null;
  } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/positioning/${symbol}`)
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        setLoaded(
          payload.error
            ? { symbol, history: null, error: payload.error }
            : { symbol, history: payload, error: null },
        );
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setLoaded({
          symbol,
          history: null,
          error: reason instanceof Error ? reason.message : "Unavailable",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Clip paths live in the document, so two books rendered at once must not
  // share ids.
  const clipPrefix = `positioning-${symbol.toLowerCase()}`;
  const current = loaded?.symbol === symbol ? loaded : null;
  const history = current?.history ?? null;
  const error = current?.error ?? null;

  const plot = useMemo(() => {
    const rows = (history?.observations ?? []).filter((row) => row.netGamma !== null);
    if (rows.length < 2) return null;
    const values = rows.map((row) => row.netGamma as number);
    const peak = Math.max(...values.map(Math.abs), 1);
    // Zero-centred, because the sign is the regime: above the line dealers are
    // long gamma and hedging damps price, below it hedging amplifies.
    const x = (index: number) => padX + (index / (rows.length - 1)) * (width - padX * 2);
    const y = (value: number) => height / 2 - (value / peak) * (height / 2 - padY);
    const line = rows.map((row, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(row.netGamma as number).toFixed(1)}`).join(" ");
    const area = `${line} L${x(rows.length - 1).toFixed(1)},${height / 2} L${padX.toFixed(1)},${height / 2} Z`;
    return { rows, peak, x, y, line, area };
  }, [history]);

  if (error) {
    return (
      <section className="positioning-tape positioning-tape--empty">
        <p className="section-kicker">Recorded positioning</p>
        <p>{error}</p>
      </section>
    );
  }

  if (!history) {
    return (
      <section className="positioning-tape positioning-tape--empty">
        <p className="section-kicker">Recorded positioning</p>
        <p>Reading the recorded history…</p>
      </section>
    );
  }

  const latest = history.observations.at(-1) ?? null;
  const previous = history.observations.at(-2) ?? null;
  const hovered = hover === null ? null : plot?.rows[hover] ?? null;
  const shown = hovered ?? latest;

  const delta = (key: keyof Observation) => {
    const now = shown?.[key];
    const before = previous?.[key];
    if (typeof now !== "number" || typeof before !== "number") return null;
    return now - before;
  };

  const gammaDelta = delta("netGamma");

  return (
    <section className="positioning-tape">
      <header className="positioning-tape-head">
        <div>
          <p className="section-kicker">Recorded positioning</p>
          <h2>How this book got here</h2>
        </div>
        <p className="positioning-tape-coverage">
          <strong>{history.observationCount}</strong>
          {history.observationCount === 1 ? " reading" : " readings"} across{" "}
          <strong>{history.sessions}</strong>
          {history.sessions === 1 ? " session" : " sessions"}
          <span>
            {history.intraday
              ? "Intraday resolution"
              : "One reading per session · poll during market hours for intraday detail"}
          </span>
        </p>
      </header>

      {plot ? (
        <>
          <svg
            className="positioning-tape-svg"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Recorded net gamma for ${symbol} across ${history.sessions} sessions`}
            onPointerLeave={() => setHover(null)}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const pointer = ((event.clientX - bounds.left) / bounds.width) * width;
              const position = Math.max(0, Math.min(1, (pointer - padX) / (width - padX * 2)));
              setHover(Math.round(position * (plot.rows.length - 1)));
            }}
          >
            <title>Recorded net gamma over the captured sessions</title>
            <line
              className="positioning-zero"
              x1={padX}
              x2={width - padX}
              y1={height / 2}
              y2={height / 2}
            />
            {/* Split at the zero line rather than coloured by the latest
                reading. Keyed to the last value, a week spent deeply short
                gamma painted entirely green because the final session crossed
                back over — which inverts the one thing the chart is for. Each
                half is clipped to its own side of zero, the same construction
                the exposure spine uses. */}
            <defs>
              <clipPath id={`${clipPrefix}-long`}>
                <rect x="0" y="0" width={width} height={height / 2} />
              </clipPath>
              <clipPath id={`${clipPrefix}-short`}>
                <rect x="0" y={height / 2} width={width} height={height / 2} />
              </clipPath>
            </defs>
            {(["long", "short"] as const).map((side, index) => (
              <motion.path
                key={`area-${side}`}
                className={`positioning-area positioning-area--${side}`}
                d={plot.area}
                clipPath={`url(#${clipPrefix}-${side})`}
                initial={reducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 0.14 }}
                transition={{ duration: reducedMotion ? 0 : 0.4, delay: reducedMotion ? 0 : index * 0.05 }}
              />
            ))}
            {(["long", "short"] as const).map((side) => (
              <motion.path
                key={`line-${side}`}
                className={`positioning-line positioning-line--${side}`}
                d={plot.line}
                clipPath={`url(#${clipPrefix}-${side})`}
                initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: reducedMotion ? 0 : 0.7, ease: [0.16, 1, 0.3, 1] }}
              />
            ))}
            {plot.rows.map((row, index) => (
              <circle
                key={row.time}
                className="positioning-node"
                cx={plot.x(index)}
                cy={plot.y(row.netGamma as number)}
                r={hover === index ? 4 : 2.4}
              />
            ))}
            {hover !== null && plot.rows[hover] ? (
              <line
                className="positioning-crosshair"
                x1={plot.x(hover)}
                x2={plot.x(hover)}
                y1={padY}
                y2={height - padY}
              />
            ) : null}
            <text className="positioning-axis-label" x={padX} y={height - 4}>
              {shortTime(plot.rows[0].time, history.intraday)}
            </text>
            <text className="positioning-axis-label" x={width - padX} y={height - 4} textAnchor="end">
              {shortTime(plot.rows.at(-1)!.time, history.intraday)}
            </text>
          </svg>

          <dl className="positioning-tape-readout">
            <div>
              <dt>{hovered ? shortTime(hovered.time, history.intraday) : "Latest"} net gamma</dt>
              <dd className={(shown?.netGamma ?? 0) >= 0 ? "positive" : "negative"}>
                {shown?.netGamma === null || shown?.netGamma === undefined
                  ? "—"
                  : compact(shown.netGamma)}
              </dd>
            </div>
            <div>
              <dt>Change on the reading before</dt>
              <dd className={gammaDelta === null ? "" : gammaDelta >= 0 ? "positive" : "negative"}>
                {gammaDelta === null ? "—" : `${gammaDelta >= 0 ? "+" : ""}${compact(gammaDelta)}`}
              </dd>
            </div>
            <div>
              <dt>Spot to gamma flip</dt>
              <dd>
                {shown?.flipDistancePercent === null || shown?.flipDistancePercent === undefined
                  ? "—"
                  : `${shown.flipDistancePercent >= 0 ? "+" : ""}${shown.flipDistancePercent.toFixed(2)}%`}
              </dd>
            </div>
            <div>
              <dt>Call wall · put wall</dt>
              <dd>
                {shown?.callWallDistancePercent === null || shown?.callWallDistancePercent === undefined
                  ? "—"
                  : `+${shown.callWallDistancePercent.toFixed(2)}%`}
                {" · "}
                {shown?.putWallDistancePercent === null || shown?.putWallDistancePercent === undefined
                  ? "—"
                  : `${shown.putWallDistancePercent.toFixed(2)}%`}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="positioning-tape-thin">
          {history.observationCount === 0
            ? "Nothing recorded yet. Each snapshot this workspace loads writes one reading, so the chart fills in as the desk is used."
            : "One reading recorded so far. A second is needed before there is a path to draw."}
        </p>
      )}

      <p className="positioning-tape-note">{history.note}</p>
    </section>
  );
}
