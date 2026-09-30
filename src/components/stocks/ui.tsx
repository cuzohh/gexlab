"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { pct, tone as toneOf, type Tone } from "@/components/stocks/format";

/**
 * The pieces every panel in the equity workspace is built from.
 *
 * The workspace previously wrote its own markup at each site, which is how two
 * adjacent panels ended up with different label sizes, and how a stat block and
 * a table row disagreed about what a missing value looks like. These are the
 * only shapes; a panel composes them.
 */

/* ------------------------------------------------------------------ panels */

export function Panel({
  title,
  meta,
  caption,
  children,
  id,
  span,
}: {
  title: string;
  /** Right-aligned status: a source, a date, a freshness marker. One line. */
  meta?: ReactNode;
  /** One sentence of context, at most. Longer prose belongs in a disclosure. */
  caption?: string;
  children: ReactNode;
  id?: string;
  span?: "full" | "half";
}) {
  return (
    <section className={`sw-panel${span === "full" ? " sw-panel--full" : ""}`} id={id}>
      <header className="sw-panel__head">
        <h2>{title}</h2>
        {meta ? <div className="sw-panel__meta">{meta}</div> : null}
      </header>
      {caption ? <p className="sw-panel__caption">{caption}</p> : null}
      <div className="sw-panel__body">{children}</div>
    </section>
  );
}

/** A short attribution or caveat, set apart from the data it describes. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="sw-note">{children}</p>;
}

/** What a panel shows when the source returned nothing. Never a zero. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="sw-empty">{children}</p>;
}

/* ------------------------------------------------------------------ change */

/** The number inside a formatted value: "$305.98" and "-2.4%" both parse. */
function numericOf(value: string) {
  const cleaned = value.replace(/[^\d.\-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A class that marks a figure as having just changed, for about a second.
 *
 * The refresh replaces the numbers in place rather than reloading anything, and
 * a page of figures that silently becomes a different page of figures gives the
 * reader nothing to look at: the two most useful things to know after asking
 * for fresh data are which values moved and which way. The direction is taken
 * from the values themselves, so a figure that is not a number — a rating, a
 * date — still flashes, just without a colour.
 *
 * Nothing flashes on first render. Mounting is not a change.
 */
export function useValueFlash(value: string) {
  const previous = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | "neutral" | null>(null);

  useEffect(() => {
    if (previous.current === value) return;
    const before = numericOf(previous.current);
    const after = numericOf(value);
    previous.current = value;
    setFlash(before === null || after === null || before === after ? "neutral" : after > before ? "up" : "down");
    const timer = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(timer);
  }, [value]);

  return flash ? ` is-flash-${flash}` : "";
}

/* ------------------------------------------------------------------- stats */

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: Tone;
}) {
  const flash = useValueFlash(value);
  return (
    <article className="sw-stat">
      <span className="sw-stat__label">{label}</span>
      <strong className={`sw-stat__value${tone && tone !== "flat" ? ` is-${tone}` : ""}${flash}`}>{value}</strong>
      {note ? <small className="sw-stat__note">{note}</small> : null}
    </article>
  );
}

export function StatGrid({ columns = 4, children }: { columns?: 2 | 3 | 4 | 6; children: ReactNode }) {
  return <div className={`sw-stat-grid sw-stat-grid--${columns}`}>{children}</div>;
}

/** A label/value pair on one line, for dense reference lists. */
export function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  const flash = useValueFlash(value);
  return (
    <div className="sw-row">
      <span className="sw-row__label">{label}</span>
      <strong className={`sw-row__value${flash}`}>{value}</strong>
      {note ? <small className="sw-row__note">{note}</small> : null}
    </div>
  );
}

/* ------------------------------------------------------------- indications */

/** A signed change, coloured by direction. */
export function Delta({ value, digits = 1 }: { value: number | null; digits?: number }) {
  const direction = toneOf(value);
  return <b className={`sw-delta is-${direction}`}>{pct(value, digits)}</b>;
}

/** A short status word: a research state, a flow intent, a freshness marker. */
export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "up" | "down" | "warn" | "quiet" }) {
  return <span className={`sw-chip sw-chip--${tone}`}>{children}</span>;
}

/**
 * A horizontal proportion, 0–1.
 *
 * The width is the whole message, so the track is always drawn even when the
 * value is unavailable — an absent bar and a zero-length bar would otherwise
 * look identical.
 */
export function Meter({ value, tone = "neutral", label }: { value: number | null; tone?: "neutral" | "up" | "down"; label?: string }) {
  const width = value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`sw-meter sw-meter--${tone}`} role="img" aria-label={label ?? (width === null ? "unavailable" : `${Math.round(width)} percent`)}>
      {width === null ? null : <i style={{ width: `${width}%` }} />}
    </div>
  );
}

/**
 * A position marker on a low–high range.
 *
 * Used for the 52-week band and the analyst target range, both of which are
 * "where does today sit between two ends" questions.
 */
export function RangeBar({
  low,
  high,
  markers,
}: {
  low: number | null;
  high: number | null;
  markers: { value: number | null; label: string; kind: "current" | "reference" | "band" }[];
}) {
  const span = low !== null && high !== null ? Math.max(high - low, Number.EPSILON) : null;
  const at = (value: number | null) =>
    span === null || low === null || value === null || !Number.isFinite(value)
      ? null
      : Math.max(0, Math.min(100, ((value - low) / span) * 100));
  return (
    <div className="sw-range">
      <div className="sw-range__track">
        {markers.map((marker) => {
          const left = at(marker.value);
          if (left === null) return null;
          return <b key={marker.label} className={`sw-range__mark sw-range__mark--${marker.kind}`} style={{ left: `${left}%` }} title={`${marker.label} ${marker.value}`} />;
        })}
      </div>
    </div>
  );
}

