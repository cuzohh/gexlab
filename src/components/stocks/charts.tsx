"use client";

import { useId } from "react";
import { money, usd, type Tone } from "@/components/stocks/format";
import type { OptionBridgeData, StockData } from "@/components/stocks/types";

/**
 * Charts for the equity workspace.
 *
 * Every one of these draws data the routes already returned and the interface
 * previously threw away: the per-strike book, the volatility surface, and the
 * daily closes behind the moving averages. They are plain SVG at a fixed
 * viewBox scaled to the container, so there is no charting dependency and no
 * layout measurement on the client.
 *
 * `preserveAspectRatio` is left at its default. The first version of the price
 * trace on this page set it to `none`, which scales x and y by different
 * factors — the line's slope then meant nothing and round markers came out as
 * ellipses.
 */

const AXIS = "var(--rule-strong)";

function niceTicks(low: number, high: number, count = 4) {
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return [];
  const raw = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => m >= raw) ?? magnitude * 10;
  const start = Math.ceil(low / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= high + step * 0.001; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

/* ============================================================ price history */

/**
 * Ninety sessions of closes with the moving averages that are quoted beside it.
 *
 * The averages are drawn rather than listed because the question they answer —
 * is price above or below them, and by how much — is a shape, not three
 * numbers.
 */
export function PriceChart({ stock, height = 220 }: { stock: StockData; height?: number }) {
  const clipId = useId();
  const closes = stock.priceHistory.filter((row) => Number.isFinite(row.close));
  if (closes.length < 2) return <p className="sw-empty">No price history is available.</p>;

  const width = 760;
  const padLeft = 4;
  const padRight = 54;
  const padTop = 10;
  const padBottom = 20;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const values = closes.map((row) => row.close);
  const { sma20, sma50, sma200 } = stock.technicals;
  const overlays = [
    { value: sma20, label: "20", key: "sma20" },
    { value: sma50, label: "50", key: "sma50" },
    { value: sma200, label: "200", key: "sma200" },
  ].filter((row): row is { value: number; label: string; key: string } => row.value !== null && Number.isFinite(row.value));

  // The averages share the axis, so a 200-day average far below a 90-day window
  // would otherwise compress the price line into a band a few pixels tall.
  const lowRaw = Math.min(...values, ...overlays.map((row) => row.value));
  const highRaw = Math.max(...values, ...overlays.map((row) => row.value));
  const margin = (highRaw - lowRaw) * 0.08 || 1;
  const low = lowRaw - margin;
  const high = highRaw + margin;

  const x = (index: number) => padLeft + (index / (values.length - 1)) * plotWidth;
  const y = (value: number) => padTop + (1 - (value - low) / (high - low)) * plotHeight;

  const line = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const rising = values[values.length - 1] >= values[0];
  const ticks = niceTicks(low, high);

  return (
    <figure className="sw-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${stock.symbol} closing prices over ${values.length} sessions`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={padLeft} y={padTop} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line className="sw-chart__grid" x1={padLeft} x2={padLeft + plotWidth} y1={y(tick)} y2={y(tick)} />
            <text className="sw-chart__tick" x={padLeft + plotWidth + 6} y={y(tick) + 3}>{usd(tick)}</text>
          </g>
        ))}

        {/* Averages often sit within a few dollars of each other, which put the
            labels on top of one another. Each label is nudged right of the last
            one it would have collided with. */}
        {(() => {
          const placed: { y: number; x: number }[] = [];
          return overlays.map((row) => {
            const at = y(row.value);
            let labelX = padLeft + 3;
            while (placed.some((prior) => Math.abs(prior.y - at) < 11 && Math.abs(prior.x - labelX) < 26)) labelX += 26;
            placed.push({ y: at, x: labelX });
            return (
              <g key={row.key}>
                <line className={`sw-chart__sma sw-chart__sma--${row.key}`} x1={padLeft} x2={padLeft + plotWidth} y1={at} y2={at} />
                <text className="sw-chart__smaLabel" x={labelX} y={at - 3}>{row.label}d</text>
              </g>
            );
          });
        })()}

        <g clipPath={`url(#${clipId})`}>
          <polygon
            className={`sw-chart__area is-${rising ? "up" : "down"}`}
            points={`${padLeft},${padTop + plotHeight} ${line} ${padLeft + plotWidth},${padTop + plotHeight}`}
          />
          <polyline className={`sw-chart__line is-${rising ? "up" : "down"}`} points={line} vectorEffect="non-scaling-stroke" />
        </g>

        <circle className={`sw-chart__tip is-${rising ? "up" : "down"}`} cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={3} />

        <line className="sw-chart__axis" x1={padLeft} x2={padLeft + plotWidth} y1={padTop + plotHeight} y2={padTop + plotHeight} stroke={AXIS} />
        <text className="sw-chart__tick" x={padLeft} y={height - 6}>{closes[0].date}</text>
        <text className="sw-chart__tick sw-chart__tick--end" x={padLeft + plotWidth} y={height - 6}>{closes[closes.length - 1].date}</text>
      </svg>
    </figure>
  );
}

