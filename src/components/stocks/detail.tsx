"use client";

import Link from "next/link";
import { useState } from "react";
import { assess } from "@/components/stocks/assess";
import { useStockDetail } from "@/components/stocks/data";
import { dateShort, pct, tone, usd } from "@/components/stocks/format";
import {
  AnalystPanel,
  BookPanel,
  ForecastPanel,
  CashFlowHistoryPanel,
  CatalystPanel,
  BaseRatePanel,
  CompanyPanel,
  DividendPanel,
  FlowPanel,
  ImpliedMovePanel,
  LevelsPanel,
  MetricsPanel,
  OwnershipPanel,
  PricePanel,
  SignalsPanel,
  QualityPanel,
  RelativeStrengthPanel,
  RevisionPanel,
  SecPanel,
  TermStructurePanel,
  ValueTrapPanel,
  VolDislocationPanel,
} from "@/components/stocks/panels";
import { STOCK_VIEWS, type StockData, type StockView } from "@/components/stocks/types";
import { Chip, Empty, Panel, Skeleton, SkeletonStats, useValueFlash } from "@/components/stocks/ui";
import { RiskWorkbench, ValueWorkbench } from "@/components/stocks/workbench";

/**
 * One ticker.
 *
 * The eight entries below used to be one page with CSS hiding the parts that
 * did not belong to the open view, so every visit rendered twelve panels and
 * requested six sources no matter which entry was clicked. Each view now
 * renders its own panels and asks only for what those panels read.
 */
