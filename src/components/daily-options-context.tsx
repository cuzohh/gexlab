"use client";

import { useEffect, useMemo, useState } from "react";
import { buildReversalAnalysis, type ReversalSnapshot, type ReversalZone } from "@/lib/reversal-zones";

type DailyOptionsData = ReversalSnapshot & {
  retrievedAt?: string | null;
  error?: string;
};

const money = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function DailyOptionsContext() {
  const [data, setData] = useState<DailyOptionsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 45);
    const through = horizon.toISOString().slice(0, 10);
    const controller = new AbortController();

    fetch(`/api/options/NDX?updates=eod&through=${through}&view=reversal`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as DailyOptionsData;
        if (!response.ok || payload.error) throw new Error(payload.error ?? "Options context is unavailable.");
        return payload;
      })
      .then(setData)
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Options context is unavailable.");
      });

    return () => controller.abort();
  }, []);

  const analysis = useMemo(() => data ? buildReversalAnalysis(data) : null, [data]);
  const nearestZone = analysis?.zones.reduce<ReversalZone | null>(
    (nearest, zone) => !nearest || Math.abs(zone.distancePoints) < Math.abs(nearest.distancePoints) ? zone : nearest,
    null,
  ) ?? null;
  const expectedPoints = data?.expectedMovePercent && data.expectedMovePercent > 0
    ? data.spot * data.expectedMovePercent / 100
    : null;
  const sourceTime = data?.timestamp ?? data?.retrievedAt ?? null;

  return (
    <section className="daily-options-context" aria-label="Current options context">
      <article>
        <span>{data?.symbol ?? "NDX"} spot</span>
        <strong>{data ? money(data.spot) : "—"}</strong>
        <small>
          {!data
            ? error || "Loading options snapshot"
            : data.netGamma == null
              ? "Gamma exposure unavailable"
              : data.netGamma > 0
                ? "Long gamma book"
                : data.netGamma < 0 ? "Short gamma book" : "Net gamma near zero"}
        </small>
      </article>
      <article>
        <span>Front-expiry expected move</span>
        <strong>{expectedPoints === null ? "—" : `±${money(expectedPoints)} pts`}</strong>
        <small>{data?.expectedMovePercent ? `±${data.expectedMovePercent.toFixed(2)}% from implied volatility` : "Not available in this snapshot"}</small>
      </article>
      <article>
        <span>Nearest reversal zone</span>
        <strong>{nearestZone ? `${money(nearestZone.low)}–${money(nearestZone.high)}` : "—"}</strong>
        <small>{nearestZone ? `${nearestZone.side} · ${nearestZone.kind} · ${Math.abs(nearestZone.distancePercent).toFixed(2)}% ${nearestZone.distancePercent >= 0 ? "above" : "below"} spot` : "No reversal zone available"}</small>
        {nearestZone && (
          <small>
            {nearestZone.kind === "Acceleration zone"
              ? `Reclaim through ${money(nearestZone.center)} weakens the break thesis.`
              : `Acceptance beyond ${money(nearestZone.high)} or ${money(nearestZone.low)} weakens the reversal read.`}
          </small>
        )}
      </article>
      <article>
        <span>Snapshot freshness</span>
        <strong>{data ? data.stale ? "Cached source" : "Updated source" : error ? "Unavailable" : "Loading"}</strong>
        <small>{sourceTime ? `Source time · ${new Date(sourceTime).toLocaleString()}` : error || "Waiting for options data"}</small>
      </article>
    </section>
  );
}