/* ============================================================ strike ladder */

/**
 * The option book by strike, as back-to-back volume with the gamma profile.
 *
 * This is the picture the workspace was missing entirely. The route already
 * returned per-strike call volume, put volume, gamma and delta; the interface
 * showed four wall prices as text and discarded the rest. Puts run left of the
 * axis and calls run right, so the side carrying the size is visible without
 * reading a number, and spot sits on the same axis as the walls it is being
 * compared against.
 */
export function StrikeLadder({
  options,
  spot,
  rows = 15,
}: {
  options: OptionBridgeData;
  spot: number | null;
  rows?: number;
}) {
  const all = options.strikes.filter((row) => Number.isFinite(row.strike));
  if (!all.length) return <p className="sw-empty">The snapshot contains no per-strike detail.</p>;

  const centre = spot ?? options.spot;
  // A full chain runs to hundreds of strikes, nearly all of them empty. Only
  // the strikes nearest spot carry information about where price is pinned.
  const near = [...all]
    .sort((a, b) => Math.abs(a.strike - centre) - Math.abs(b.strike - centre))
    .slice(0, rows)
    .sort((a, b) => b.strike - a.strike);

  const width = 760;
  const rowHeight = 19;
  const padTop = 22;
  const padBottom = 14;
  const height = padTop + near.length * rowHeight + padBottom;
  const labelWidth = 66;
  // A gutter the bars never enter, so the wall and flip captions always have
  // clear space. Without it a caption landed on top of the widest bar on the
  // chart, which is precisely the strike a wall marks.
  const gutter = 78;
  const plot = width - labelWidth - gutter;
  const axis = labelWidth + plot / 2;
  const half = plot / 2 - 8;

  const peak = Math.max(...near.map((row) => Math.max(row.callVolume || 0, row.putVolume || 0)), 1);
  const scale = (volume: number) => (Math.max(0, volume) / peak) * half;
  const y = (index: number) => padTop + index * rowHeight;

  const levels = [
    { value: options.levels.callWall, label: "call wall", kind: "call" },
    { value: options.levels.putWall, label: "put wall", kind: "put" },
    { value: options.levels.gammaFlip, label: "flip", kind: "flip" },
  ].filter((row): row is { value: number; label: string; kind: string } => row.value !== null && Number.isFinite(row.value));

  const strikeFor = (price: number) => {
    let best = 0;
    let distance = Infinity;
    near.forEach((row, index) => {
      const gap = Math.abs(row.strike - price);
      if (gap < distance) {
        distance = gap;
        best = index;
      }
    });
    return distance <= (near[0].strike - near[near.length - 1].strike) / near.length ? best : null;
  };

  return (
    <figure className="sw-chart sw-ladder">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Option volume by strike, puts left and calls right">
        <text className="sw-chart__tick" x={axis - half / 2} y={12} textAnchor="middle">put volume</text>
        <text className="sw-chart__tick" x={axis + half / 2} y={12} textAnchor="middle">call volume</text>
        <text className="sw-chart__tick" x={labelWidth - 8} y={12} textAnchor="end">strike</text>

        {near.map((row, index) => {
          const top = y(index);
          const isSpot = spot !== null && strikeFor(spot) === index;
          return (
            <g key={row.strike}>
              {isSpot ? <rect className="sw-ladder__spotRow" x={0} y={top - 1} width={width} height={rowHeight} /> : null}
              <text
                className={`sw-ladder__strike${isSpot ? " is-spot" : ""}`}
                x={labelWidth - 8}
                y={top + rowHeight / 2 + 3}
                textAnchor="end"
              >
                {isSpot ? "▸ " : ""}{row.strike.toLocaleString()}
              </text>
              <rect
                className="sw-ladder__bar is-put"
                x={axis - scale(row.putVolume)}
                y={top + 3}
                width={scale(row.putVolume)}
                height={rowHeight - 7}
              />
              <rect
                className="sw-ladder__bar is-call"
                x={axis}
                y={top + 3}
                width={scale(row.callVolume)}
                height={rowHeight - 7}
              />
            </g>
          );
        })}

        {levels.map((level) => {
          const index = strikeFor(level.value);
          if (index === null) return null;
          const top = y(index) + rowHeight / 2;
          return (
            <g key={level.label}>
              <line className={`sw-ladder__level is-${level.kind}`} x1={labelWidth} x2={labelWidth + plot} y1={top} y2={top} />
              <text className={`sw-ladder__levelLabel is-${level.kind}`} x={labelWidth + plot + 5} y={top + 3}>
                {level.label}
              </text>
            </g>
          );
        })}

        <line className="sw-ladder__axis" x1={axis} x2={axis} y1={padTop - 4} y2={height - padBottom + 4} />
      </svg>
    </figure>
  );
}