export function StockDetail({
  symbol,
  view,
  initialStock = null,
}: {
  symbol: string;
  view: StockView;
  /** Rendered on the server when the snapshot was fresh; null on a cold cache. */
  initialStock?: StockData | null;
}) {
  const ticker = symbol.toUpperCase();
  const { stock, macro, options, analyst, ownership, catalysts, profile, refresh, refreshing } = useStockDetail(ticker, view, initialStock);
  const [bridge, setBridge] = useState<{ busy: boolean; message: string }>({ busy: false, message: "" });

  const data = stock.data;
  // The quote is the figure a refresh is usually asked for, so it flashes on
  // its own rather than waiting to be noticed among the panels below.
  const priceFlash = useValueFlash(usd(data?.price ?? null));
  const state = data ? assess(data, macro.data) : null;
  const relative = data?.relativeStrength.find((row) => row.periods === 20)?.versusSector ?? null;

  /**
   * Copy this ticker's option walls for a chart.
   *
   * Deliberately on demand: it pulls a full delayed option book, which is not
   * something a page visit should do on its own.
   */
  async function copyWalls() {
    if (!data) return;
    setBridge({ busy: true, message: "" });
    try {
      const response = await fetch(`/api/options/${data.symbol}?updates=eod`);
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Option walls are unavailable for this ticker.");
      const { buildBridgePayload, DEFAULT_BRIDGE_PARTS } = await import("@/lib/bridge-payload");
      const front = payload.selection.expiries[0];
      const frontSurface = payload.surface.find((slice: { expiry: string }) => slice.expiry === front);
      const dte = (expiry: string) => Math.max(0, Math.ceil((Date.parse(`${expiry}T20:00:00Z`) - Date.now()) / 86_400_000));
      const text = buildBridgePayload(
        [{
          name: payload.symbol,
          role: "P" as const,
          spot: payload.spot,
          levels: payload.levels,
          strikes: payload.strikes,
          expiries: payload.expiryLevels.map((slice: { expiry: string; levels: unknown; settlesAt?: string | null }) => ({
            label: `${dte(slice.expiry)}DTE`,
            dte: dte(slice.expiry),
            levels: slice.levels,
            settlesAt: slice.settlesAt ?? null,
          })),
          frontAtmIv: frontSurface?.atmIv ?? null,
          frontYears: frontSurface?.years ?? null,
          frontSettlesAt: payload.expiryLevels.find((slice: { expiry: string }) => slice.expiry === front)?.settlesAt ?? null,
        }],
        {
          space: "N",
          instrument: "STOCK",
          referenceSpot: payload.spot,
          generatedAt: new Date(payload.timestamp),
          parts: { ...DEFAULT_BRIDGE_PARTS, confirmation: false },
        },
      );
      await navigator.clipboard.writeText(text);
      setBridge({ busy: false, message: `${payload.symbol} walls copied.` });
    } catch (reason) {
      setBridge({ busy: false, message: reason instanceof Error ? reason.message : "Unable to copy walls." });
    }
  }

  return (
    <div className="sw sw-detail">
      <header className="sw-ticker">
        <div className="sw-ticker__identity">
          <Link href="/stocks" className="sw-back" aria-label="Back to the watchlist">←</Link>
          <h1>{ticker}</h1>
          <span className="sw-ticker__company">{data?.fundamentals?.company ?? (stock.state === "loading" ? "" : ticker)}</span>
        </div>

        <div className="sw-ticker__quote">
          {stock.state === "loading" && !data ? (
            <Skeleton width="8rem" />
          ) : (
            <>
              <strong className={priceFlash}>{usd(data?.price ?? null)}</strong>
              <b className={`sw-delta is-${tone(data?.dayReturn ?? null)}${priceFlash}`}>{pct(data?.dayReturn ?? null)}</b>
              <small>{data?.asOf ? `${data.intraday ? "last trade" : "close"} ${dateShort(data.asOf)}` : "no close reported"}</small>
            </>
          )}
        </div>

        <div className="sw-ticker__state">
          {state ? <Chip tone={state.tone}>{state.label}</Chip> : null}
          {data ? <span>{pct(relative)} vs {data.benchmark} · 1 month</span> : null}
          {data?.stale ? <Chip tone="warn">saved prices</Chip> : null}
        </div>

        <div className="sw-ticker__actions">
          {/* Refetches every source the open view reads, in place. Nothing is
              reloaded and no panel is torn down: the figures are replaced where
              they stand and the ones that moved are marked. */}
          <button type="button" onClick={refresh} disabled={refreshing} aria-label={`Refresh ${ticker}`}>
            <span className={`sw-refresh__mark${refreshing ? " is-spinning" : ""}`} aria-hidden="true">↻</span>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" onClick={copyWalls} disabled={bridge.busy || !data}>
            {bridge.busy ? "Preparing…" : "Copy walls"}
          </button>
        </div>
      </header>

      <nav className="sw-views" aria-label={`${ticker} sections`}>
        {STOCK_VIEWS.map((entry) => (
          <Link
            key={entry.view}
            href={entry.view === "overview" ? `/stocks/${ticker}` : `/stocks/${ticker}/${entry.view}`}
            aria-current={entry.view === view ? "page" : undefined}
            data-active={entry.view === view || undefined}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {bridge.message ? <p className="sw-inline-error" role="status">{bridge.message}</p> : null}
      {stock.state === "error" ? <p className="sw-inline-error" role="status">{stock.error}</p> : null}

      <div className="sw-panels">
        {view === "overview" ? (
          data ? (
            <>
              <PricePanel stock={data} />
              <CompanyPanel stock={data} profile={profile} />
              <LevelsPanel stock={data} options={options} />
              <RelativeStrengthPanel stock={data} />
              <BookPanel stock={data} options={options} />
            </>
          ) : (
            <LoadingPanels titles={["Price and trend", "Option levels", "Relative strength"]} />
          )
        ) : null}

        {view === "signals" ? (
          data ? <SignalsPanel stock={data} options={options} analyst={analyst} /> : <LoadingPanels titles={["Research signals"]} />
        ) : null}

        {view === "flow" ? (
          data ? (
            <>
              <BookPanel stock={data} options={options} />
              <ImpliedMovePanel stock={data} options={options} />
              <LevelsPanel stock={data} options={options} />
              <TermStructurePanel options={options} />
              <VolDislocationPanel options={options} />
              <FlowPanel stock={data} options={options} />
            </>
          ) : (
            <LoadingPanels titles={["Options activity", "Option levels"]} />
          )
        ) : null}

        {view === "metrics" ? (
          data ? (
            <>
              <MetricsPanel stock={data} options={options} />
              <DividendPanel profile={profile} />
              <CashFlowHistoryPanel stock={data} />
            </>
          ) : (
            <LoadingPanels titles={["Metrics", "Reported free cash flow"]} />
          )
        ) : null}

        {view === "sec" ? (
          data ? (
            <>
              <SecPanel stock={data} />
              <QualityPanel stock={data} />
              <CashFlowHistoryPanel stock={data} />
            </>
          ) : (
            <LoadingPanels titles={["SEC filing", "Business quality", "Reported free cash flow"]} />
          )
        ) : null}

        {view === "analysts" ? (
          data ? (
            <>
              <AnalystPanel stock={data} analyst={analyst} />
              <RevisionPanel analyst={analyst} />
              <ForecastPanel analyst={analyst} stock={data} />
            </>
          ) : (
            <LoadingPanels titles={["Analyst consensus"]} />
          )
        ) : null}

        {view === "ownership" ? <OwnershipPanel ownership={ownership} /> : null}

        {view === "value" ? (
          data ? (
            <>
              <ValueWorkbench stock={data} />
              <ValueTrapPanel stock={data} analyst={analyst} />
              <BaseRatePanel stock={data} />
              <DividendPanel profile={profile} />
            </>
          ) : <LoadingPanels titles={["Valuation workbench"]} />
        ) : null}

        {view === "risk" ? (
          data ? (
            <>
              <RiskWorkbench stock={data} options={options} catalysts={catalysts} profile={profile} />
              <CatalystPanel catalysts={catalysts} />
            </>
          ) : (
            <LoadingPanels titles={["Position sizing", "Event risk", "Filings and calendar"]} />
          )
        ) : null}

        {stock.state === "error" && !data ? (
          <Panel title="Unavailable">
            <Empty>{stock.error ?? `No research could be loaded for ${ticker}.`}</Empty>
          </Panel>
        ) : null}
      </div>

      {/* The shell footer already carries the advice disclaimer; this states the sourcing. */}
      <p className="sw-legend">Official SEC and FINRA filings with delayed market data. Figures are reported, never estimated.</p>
    </div>
  );
}

/** Panels held at their final shape while the first request is in flight. */
function LoadingPanels({ titles }: { titles: string[] }) {
  return (
    <>
      {titles.map((title) => (
        <Panel key={title} title={title} meta="loading">
          <SkeletonStats columns={4} />
        </Panel>
      ))}
    </>
  );
}
