"use client";

import { motion } from "motion/react";

type RegimeMapProps = {
  compact?: boolean;
  regime?: string;
  growth?: number;
  inflation?: number;
  trail?: { growth: number; inflation: number }[];
};

export function RegimeMap({
  compact = false,
  regime = "Loading regime",
  growth = 50,
  inflation = 50,
  trail = [],
}: RegimeMapProps) {
  const titleId = compact ? "regime-map-title-compact" : "regime-map-title";
  const descriptionId = compact ? "regime-map-description-compact" : "regime-map-description";
  const point = {
    x: 64 + (growth / 100) * 512,
    y: 322 - (inflation / 100) * 284,
  };
  const trailPoints = [...trail.slice(-3), { growth, inflation }].map((row) => ({
    x: 64 + (row.growth / 100) * 512,
    y: 322 - (row.inflation / 100) * 284,
  }));
  const path = trailPoints.map((row, index) => `${index ? "L" : "M"} ${row.x} ${row.y}`).join(" ");
  // Clear of the marker halo (radius 20), on whichever side has room for the
  // caption. The widest line is "inflation NN", about 62 units at this size.
  const calloutGap = 26;
  const calloutFitsRight = point.x + calloutGap + 62 <= 576;
  const calloutX = calloutFitsRight ? point.x + calloutGap : point.x - calloutGap;
  const calloutAnchor = calloutFitsRight ? "start" : "end";
  const regimeTone = regime === "Reflation" ? "caution" : regime === "Stagflation" ? "stress" : regime === "Disinflationary expansion" ? "constructive" : "neutral";

  return (
    <figure className={`regime-map ${compact ? "regime-map--compact" : ""}`}>
      <div className="visual-heading">
        <div>
          <p className="section-kicker">Market environment</p>
          <h2>Where are growth and inflation heading?</h2>
        </div>
        <span className="visual-reading">
          <i className={`tone-dot tone-dot--${regimeTone}`} />
          {regime}
        </span>
      </div>

      <svg
        viewBox="0 0 640 390"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>Growth and inflation regime map</title>
        <desc id={descriptionId}>
          Current growth and inflation scores place the environment in the {regime} quadrant.
        </desc>

        <motion.rect className="map-field map-field--slowdown" x="64" y="38" width="256" height="142" rx="8" initial={false} animate={{ opacity: 1 }} transition={{ duration: 0.32 }} />
        <motion.rect className="map-field map-field--goldilocks" x="320" y="38" width="256" height="142" rx="8" initial={false} animate={{ opacity: 1 }} transition={{ delay: 0.06, duration: 0.32 }} />
        <motion.rect className="map-field map-field--stagflation" x="64" y="180" width="256" height="142" rx="8" initial={false} animate={{ opacity: 1 }} transition={{ delay: 0.12, duration: 0.32 }} />
        <motion.rect className="map-field map-field--reflation" x="320" y="180" width="256" height="142" rx="8" initial={false} animate={{ opacity: 1 }} transition={{ delay: 0.18, duration: 0.32 }} />

        <line className="map-axis" x1="64" y1="180" x2="576" y2="180" />
        <line className="map-axis" x1="320" y1="38" x2="320" y2="322" />

        <text className={`map-label ${regime === "Disinflationary slowdown" ? "map-label--active map-label--neutral" : ""}`} x="82" y="63">DISINFLATIONARY SLOWDOWN</text>
        <text className={`map-label ${regime === "Disinflationary expansion" ? "map-label--active map-label--constructive" : ""}`} x="338" y="63">DISINFLATIONARY EXPANSION</text>
        <text className={`map-label ${regime === "Stagflation" ? "map-label--active map-label--stress" : ""}`} x="82" y="305">STAGFLATION</text>
        <text className={`map-label ${regime === "Reflation" ? "map-label--active map-label--caution" : ""}`} x="338" y="305">REFLATION</text>

        <text className="map-axis-label" x="64" y="354">GROWTH SLOWING</text>
        <text className="map-axis-label" x="576" y="354" textAnchor="end">GROWTH IMPROVING</text>
        <text className="map-axis-label" x="28" y="40" transform="rotate(-90 28 40)" textAnchor="end">
          INFLATION COOLING
        </text>
        <text className="map-axis-label" x="28" y="322" transform="rotate(-90 28 322)">
          INFLATION RISING
        </text>

        {path && <motion.path className="regime-trail" d={path} initial={false} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.72, ease: [0.16, 1, 0.3, 1] }} />}
        {trailPoints.slice(0, -1).map((row, index) => (
          <motion.circle className="trail-point trail-point--old" cx={row.x} cy={row.y} r="4" key={index} initial={false} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.35 + index * 0.08, duration: 0.28 }} />
        ))}
        <motion.circle className="current-halo" cx={point.x} cy={point.y} r="20" initial={false} animate={{ opacity: 1, r: 20 }} transition={{ delay: 0.5, duration: 0.42 }} />
        <motion.circle className="current-point" cx={point.x} cy={point.y} r="7" initial={false} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.52, duration: 0.42, ease: [0.16, 1, 0.3, 1] }} />
        {/* The callout clears the halo rather than starting inside it. It used
            to be offset by 14 against a halo of radius 20, so every reading sat
            with its first line printed over the marker it was labelling; and
            the clamp that kept it on-canvas pulled it further left as the point
            moved right, which put the text squarely on top of the dot in the
            one case the clamp existed for. Near the right edge it now switches
            sides instead. */}
        <text className="current-label" x={calloutX} y={point.y - 10} textAnchor={calloutAnchor}>NOW</text>
        <text className="current-note" x={calloutX} y={point.y + 7} textAnchor={calloutAnchor}>growth {growth}</text>
        <text className="current-note" x={calloutX} y={point.y + 20} textAnchor={calloutAnchor}>inflation {inflation}</text>
      </svg>

      <figcaption>
        <span>How to read this</span>
        Right means growth is improving; up means inflation pressure is cooling. The trail shows the
        direction of travel, not just today’s label.
      </figcaption>
    </figure>
  );
}