/* ============================================================ term structure */

/** At-the-money implied volatility by expiry. */
export function IvTermCurve({ options }: { options: OptionBridgeData }) {
  const points = options.surface
    .filter((row) => row.atmIv !== null && Number.isFinite(row.atmIv) && row.years !== null)
    .slice(0, 10);
  if (points.length < 2) return <p className="sw-empty">Fewer than two expiries carry an at-the-money volatility.</p>;

  const width = 760;
  const height = 180;
  const padLeft = 4;
  const padRight = 48;
  const padTop = 12;
  const padBottom = 30;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const ivs = points.map((row) => row.atmIv! * 100);
  const low = Math.min(...ivs) * 0.94;
  const high = Math.max(...ivs) * 1.06;
  const x = (index: number) => padLeft + (index / (points.length - 1)) * plotWidth;
  const y = (value: number) => padTop + (1 - (value - low) / (high - low)) * plotHeight;
  const line = ivs.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const ticks = niceTicks(low, high, 3);

  return (
    <figure className="sw-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="At-the-money implied volatility by expiry">
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="sw-chart__grid" x1={padLeft} x2={padLeft + plotWidth} y1={y(tick)} y2={y(tick)} />
            <text className="sw-chart__tick" x={padLeft + plotWidth + 6} y={y(tick) + 3}>{tick.toFixed(0)}%</text>
          </g>
        ))}
        <polyline className="sw-chart__line is-neutral" points={line} vectorEffect="non-scaling-stroke" />
        {ivs.map((value, index) => (
          <circle key={points[index].expiry} className="sw-chart__dot" cx={x(index)} cy={y(value)} r={2.6} />
        ))}
        {points.map((row, index) =>
          index % Math.ceil(points.length / 5) === 0 || index === points.length - 1 ? (
            <text
              key={row.expiry}
              className="sw-chart__tick"
              x={x(index)}
              y={height - 8}
              textAnchor={index === points.length - 1 ? "end" : index === 0 ? "start" : "middle"}
            >
              {row.expiry.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
    </figure>
  );
}

/* =========================================================== analyst targets */

/**
 * Where the street's targets sit relative to the last close.
 *
 * The four published figures are points on one price axis, and the only
 * question worth asking of them — how far the average sits above or below where
 * the stock actually trades — is a distance. Three stat tiles and a thin
 * unlabelled rail could not show it.
 */
export function AnalystTargets({
  low,
  average,
  median,
  high,
  price,
}: {
  low: number | null;
  average: number | null;
  median: number | null;
  high: number | null;
  price: number | null;
}) {
  const points = [low, average, median, high, price].filter((value): value is number => value !== null && Number.isFinite(value));
  if (points.length < 2) return <p className="sw-empty">Not enough published targets to plot a range.</p>;

  const width = 760;
  const height = 152;
  const padX = 52;
  const axisY = 76;
  const plotWidth = width - padX * 2;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, Number.EPSILON);
  const x = (value: number) => padX + ((value - min) / span) * plotWidth;

  const marks = [
    { value: low, label: "Low", kind: "band", place: "below" as const },
    { value: median, label: "Median", kind: "median", place: "above" as const },
    { value: average, label: "Average", kind: "average", place: "above" as const },
    { value: high, label: "High", kind: "band", place: "below" as const },
    { value: price, label: "Last", kind: "price", place: "below" as const },
  ].filter((mark): mark is { value: number; label: string; kind: string; place: "above" | "below" } => mark.value !== null && Number.isFinite(mark.value));

  /**
   * Two rows of captions on each side of the axis.
   *
   * The average and the median are usually a few dollars apart, which put their
   * labels on the same pixels — "$302.83" and "$300.00" rendered over one
   * another. A mark that lands too near the previous one on its side drops to
   * the second row instead.
   */
  const lanes: Record<"above" | "below", number[]> = { above: [-Infinity, -Infinity], below: [-Infinity, -Infinity] };
  const placed = [...marks]
    .sort((a, b) => a.value - b.value)
    .map((mark) => {
      const at = x(mark.value);
      let lane = 0;
      while (lane < 1 && at - lanes[mark.place][lane] < 82) lane += 1;
      lanes[mark.place][lane] = at;
      return { ...mark, at, lane };
    });

  return (
    <figure className="sw-chart sw-targets">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Analyst price targets against the last close">
        {low !== null && high !== null ? (
          <rect className="sw-targets__band" x={x(low)} y={axisY - 5} width={Math.max(1, x(high) - x(low))} height={10} />
        ) : null}

        {/* The distance from today's price to the average target, drawn as the
            span it is rather than left as a percentage to be imagined. */}
        {price !== null && average !== null ? (
          <rect
            className={`sw-targets__gap is-${average >= price ? "up" : "down"}`}
            x={Math.min(x(price), x(average))}
            y={axisY - 5}
            width={Math.max(1, Math.abs(x(average) - x(price)))}
            height={10}
          />
        ) : null}

        <line className="sw-targets__axis" x1={padX} x2={padX + plotWidth} y1={axisY} y2={axisY} />

        {placed.map((mark) => {
          const offset = mark.lane * 26;
          const labelY = mark.place === "above" ? axisY - 18 - offset : axisY + 26 + offset;
          const valueY = mark.place === "above" ? axisY - 30 - offset : axisY + 38 + offset;
          const isPrice = mark.kind === "price";
          return (
            <g key={mark.label}>
              <line
                className={isPrice ? "sw-targets__price" : `sw-targets__tick is-${mark.kind}`}
                x1={mark.at}
                x2={mark.at}
                y1={axisY - (isPrice ? 16 : 9)}
                y2={axisY + (isPrice ? 16 : 9)}
              />
              <text className="sw-chart__tick" x={mark.at} y={labelY} textAnchor="middle">{mark.label}</text>
              <text className={`sw-targets__value is-${mark.kind}`} x={mark.at} y={valueY} textAnchor="middle">{usd(mark.value)}</text>
            </g>
          );
        })}

        {/* The distance to the average target is already a stat above this
            chart. Repeating it here as a caption collided with a target label
            whenever the average sat near the right of the range. */}
      </svg>
    </figure>
  );
}

/**
 * Implied bands at several horizons, on one price axis.
 *
 * Nested rather than side by side, because the point is that each longer
 * horizon contains the shorter ones: the widening is the term structure.
 */
export function ImpliedMoveBands({
  spot,
  moves,
}: {
  spot: number;
  moves: { horizon: string; dollars: number; percent: number; lower: number; upper: number }[];
}) {
  if (!moves.length || !Number.isFinite(spot)) return null;

  const width = 760;
  const rowHeight = 34;
  const padTop = 8;
  const padBottom = 22;
  const labelWidth = 92;
  const gutter = 76;
  const plot = width - labelWidth - gutter;
  const height = padTop + moves.length * rowHeight + padBottom;

  // One axis for every row, set by the widest band, so the rows are comparable.
  const widest = Math.max(...moves.map((move) => move.dollars));
  const low = spot - widest * 1.08;
  const high = spot + widest * 1.08;
  const x = (value: number) => labelWidth + ((value - low) / Math.max(high - low, Number.EPSILON)) * plot;

  return (
    <figure className="sw-chart sw-bands">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Implied move bands by horizon">
        {moves.map((move, index) => {
          const top = padTop + index * rowHeight;
          const mid = top + rowHeight / 2;
          return (
            <g key={move.horizon}>
              <text className="sw-bands__label" x={labelWidth - 10} y={mid + 3} textAnchor="end">{move.horizon}</text>
              <rect className="sw-bands__band" x={x(move.lower)} y={mid - 7} width={Math.max(1, x(move.upper) - x(move.lower))} height={14} />
              <line className="sw-bands__edge" x1={x(move.lower)} x2={x(move.lower)} y1={mid - 10} y2={mid + 10} />
              <line className="sw-bands__edge" x1={x(move.upper)} x2={x(move.upper)} y1={mid - 10} y2={mid + 10} />
              <text className="sw-chart__tick" x={labelWidth + plot + 6} y={mid + 3}>±{move.percent.toFixed(1)}%</text>
            </g>
          );
        })}
        {/* Spot runs the height of the stack: every band is centred on it. */}
        <line className="sw-bands__spot" x1={x(spot)} x2={x(spot)} y1={padTop - 2} y2={height - padBottom + 2} />
        <text className="sw-bands__spotLabel" x={x(spot)} y={height - 8} textAnchor="middle">{usd(spot)}</text>
      </svg>
    </figure>
  );
}

/* =========================================================== forecast series */

/**
 * Reported fiscal years followed by the consensus ones, on a single axis.
 *
 * The forecast years sit inside a hatched band that is labelled as such, so the
 * boundary between what a company has reported and what strangers expect it to
 * report is a region of the chart rather than a footnote. Estimate bars are
 * drawn open on the same hatch, and carry a whisker spanning the analysts' low
 * to high where the publisher gives one — plotting an estimate identically to a
 * reported figure is the specific thing this codebase refuses to do, and the
 * spread is usually the more useful half of a forecast anyway.
 *
 * Gridlines and a value axis were both absent before. On a series running from
 * $0.60 to $35 that left the reader estimating heights against nothing.
 */
export function ForecastSeries({
  series,
  range,
  format,
  label,
}: {
  series: { label: string; value: number | null; forecast: boolean }[];
  range?: { high: number | null; average: number | null; low: number | null } | null;
  format: (value: number | null) => string;
  label: string;
}) {
  // Two of these render on the forecast view, and a hardcoded pattern id would
  // have the second one painting with the first one's hatch.
  const hatchId = useId();
  const points = series.filter((row) => row.value !== null && Number.isFinite(row.value));
  if (points.length < 2) return <p className="sw-empty">Not enough reported years to plot.</p>;

  const width = 900;
  const height = 280;
  const padTop = 30;
  const padLeft = 54;
  const padRight = 14;
  // A loss-making year hangs its value caption below the bar, which needs room
  // above the fiscal-year labels — CoreWeave's negative EPS put the two on the
  // same line.
  const negative = points.some((row) => (row.value ?? 0) < 0) || (range?.low ?? 0) < 0;
  const padBottom = negative ? 62 : 44;
  const plotHeight = height - padTop - padBottom;
  const plotWidth = width - padLeft - padRight;
  // A series with two or three years would otherwise sit a third of the chart
  // apart, which reads as missing data rather than a short history. The group
  // is centred at a fixed column width instead of stretching to fill.
  const usable = Math.min(plotWidth, points.length * 132);
  const originX = padLeft + (plotWidth - usable) / 2;
  const slot = usable / points.length;
  const barWidth = Math.min(slot * 0.46, 58);

  // A loss-making year makes EPS negative, so the axis has to span zero the
  // same way the cash-flow chart does rather than assume everything is above it.
  const magnitudes = [...points.map((row) => row.value!), range?.high ?? 0, range?.low ?? 0];
  const rawTop = Math.max(0, ...magnitudes);
  const bottom = Math.min(0, ...magnitudes);
  // Headroom for the value caption sitting above the tallest bar.
  const top = rawTop + (rawTop - bottom) * 0.12;
  const span = Math.max(top - bottom, Number.EPSILON);
  const y = (value: number) => padTop + ((top - value) / span) * plotHeight;
  const zero = y(0);
  const ticks = niceTicks(bottom, top);

  const firstForecast = points.findIndex((row) => row.forecast);
  const bandX = firstForecast >= 0 ? originX + slot * firstForecast : null;
  const bandWidth = bandX === null ? 0 : originX + usable - bandX;

  return (
    <figure className="sw-chart sw-forecast">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <defs>
          <pattern id={hatchId} width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line className="sw-forecast__hatchLine" x1="0" y1="0" x2="0" y2="7" />
          </pattern>
        </defs>

        {bandX !== null ? (
          <g>
            <rect className="sw-forecast__band" x={bandX} y={padTop - 12} width={bandWidth} height={plotHeight + 12} fill={`url(#${hatchId})`} />
            <line className="sw-forecast__bandEdge" x1={bandX} x2={bandX} y1={padTop - 12} y2={padTop + plotHeight} />
            <text className="sw-forecast__bandLabel" x={bandX + bandWidth / 2} y={padTop - 18} textAnchor="middle">
              forecast
            </text>
          </g>
        ) : null}

        {ticks.map((tick) => (
          <g key={tick}>
            <line className="sw-chart__grid" x1={padLeft} x2={width - padRight} y1={y(tick)} y2={y(tick)} />
            <text className="sw-chart__tick sw-chart__tick--end" x={padLeft - 8} y={y(tick) + 3.5}>
              {format(tick)}
            </text>
          </g>
        ))}

        {points.map((row, index) => {
          const centre = originX + slot * index + slot / 2;
          const valueY = y(row.value!);
          const positive = row.value! >= 0;
          const showRange = row.forecast && range && range.high !== null && range.low !== null;
          const highY = showRange ? y(range!.high!) : valueY;
          return (
            <g key={row.label}>
              <rect
                className={`sw-forecast__bar${row.forecast ? " is-forecast" : ""}`}
                x={centre - barWidth / 2}
                y={positive ? valueY : zero}
                width={barWidth}
                height={Math.max(2, Math.abs(valueY - zero))}
                rx={2}
              />
              {showRange ? (
                <g className="sw-forecast__whisker">
                  <line x1={centre} x2={centre} y1={y(range!.high!)} y2={y(range!.low!)} />
                  <line x1={centre - 9} x2={centre + 9} y1={y(range!.high!)} y2={y(range!.high!)} />
                  <line x1={centre - 9} x2={centre + 9} y1={y(range!.low!)} y2={y(range!.low!)} />
                </g>
              ) : null}
              <text
                className={`sw-chart__barValue${row.forecast ? " is-forecast" : ""}`}
                x={centre}
                y={positive ? Math.min(valueY, highY) - 7 : Math.max(valueY, showRange ? y(range!.low!) : valueY) + 13}
                textAnchor="middle"
              >
                {format(row.value)}
              </text>
              <text className={`sw-chart__tick${row.forecast ? " is-forecast" : ""}`} x={centre} y={height - padBottom + 22} textAnchor="middle">
                {row.label.replace("FY ", "FY")}
              </text>
            </g>
          );
        })}

        <line className="sw-chart__axis" x1={padLeft} x2={width - padRight} y1={zero} y2={zero} stroke={AXIS} />
      </svg>

      <figcaption className="sw-forecast__legend">
        <span className="sw-forecast__key">
          <i className="sw-forecast__swatch" /> reported
        </span>
        <span className="sw-forecast__key">
          <i className="sw-forecast__swatch is-forecast" /> consensus estimate
        </span>
        {range && range.high !== null && range.low !== null ? (
          <span className="sw-forecast__key">
            <i className="sw-forecast__swatch is-range" /> analyst low to high
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * The same fiscal years as a table, one metric to a row.
 *
 * A chart answers the shape of the series and a table answers what any single
 * year actually was; the two together are how a forecast is normally read. Rows
 * whose every cell is absent are dropped rather than printed as a line of
 * dashes.
 */
export function ForecastLedger({
  years,
  rows,
}: {
  years: { label: string; forecast: boolean }[];
  rows: { label: string; note?: string; values: (string | null)[]; tones?: (Tone | undefined)[] }[];
}) {
  const populated = rows.filter((row) => row.values.some((value) => value !== null));
  if (!populated.length) return null;

  return (
    <div className="sw-forecast__ledger">
      <table className="sw-table sw-table--compact sw-forecast__table">
        <thead>
          <tr>
            <th scope="col">Fiscal year</th>
            {years.map((year) => (
              <th scope="col" className={`sw-num${year.forecast ? " is-forecast" : ""}`} key={year.label}>
                {year.label.replace("FY ", "FY")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {populated.map((row) => (
            <tr key={row.label}>
              <th scope="row">
                {row.label}
                {row.note ? <small>{row.note}</small> : null}
              </th>
              {row.values.map((value, index) => (
                <td
                  className={`sw-num${years[index]?.forecast ? " is-forecast" : ""}${row.tones?.[index] && row.tones[index] !== "flat" ? ` is-${row.tones[index]}` : ""}`}
                  key={years[index]?.label ?? index}
                >
                  {value ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================ cash-flow bars */

/** Reported free cash flow by fiscal year, with the year labelled under each bar. */
/**
 * Reported free cash flow by fiscal year, including loss-making years.
 *
 * The zero line sits where the data puts it rather than at the foot of the
 * chart. Drawing every bar upward from the bottom and hanging the negative ones
 * below it pushed their value labels onto the year captions, and past the
 * chart's own box onto the note underneath — CoreWeave and Zillow both report
 * negative free cash flow, so the case is not hypothetical.
 */
export function CashFlowChart({ series }: { series: { year: string; value: number }[] }) {
  if (!series.length) return <p className="sw-empty">No fiscal year reports both operating cash flow and capital expenditure.</p>;

  const width = 720;
  const height = 186;
  const padTop = 20;
  const padBottom = 34;
  const plotHeight = height - padTop - padBottom;
  const usable = Math.min(width, series.length * 150);
  const originX = (width - usable) / 2;
  const slot = usable / series.length;
  const barWidth = Math.min(slot * 0.6, 76);

  // The axis spans zero even when every year is the same sign, so the bars are
  // read against a true baseline rather than against the smallest value.
  const values = series.map((row) => row.value);
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const span = Math.max(top - bottom, Number.EPSILON);
  const y = (value: number) => padTop + ((top - value) / span) * plotHeight;
  const zero = y(0);

  return (
    <figure className="sw-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Reported free cash flow by fiscal year">
        {series.map((row, index) => {
          const centre = originX + slot * index + slot / 2;
          const valueY = y(row.value);
          const positive = row.value >= 0;
          return (
            <g key={row.year}>
              <rect
                className={`sw-chart__bar is-${positive ? "up" : "down"}`}
                x={centre - barWidth / 2}
                y={positive ? valueY : zero}
                width={barWidth}
                height={Math.max(2, Math.abs(valueY - zero))}
              />
              {/* Always on the outer side of the bar, so it never lands on the
                  zero line or on the year beneath. */}
              <text
                className="sw-chart__barValue"
                x={centre}
                y={positive ? valueY - 6 : valueY + 12}
                textAnchor="middle"
              >
                {money(row.value)}
              </text>
              <text className="sw-chart__tick" x={centre} y={height - 8} textAnchor="middle">{row.year}</text>
            </g>
          );
        })}
        <line className="sw-chart__axis" x1={0} x2={width} y1={zero} y2={zero} stroke={AXIS} />
      </svg>
    </figure>
  );
}
