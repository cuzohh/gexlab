"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

type Levels = {
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
};

type RailData = {
  symbol: string;
  spot: number;
  netGamma: number;
  levels: Levels;
  timestamp: string;
  stale?: boolean;
};

type Instrument = "NQ" | "ES";

const INSTRUMENT_KEY = "gexlab:rail-instrument";
const indexFor = (instrument: Instrument) => (instrument === "NQ" ? "NDX" : "SPX");
/** The chain is republished on a fifteen-minute cadence at best. */
const REFRESH_MS = 5 * 60 * 1000;

function money(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Where price sits inside the option structure, on the Options and Reversal workspaces.
 *
 * The Options and Reversal workspaces use the same three levels, so moving
 * between them should not require rebuilding the same picture. The Macro
 * overview has a compact daily summary of its own. This is deliberately the
 * least detailed view of the book on the site: spot, the walls, and the flip.
 */
export function StructureRail() {
  const reducedMotion = useReducedMotion();
  const [instrument, setInstrument] = useState<Instrument>("NQ");
  const [loaded, setLoaded] = useState<{ index: string; data: RailData | null } | null>(null);

  useEffect(() => {
    // Deferred out of the effect body, the way the Options workspace reads its
    // own stored preferences: the initial state cannot read localStorage
    // without diverging from what the server rendered.
    const saved = window.localStorage.getItem(INSTRUMENT_KEY);
    queueMicrotask(() => {
      if (saved === "ES" || saved === "NQ") setInstrument(saved);
    });
  }, []);

  useEffect(() => {
    const index = indexFor(instrument);
    let cancelled = false;

    // The same forty-five day book the Reversal workspace reads. Left to the
    // default the route selects the front expiry alone, whose net gamma
    // routinely carries the opposite sign to the wider book — so the rail
    // announced "short gamma" beside a Reversal page reading "stabilizing",
    // from the same endpoint on the same instrument.
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 45);
    const through = horizon.toISOString().slice(0, 10);

    const read = () => {
      fetch(`/api/options/${index}?updates=eod&through=${through}&view=reversal`)
        .then((response) => response.json())
        .then((payload) => {
          if (cancelled) return;
          setLoaded({
            index,
            data: payload?.error ? null : (payload as RailData),
          });
        })
        .catch(() => {
          if (!cancelled) setLoaded({ index, data: null });
        });
    };

    read();
    const timer = window.setInterval(read, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [instrument]);

  function choose(next: Instrument) {
    setInstrument(next);
    window.localStorage.setItem(INSTRUMENT_KEY, next);
  }

  const index = indexFor(instrument);
  const data = loaded?.index === index ? loaded.data : null;
  const { callWall = null, putWall = null, gammaFlip = null } = data?.levels ?? {};

  // The track spans the two walls. Price outside them is clamped to the end it
  // left through rather than drawn off the rail: that it is beyond the wall is
  // the reading, and the exact distance is on the workspaces themselves.
  const span = callWall !== null && putWall !== null && callWall > putWall ? { putWall, callWall } : null;
  const place = (value: number | null) => {
    if (value === null || !span) return null;
    const ratio = (value - span.putWall) / (span.callWall - span.putWall);
    return Math.max(0, Math.min(1, ratio)) * 100;
  };
  const spotAt = data ? place(data.spot) : null;
  const flipAt = place(gammaFlip);

  const nearest = (() => {
    if (!data) return null;
    const options = [
      { label: "call wall", value: callWall },
      { label: "put wall", value: putWall },
      { label: "flip", value: gammaFlip },
    ].filter((row): row is { label: string; value: number } => row.value !== null);
    if (!options.length) return null;
    return options.reduce((best, row) =>
      Math.abs(row.value - data.spot) < Math.abs(best.value - data.spot) ? row : best,
    );
  })();

  return (
    <section className="structure-rail" aria-label="Price against option structure">
      <header>
        <span>Structure</span>
        <span className="structure-rail-toggle" role="group" aria-label="Instrument">
          {(["NQ", "ES"] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-active={instrument === option || undefined}
              aria-pressed={instrument === option}
              onClick={() => choose(option)}
            >
              {option}
            </button>
          ))}
        </span>
      </header>

      {data ? (
        <>
          <p className="structure-rail-spot">
            <strong>{money(data.spot)}</strong>
            <small>{index} spot</small>
          </p>

          {span && spotAt !== null ? (
            <div className="structure-rail-track">
              <i className="structure-rail-line" />
              {flipAt !== null && (
                <i className="structure-rail-flip" style={{ left: `${flipAt}%` }} aria-hidden="true" />
              )}
              <motion.i
                className="structure-rail-spot-mark"
                aria-hidden="true"
                initial={false}
                animate={{ left: `${spotAt}%` }}
                transition={{ duration: reducedMotion ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          ) : (
            <div className="structure-rail-track structure-rail-track--empty" />
          )}

          <p className="structure-rail-ends">
            <span>{putWall === null ? "—" : money(putWall)}</span>
            <span>{callWall === null ? "—" : money(callWall)}</span>
          </p>

          <p className="structure-rail-reading">
            {nearest ? (
              <>
                <span className={data.netGamma >= 0 ? "positive" : "negative"}>
                  {data.netGamma >= 0 ? "Long gamma" : "Short gamma"}
                </span>
                {`${Math.abs(((nearest.value - data.spot) / data.spot) * 100).toFixed(2)}% to ${nearest.label}`}
              </>
            ) : (
              "No levels in range"
            )}
          </p>
        </>
      ) : (
        <p className="structure-rail-reading">{loaded ? "Structure unavailable" : "Reading structure…"}</p>
      )}
    </section>
  );
}