/**
 * A signed value drawn either side of a shared zero.
 *
 * A column of percentages tells you the order only after you read every one of
 * them. A bar hanging off a common centre line tells you the order, the sign,
 * and the relative size at a glance, which is the whole reason to have a table
 * of moves rather than a list of them.
 */
export function DivergingBar({ value, scale, label }: { value: number | null; scale: number; label?: string }) {
  const usable = value !== null && Number.isFinite(value) && scale > 0;
  const magnitude = usable ? Math.min(1, Math.abs(value) / scale) : 0;
  const positive = usable && value > 0;
  return (
    <span className="sw-diverge" role="img" aria-label={label ?? (usable ? `${value.toFixed(1)} percent` : "unavailable")}>
      <i className="sw-diverge__axis" />
      {usable && magnitude > 0 ? (
        <i
          className={`sw-diverge__bar is-${positive ? "up" : "down"}`}
          style={{ width: `${magnitude * 50}%`, [positive ? "left" : "right"]: "50%" } as React.CSSProperties}
        />
      ) : null}
    </span>
  );
}

/** Advancing versus declining, as one bar. */
export function BreadthBar({ up, down, label }: { up: number; down: number; label?: string }) {
  const total = up + down;
  if (!total) return <div className="sw-breadth sw-breadth--empty" />;
  return (
    <div className="sw-breadth" role="img" aria-label={label ?? `${up} advancing, ${down} declining`}>
      <i className="is-up" style={{ width: `${(up / total) * 100}%` }} />
      <i className="is-down" style={{ width: `${(down / total) * 100}%` }} />
    </div>
  );
}

/* -------------------------------------------------------------- sparklines */

/**
 * A closing-price trace.
 *
 * The previous version stretched a 100×34 viewBox across whatever width it
 * landed in with `preserveAspectRatio="none"`. That scales x and y by different
 * factors, which turned the end-of-series dot into a wide ellipse — the stray
 * pill floating beside the detail chart — and made the line's slope meaningless
 * because the horizontal scale changed with the container. This draws into a
 * fixed pixel viewBox at the aspect it is displayed at, keeps the stroke width
 * constant with `vector-effect`, and drops non-finite closes rather than
 * emitting `NaN` into the points list, which is what broke the path into
 * disconnected fragments.
 */
export function Sparkline({
  history,
  label,
  width = 160,
  height = 34,
  area = false,
}: {
  history: { close: number }[];
  label: string;
  width?: number;
  height?: number;
  area?: boolean;
}) {
  const values = history.map((row) => row.close).filter((value) => Number.isFinite(value));
  if (values.length < 2) return <span className="sw-spark sw-spark--empty" aria-label={`${label} price trace unavailable`} />;

  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(high - low, Number.EPSILON);
  const pad = 2;
  const plotHeight = height - pad * 2;
  const x = (index: number) => (index / (values.length - 1)) * width;
  const y = (value: number) => pad + (1 - (value - low) / range) * plotHeight;

  const points = values.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`);
  const rising = values[values.length - 1] >= values[0];

  return (
    <svg
      className={`sw-spark is-${rising ? "up" : "down"}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${label} price trace, ${rising ? "up" : "down"} over the period`}
    >
      {area ? (
        <polygon className="sw-spark__area" points={`0,${height} ${points.join(" ")} ${width},${height}`} />
      ) : null}
      <polyline className="sw-spark__line" points={points.join(" ")} vectorEffect="non-scaling-stroke" />
      <circle className="sw-spark__tip" cx={width} cy={y(values[values.length - 1])} r={1.8} />
    </svg>
  );
}

/** A column of reported values over time, signed. */
export function BarSeries({ values, label }: { values: number[]; label: string }) {
  if (!values.length) return <Empty>No comparable history.</Empty>;
  const scale = Math.max(...values.map((value) => Math.abs(value)), Number.EPSILON);
  return (
    <div className="sw-bars" role="img" aria-label={label}>
      {values.map((value, index) => (
        <i
          key={index}
          className={value >= 0 ? "is-up" : "is-down"}
          style={{ height: `${Math.max(8, (Math.abs(value) / scale) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- skeletons */

/**
 * Placeholder shaped like the content it stands in for.
 *
 * A cold visit populates ten years of daily bars and a full XBRL fact set, and
 * that took the better part of a minute against a page that showed one line of
 * text the whole time. Holding the final layout while the data lands is the
 * difference between slow and broken.
 */
export function Skeleton({ rows = 1, width }: { rows?: number; width?: string }) {
  return (
    <div className="sw-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <i key={index} style={width ? { width } : undefined} />
      ))}
    </div>
  );
}

export function SkeletonStats({ columns = 4 }: { columns?: 2 | 3 | 4 | 6 }) {
  return (
    <div className={`sw-stat-grid sw-stat-grid--${columns}`} aria-hidden="true">
      {Array.from({ length: columns }, (_, index) => (
        <article className="sw-stat" key={index}>
          <span className="sw-stat__label"><Skeleton width="4rem" /></span>
          <strong className="sw-stat__value"><Skeleton width="3.5rem" /></strong>
        </article>
      ))}
    </div>
  );
}
