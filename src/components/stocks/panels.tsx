"use client";

import {
  count,
  dateShort,
  fiscalYear,
  freeCashFlow,
  guardedPercent,
  guardedRatio,
  money,
  multiple,
  pct,
  plural,
  rate,
  tone,
  usd,
} from "@/components/stocks/format";
import { AnalystTargets, CashFlowChart, ForecastLedger, ForecastSeries, ImpliedMoveBands, IvTermCurve, PriceChart, StrikeLadder } from "@/components/stocks/charts";
import { impliedMoves, yearsBetween, type HorizonRequest } from "@/lib/implied-move";
import { easternCloseIso, easternDate, nextWeekday } from "@/lib/market-time";
import { Chip, Empty, Meter, Note, Panel, RangeBar, Row, Skeleton, SkeletonStats, Stat, StatGrid } from "@/components/stocks/ui";
import type { Resource } from "@/components/stocks/data";
import type {
  AnalystData,
  CatalystData,
  OptionBridgeData,
  OwnershipData,
  ProfileData,
  StockData,
} from "@/components/stocks/types";

/* =========================================================== price & trend */

export function PricePanel({ stock }: { stock: StockData }) {
  const technical = stock.technicals;
  const position = guardedRatio(
    stock.price !== null && technical.low52w !== null ? stock.price - technical.low52w : null,
    technical.high52w !== null && technical.low52w !== null ? technical.high52w - technical.low52w : null,
    Number.POSITIVE_INFINITY,
  );

  return (
    <Panel
      title="Price"
      span="full"
      meta={`${stock.priceHistory.length} sessions · ${usd(technical.low52w)}–${usd(technical.high52w)} 52w`}
    >
      <PriceChart stock={stock} />
      <StatGrid columns={4}>
        <Stat label="52-week position" value={position === null ? "—" : `${Math.round(Math.max(0, Math.min(1, position)) * 100)}%`} note="of the annual range" />
        <Stat label="RSI (14)" value={technical.rsi14 === null ? "—" : technical.rsi14.toFixed(0)} note="30 oversold · 70 overbought" />
        <Stat label="Realized vol" value={rate(technical.volatility20)} note="20-day annualized" />
        <Stat label="ATR / price" value={rate(guardedPercent(stock.atr14, stock.price))} note="14-session range" />
      </StatGrid>
    </Panel>
  );
}

/**
 * A compact research readout. It keeps timing, valuation, quality, estimates,
 * and the options market separate so a stretched chart is never presented as
 * a valuation call (or vice versa).
 */
export function SignalsPanel({
  stock,
  options,
  analyst,
}: {
  stock: StockData;
  options: Resource<OptionBridgeData>;
  analyst: Resource<AnalystData>;
}) {
  const a = stock.fundamentals?.annual;
  const ttm = stock.fundamentals?.ttm;
  const technical = stock.technicals;
  const fcf = freeCashFlow(ttm?.operatingCashFlow, ttm?.capex) ?? freeCashFlow(a?.operatingCashFlow, a?.capex);
  const shares = a?.shares ?? a?.dilutedShares ?? null;
  const equityValue = stock.price !== null && shares ? stock.price * shares : null;
  const fcfYield = guardedPercent(fcf, equityValue);
  const forward = analyst.data?.fiscalYears?.find((row) => row.forecast) ?? null;
  const targetUpside = guardedPercent(
    analyst.data?.average !== null && analyst.data?.average !== undefined && stock.price !== null
      ? analyst.data.average - stock.price
      : null,
    stock.price,
  );
  const trend = technical.rsi14 === null ? "Unavailable" : technical.rsi14 <= 30 ? "Oversold" : technical.rsi14 >= 70 ? "Overbought" : "Neutral";
  const trendTone = trend === "Oversold" ? "down" : trend === "Overbought" ? "warn" : "quiet" as const;
  const operatingMargin = guardedPercent(a?.operatingIncome, a?.revenue);
  const investedCapital = a?.equity !== null && a?.equity !== undefined && a?.debt !== null && a?.debt !== undefined
    ? a.equity + a.debt - (a.cash ?? 0) : null;
  const roic = guardedPercent(a?.operatingIncome, investedCapital);
  const front = options.data?.surface[0] ?? null;

  return (
    <Panel title="Research signals" span="full" meta="separate lenses, not a trade verdict" caption="Read the evidence by question: timing, valuation, business quality, estimates, then what options are pricing.">
      <div className="sw-signal-grid">
        <article className="sw-signal">
          <header><span>Technical stretch</span><Chip tone={trendTone}>{trend}</Chip></header>
          <strong>{technical.rsi14 === null ? "—" : technical.rsi14.toFixed(0)}</strong>
          <p>RSI (14) · {technical.rsi14 === null ? "not enough closes" : trend === "Oversold" ? "below 30" : trend === "Overbought" ? "above 70" : "inside 30–70"}</p>
          <Row label="vs 20-day average" value={rate(guardedPercent(stock.price !== null && technical.sma20 !== null ? stock.price - technical.sma20 : null, technical.sma20))} />
          <Row label="52-week position" value={rate(guardedPercent(stock.price !== null && technical.low52w !== null ? stock.price - technical.low52w : null, technical.high52w !== null && technical.low52w !== null ? technical.high52w - technical.low52w : null))} />
        </article>
        <article className="sw-signal">
          <header><span>Cash-flow valuation</span><Chip tone="quiet">reported</Chip></header>
          <strong>{multiple(guardedRatio(equityValue, fcf, 1000))}</strong>
          <p>price / free cash flow · TTM when available</p>
          <Row label="FCF yield" value={rate(fcfYield)} />
          <Row label="Analyst target gap" value={pct(targetUpside)} />
        </article>
        <article className="sw-signal">
          <header><span>Business quality</span><Chip tone="quiet">filing</Chip></header>
          <strong>{rate(operatingMargin)}</strong>
          <p>operating margin · latest annual filing</p>
          <Row label="Return on capital" value={rate(roic)} />
          <Row label="Net debt / FCF" value={multiple(guardedRatio(a?.debt !== null && a?.debt !== undefined && a?.cash !== null && a?.cash !== undefined ? a.debt - a.cash : null, fcf, 1000))} />
        </article>
        <article className="sw-signal">
          <header><span>Street & options</span><Chip tone={front ? "quiet" : "warn"}>{front ? "live surface" : "unavailable"}</Chip></header>
          <strong>{front?.atmIv === null || front?.atmIv === undefined ? "—" : rate(front.atmIv * 100)}</strong>
          <p>front ATM IV · market-priced uncertainty</p>
          <Row label="IV percentile" value={options.data?.ivRank === null || options.data?.ivRank === undefined ? "—" : rate(options.data.ivRank, 0)} note="constant DTE, 20+ sessions" />
          <Row label="Target revision" value={usd(analyst.data?.revision?.targetChange ?? null)} note={analyst.data?.revision?.comparedTo ? "since prior observation" : "history begins on first read"} />
          <Row label="Revenue outlook" value={pct(forward?.revenueGrowth ?? null)} />
          <Row label="EPS outlook" value={pct(forward?.epsGrowth ?? null)} />
        </article>
      </div>
      <Note>“Undervalued” and “overvalued” need a valuation range, not one multiple. Use the Value tab to adjust the cash-flow assumptions. Estimate revisions and IV percentile need dated history; this terminal shows the current published forecast and current option surface until that history is collected.</Note>
    </Panel>
  );
}

/** The near-the-money book, with the walls drawn on the strikes they sit at. */
export function BookPanel({ stock, options }: { stock: StockData; options: Resource<OptionBridgeData> }) {
  return (
    <Panel
      title="Book by strike"
      span="full"
      meta={
        options.data
          ? `spot ${usd(stock.price ?? options.data.spot)} · ${dateShort(options.data.timestamp)}`
          : options.state === "loading"
            ? "loading"
            : null
      }
    >
      {options.state === "loading" && !options.data ? (
        <Skeleton rows={8} />
      ) : !options.data ? (
        <Empty>{options.error ?? "No option snapshot is available for this ticker."}</Empty>
      ) : (
        <StrikeLadder options={options.data} spot={stock.price ?? options.data.spot} />
      )}
    </Panel>
  );
}

/** At-the-money volatility across the listed expiries. */
export function TermStructurePanel({ options }: { options: Resource<OptionBridgeData> }) {
  return (
    <Panel title="Volatility term structure" meta={options.data ? `${options.data.surface.length} expiries` : null}>
      {options.state === "loading" && !options.data ? (
        <Skeleton rows={5} />
      ) : !options.data ? (
        <Empty>{options.error ?? "No volatility surface is available."}</Empty>
      ) : (
        <IvTermCurve options={options.data} />
      )}
    </Panel>
  );
}

export function RelativeStrengthPanel({ stock }: { stock: StockData }) {
  return (
    <Panel title="Relative strength" meta={`vs ${stock.benchmark}, its sector — not the index`}>
      <table className="sw-table sw-table--compact">
        <thead>
          <tr>
            <th scope="col">Window</th>
            <th scope="col" className="sw-num">Return</th>
            <th scope="col" className="sw-num">vs QQQ</th>
            <th scope="col" className="sw-num">vs {stock.benchmark}</th>
          </tr>
        </thead>
        <tbody>
          {stock.relativeStrength.map((row) => (
            <tr key={row.periods}>
              <th scope="row">{row.periods === 5 ? "1 week" : row.periods === 20 ? "1 month" : "3 months"}</th>
              <td className={`sw-num is-${tone(row.stockReturn)}`}>{pct(row.stockReturn)}</td>
              <td className={`sw-num is-${tone(row.versusQqq)}`}>{pct(row.versusQqq)}</td>
              <td className={`sw-num is-${tone(row.versusSector)}`}>{pct(row.versusSector)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/* ========================================================= options & flow */

export function FlowPanel({ stock, options }: { stock: StockData; options: Resource<OptionBridgeData> }) {
  const flow = options.data?.flow ?? null;

  return (
    <Panel
      title="Options activity"
      meta={options.data?.stale ? <Chip tone="warn">saved snapshot</Chip> : options.state === "loading" ? "loading" : options.data?.provider === "nasdaq" ? <Chip tone="warn">Nasdaq fallback</Chip> : flow?.session ?? null}
      caption="Ranked by extrinsic premium. Open interest separates opened trades from closed."
    >
      {options.state === "loading" && !flow ? (
        <>
          <SkeletonStats columns={4} />
          <Skeleton rows={4} />
        </>
      ) : !flow ? (
        <Empty>
          {options.error ?? `No option activity is available for ${stock.symbol}.`}
        </Empty>
      ) : (
        <>
          <StatGrid columns={4}>
            <Stat label="Call premium" value={money(flow.summary.callNotional)} />
            <Stat label="Put premium" value={money(flow.summary.putNotional)} />
            <Stat label="Opened" value={money(flow.summary.openedNotional)} note="confirmed by open interest" />
            <Stat label="Contracts" value={count(flow.summary.contracts)} note={flow.summary.resolved ? "OI resolved" : "OI pending"} />
          </StatGrid>

          {flow.summary.callNotional + flow.summary.putNotional > 0 ? (
            <div className="sw-balance">
              <span>Call share of premium</span>
              <Meter
                value={flow.summary.callNotional / (flow.summary.callNotional + flow.summary.putNotional)}
                tone={flow.summary.callNotional >= flow.summary.putNotional ? "up" : "down"}
                label="share of premium in calls"
              />
              <strong>{rate(guardedPercent(flow.summary.callNotional, flow.summary.callNotional + flow.summary.putNotional))}</strong>
            </div>
          ) : null}

          {flow.rows.length ? (
            <table className="sw-table sw-table--compact">
              <thead>
                <tr>
                  <th scope="col">Contract</th>
                  <th scope="col">Expiry</th>
                  <th scope="col" className="sw-num">Volume</th>
                  <th scope="col">Intent</th>
                  <th scope="col" className="sw-num">Extrinsic</th>
                </tr>
              </thead>
              <tbody>
                {flow.rows.slice(0, 8).map((row) => (
                  <tr key={row.contract}>
                    <th scope="row">{row.strike.toLocaleString()} {row.type === "call" ? "C" : "P"}</th>
                    <td>{row.expiry}</td>
                    <td className="sw-num">{row.volume.toLocaleString()}</td>
                    <td>
                      <Chip tone={row.intent === "opened" ? "up" : row.intent === "closed" ? "down" : "quiet"}>{row.intent}</Chip>
                    </td>
                    <td className="sw-num">{money(row.extrinsicNotional)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No large premium was recorded in this session.</Empty>
          )}
          <Note>{options.data?.coverageNote ? `${options.data.coverageNote} ${flow.caveat}` : flow.caveat}</Note>
        </>
      )}
    </Panel>
  );
}

export function LevelsPanel({ stock, options }: { stock: StockData; options: Resource<OptionBridgeData> }) {
  const data = options.data;
  const expected = data?.expectedMove ?? null;
  const low = expected && stock.price !== null ? stock.price - expected.dollars : null;
  const high = expected && stock.price !== null ? stock.price + expected.dollars : null;

  return (
    <Panel title="Option levels" meta={data?.timestamp ? dateShort(data.timestamp) : options.state === "loading" ? "loading" : null}>
      {options.state === "loading" && !data ? (
        <SkeletonStats columns={4} />
      ) : !data ? (
        <Empty>{options.error ?? "No option snapshot is available for this ticker."}</Empty>
      ) : (
        <>
          {/* The front-expiry move has its own panel now, with the longer
              horizons beside it, so this one stays on the structure. */}
          <StatGrid columns={4}>
            <Stat label="Gamma flip" value={usd(data.levels.gammaFlip)} note="sign change in dealer gamma" />
            <Stat label="Call wall" value={usd(data.levels.callWall)} />
            <Stat label="Put wall" value={usd(data.levels.putWall)} />
            <Stat label="Max pain" value={usd(data.levels.maxPain)} note="least option value at expiry" />
          </StatGrid>
          {low !== null && high !== null ? (
            <div className="sw-implied">
              <RangeBar
                low={Math.min(low, stock.price ?? low)}
                high={Math.max(high, stock.price ?? high)}
                markers={[
                  { value: low, label: "Implied low", kind: "band" },
                  { value: stock.price, label: "Last", kind: "current" },
                  { value: high, label: "Implied high", kind: "band" },
                ]}
              />
              <span>{usd(low)} to {usd(high)} implied by the front expiry</span>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

/**
 * What the option market is pricing over three horizons.
 *
 * Each row is priced off the listed expiries that bracket it. A horizon the
 * book does not reach is left blank: extending the curve past the last quote
 * would produce a number indistinguishable from a real one.
 */
export function ImpliedMovePanel({ stock, options }: { stock: StockData; options: Resource<OptionBridgeData> }) {
  const data = options.data;
  const spot = stock.price ?? data?.spot ?? null;

  const rows = (() => {
    if (!data || spot === null) return [];
    // Measured from the snapshot the surface was captured at, not the wall
    // clock, so reading a saved chain does not restate every expiry as nearer
    // than it was.
    const from = Date.parse(data.timestamp);
    if (!Number.isFinite(from)) return [];

    const sessionDate = easternDate(new Date(from));
    const nextSessionClose = easternCloseIso(nextWeekday(sessionDate));
    const nextSessionYears = nextSessionClose ? yearsBetween(from, Date.parse(nextSessionClose)) : null;

    const horizons: HorizonRequest[] = [
      ...(nextSessionYears && nextSessionYears > 0
        ? [{ label: "Next session", years: nextSessionYears }]
        : []),
      { label: "1 month", years: 30 / 365 },
      { label: "1 year", years: 1 },
    ];
    return impliedMoves(data.surface, spot, horizons);
  })();

  const priced = rows.filter((row) => row.move);

  return (
    <Panel
      title="Implied moves"
      span="full"
      meta={data ? `from ${data.surface.length} listed expiries · ${dateShort(data.timestamp)}` : options.state === "loading" ? "loading" : null}
      caption="One standard deviation either side of the last price — roughly two sessions in three land inside the band."
    >
      {options.state === "loading" && !data ? (
        <SkeletonStats columns={3} />
      ) : !rows.length ? (
        <Empty>{options.error ?? "No volatility surface is available for this ticker."}</Empty>
      ) : (
        <>
          <table className="sw-table sw-table--compact">
            <thead>
              <tr>
                <th scope="col">Horizon</th>
                <th scope="col" className="sw-num">Implied move</th>
                <th scope="col" className="sw-num">Percent</th>
                <th scope="col" className="sw-num">Range</th>
                <th scope="col" className="sw-num">ATM IV</th>
                <th scope="col">Priced from</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ requested, move }) => (
                <tr key={requested.label}>
                  <th scope="row">
                    {requested.label}
                    <small>{Math.round(requested.years * 365)} days</small>
                  </th>
                  {move ? (
                    <>
                      <td className="sw-num">±{usd(move.dollars)}</td>
                      <td className="sw-num">±{rate(move.percent)}</td>
                      <td className="sw-num">{usd(move.lower)} – {usd(move.upper)}</td>
                      <td className="sw-num">{rate(move.iv * 100)}</td>
                      <td>
                        <span className="sw-quiet">{move.expiries.join(" → ")}</span>
                        {move.basis === "interpolated" ? <Chip tone="quiet">interpolated</Chip> : null}
                      </td>
                    </>
                  ) : (
                    <td colSpan={5}>
                      <span className="sw-quiet">
                        No listed expiry reaches this horizon, so it is not priced.
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {priced.length ? (
            <ImpliedMoveBands spot={spot!} moves={priced.map((row) => row.move!)} />
          ) : null}

          <Note>
            At-the-money volatility only, so the band is symmetric and ignores skew — a real distribution is not. Interpolated rows
            sit between two listed expiries and are read in total variance. This is a magnitude the market is charging for, not a
            forecast of direction.
          </Note>
        </>
      )}
    </Panel>
  );
}

/* ============================================================== the filing */

export function SecPanel({ stock }: { stock: StockData }) {
  const fundamentals = stock.fundamentals;
  const annual = fundamentals?.annual;
  const year = fiscalYear(annual?.periodEnd);

  if (!fundamentals) {
    return (
      <Panel title="SEC filing" meta="loading">
        <SkeletonStats columns={3} />
      </Panel>
    );
  }

  return (
    <Panel
      title="SEC filing"
      meta={
        <>
          {year ? <Chip tone="quiet">{year}</Chip> : null}
          {fundamentals.stale ? <Chip tone="warn">saved</Chip> : null}
          <span>{annual?.filed ? `filed ${dateShort(annual.filed)}` : "filing date unavailable"}</span>
        </>
      }
      caption={annual?.periodEnd ? `Year ended ${dateShort(annual.periodEnd)}. Reported, not estimated.` : undefined}
    >
      <StatGrid columns={4}>
        <Stat label="Revenue" value={money(annual?.revenue ?? null)} />
        <Stat label="Net income" value={money(annual?.netIncome ?? null)} />
        <Stat label="Operating cash flow" value={money(annual?.operatingCashFlow ?? null)} />
        <Stat label="Capital expenditure" value={money(annual?.capex ?? null)} />
        <Stat label="Cash" value={money(annual?.cash ?? null)} />
        <Stat label="Debt" value={money(annual?.debt ?? null)} />
        <Stat label="Shares outstanding" value={count(annual?.shares ?? null)} note="cover-page count" />
        <Stat label="Diluted EPS" value={usd(annual?.dilutedEps ?? null)} />
      </StatGrid>
      <Note>
        {fundamentals.source}
        {fundamentals.stale ? " · saved snapshot" : ""}. One fiscal year throughout; an untagged line stays blank.
      </Note>
    </Panel>
  );
}

export function QualityPanel({ stock }: { stock: StockData }) {
  const a = stock.fundamentals?.annual;
  if (!a) {
    return (
      <Panel title="Business quality" meta="loading">
        <SkeletonStats columns={4} />
      </Panel>
    );
  }
  const margin = (value: number | null | undefined) => rate(guardedPercent(value ?? null, a.revenue));
  const roa = guardedPercent(a.netIncome, a.assets);
  const roe = guardedPercent(a.netIncome, a.equity);
  const investedCapital = a.equity !== null && a.debt !== null ? a.equity + a.debt - (a.cash ?? 0) : null;
  const roic = guardedPercent(a.operatingIncome, investedCapital);
  const current = guardedRatio(a.currentAssets, a.currentLiabilities);
  const quick = guardedRatio(a.currentAssets === null ? null : a.currentAssets - (a.inventory ?? 0), a.currentLiabilities);

  return (
    <Panel
      title="Business quality"
      meta={fiscalYear(a.periodEnd) ? <Chip tone="quiet">{fiscalYear(a.periodEnd)}</Chip> : null}
    >
      <StatGrid columns={4}>
        <Stat label="Gross margin" value={margin(a.grossProfit)} note="gross profit / revenue" />
        <Stat label="Operating margin" value={margin(a.operatingIncome)} note="operating income / revenue" />
        <Stat label="Net margin" value={margin(a.netIncome)} note="net income / revenue" />
        <Stat label="ROE" value={rate(roe)} note="return on equity" />
        <Stat label="ROA" value={rate(roa)} note="return on assets" />
        <Stat label="ROIC" value={rate(roic)} note="operating income / invested capital" />
        <Stat label="Current / quick" value={`${current === null ? "—" : current.toFixed(1)} / ${quick === null ? "—" : quick.toFixed(1)}`} note="liquidity" />
        <Stat label="Debt / equity" value={guardedRatio(a.debt, a.equity) === null ? "—" : guardedRatio(a.debt, a.equity)!.toFixed(2)} />
      </StatGrid>
    </Panel>
  );
}

/* ================================================================ metrics */

export function MetricsPanel({ stock, options }: { stock: StockData; options: Resource<OptionBridgeData> }) {
  const annual = stock.fundamentals?.annual;
  const ttm = stock.fundamentals?.ttm;
  const fcf = freeCashFlow(ttm?.operatingCashFlow, ttm?.capex) ?? freeCashFlow(annual?.operatingCashFlow, annual?.capex);
  const fcfMargin = guardedPercent(fcf, annual?.revenue);
  const cashConversion = guardedRatio(annual?.operatingCashFlow, annual?.netIncome);
  // Cash and marketable securities both, against the whole debt balance. Counting
  // only cash reported Apple as $54.7B in net debt on the same page the valuation
  // bridge showed $41.7B of net cash, because $96B of securities were invisible
  // to one and not the other.
  const netDebt =
    annual?.debt !== null && annual?.debt !== undefined && annual.cash !== null && annual.cash !== undefined
      ? annual.debt - annual.cash - (annual.investments ?? 0)
      : null;
  const sectorMonth = stock.relativeStrength.find((row) => row.periods === 20)?.versusSector ?? null;
  const frontIv = options.data?.surface[0]?.atmIv ?? null;

  const shares = annual?.shares ?? annual?.dilutedShares ?? null;
  const equityValue = stock.price !== null && shares ? stock.price * shares : null;
  const enterpriseValue = equityValue !== null && netDebt !== null ? equityValue + netDebt : null;

  return (
    <Panel title="Metrics">
      <StatGrid columns={4}>
        {/* The most-quoted number in equities, and it was computed here for the
            ratios below without ever being shown. */}
        <Stat label="Market cap" value={money(equityValue)} note={shares ? `${count(shares)} shares × last close` : "share count unavailable"} />
        <Stat label="Sector relative" value={pct(sectorMonth)} note={`1 month vs ${stock.benchmark}`} tone={tone(sectorMonth)} />
        <Stat
          label="Beta"
          value={stock.beta60 === null ? "—" : stock.beta60.toFixed(2)}
          note={
            stock.beta60Correlation === null || stock.beta60Correlation === undefined
              ? `60-day vs ${stock.benchmark}`
              : `60-day vs ${stock.benchmark} · r ${stock.beta60Correlation.toFixed(2)}${Math.abs(stock.beta60Correlation) < 0.3 ? " — too weak to rely on" : ""}`
          }
        />
        <Stat label="Gap risk" value={rate(stock.gapRisk60.average)} note={`avg overnight · p90 ${rate(stock.gapRisk60.p90)}`} />
        <Stat label="Front IV" value={frontIv === null ? "—" : rate(frontIv * 100)} note={options.data?.surface[0]?.expiry ?? "no option snapshot"} />
        <Stat label="TTM FCF margin" value={rate(fcfMargin)} note={ttm?.source ? "TTM filings" : "latest annual filing"} tone={tone(fcfMargin)} />
        <Stat label="Net debt" value={money(netDebt)} note={netDebt !== null && netDebt <= 0 ? "net cash and securities" : "debt less cash and securities"} tone={netDebt === null ? undefined : netDebt <= 0 ? "up" : "flat"} />
        <Stat label="EV / FCF" value={multiple(guardedRatio(enterpriseValue, fcf, 1000))} note="equity value plus net debt" />
      </StatGrid>

      <details className="sw-details">
        <summary>Full metric ledger</summary>
        <div className="sw-ledger">
          <Row label="P / earnings" value={multiple(guardedRatio(equityValue, annual?.netIncome, 1000))} note="price / reported net income" />
          <Row label="P / free cash flow" value={multiple(guardedRatio(equityValue, fcf, 1000))} note={ttm?.source ? "TTM cash flow" : "annual cash flow"} />
          <Row label="Cash conversion" value={multiple(cashConversion, 2)} note="operating cash flow / net income" />
          <Row label="Stock compensation" value={money(annual?.stockCompensation ?? null)} note="reported non-cash compensation" />
          <Row label="52-week range" value={`${usd(stock.technicals.low52w)} – ${usd(stock.technicals.high52w)}`} note="intraday high and low" />
          <Row label="Swing 20-day" value={`${usd(stock.swingLow20)} – ${usd(stock.swingHigh20)}`} note="intraday extremes" />
          <Row label="Max pain" value={usd(options.data?.levels.maxPain ?? null)} note="modeled option level" />
        </div>
      </details>

      <Note>Quote depth and trade prints need a licensed feed and stay blank.</Note>
    </Panel>
  );
}

/* ============================================== company profile and dividend */

/** Whole days from today to a calendar date, or null when it is not a date. */
function daysUntil(date: string | null | undefined) {
  if (!date) return null;
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = new Date();
  const midnight = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - midnight) / 86_400_000);
}

/** "in 12 days", "tomorrow", "today", or "14 days ago" for a date already past. */
function whenPhrase(days: number | null) {
  if (days === null) return undefined;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${plural(days, "day")}`;
  if (days === -1) return "yesterday";
  return `${plural(Math.abs(days), "day")} ago`;
}

/**
 * What the company is, when it next reports, and what it pays.
 *
 * The three facts a retail quote page opens with and this workstation had
 * nowhere. The earnings date is the one that changes how a position is sized,
 * so it leads and carries its own countdown.
 */
export function CompanyPanel({ stock, profile }: { stock: StockData; profile: Resource<ProfileData> }) {
  const data = profile.data;
  const shares = stock.fundamentals?.annual.shares ?? stock.fundamentals?.annual.dilutedShares ?? null;
  const marketCap = stock.price !== null && shares ? stock.price * shares : null;
  const earningsIn = daysUntil(data?.earningsDate);

  if (profile.state === "loading") {
    return (
      <Panel title="Company" span="full" meta="loading">
        <SkeletonStats columns={4} />
      </Panel>
    );
  }

  return (
    <Panel
      title="Company"
      span="full"
      meta={
        <>
          {data?.stale ? <Chip tone="warn">saved</Chip> : null}
          {stock.fundamentals?.company ? <span>{stock.fundamentals.company}</span> : null}
        </>
      }
    >
      {!data ? (
        <Empty>{profile.error ?? "No published profile was found for this ticker."}</Empty>
      ) : (
        <>
          <StatGrid columns={4}>
            <Stat label="Market cap" value={money(marketCap)} note={shares ? `${count(shares)} shares` : "share count unavailable"} />
            <Stat
              // The publisher states the most recent date until the next one is
              // confirmed, so the label has to follow the date rather than
              // announce a report that already happened as upcoming.
              label={earningsIn !== null && earningsIn < 0 ? "Last earnings" : "Next earnings"}
              value={data.earningsDate ? dateShort(data.earningsDate) : "—"}
              note={whenPhrase(earningsIn) ?? "no date published"}
              // An earnings date inside the week is the single fact most likely
              // to change what a reader does next, so it is coloured as a warning
              // rather than left to be read off a date.
              tone={earningsIn !== null && earningsIn >= 0 && earningsIn <= 7 ? "down" : undefined}
            />
            <Stat
              label="Dividend"
              value={data.dividend !== null && data.dividend !== undefined ? `${usd(data.dividend)}` : "none"}
              note={
                data.dividendYield !== null && data.dividendYield !== undefined
                  ? `${rate(data.dividendYield, 2)} yield, annual`
                  : "no dividend published"
              }
            />
            <Stat
              label="Forward P/E"
              value={data.forwardPe === null || data.forwardPe === undefined ? "—" : multiple(data.forwardPe)}
              note={data.peRatio === null || data.peRatio === undefined ? "on consensus earnings" : `${multiple(data.peRatio)} trailing`}
            />
          </StatGrid>
          {data.description ? <p className="sw-prose">{data.description}</p> : null}
          <Note>
            <a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source ?? "public profile"}</a>
            {data.checkedAt ? ` · checked ${dateShort(data.checkedAt)}` : ""}. Market cap is computed here from the filed share
            count and the last close, not taken from the page.
          </Note>
        </>
      )}
    </Panel>
  );
}

/**
 * The payout record, not just the yield.
 *
 * Buyback yield sits beside the dividend because a company retiring stock is
 * returning capital just as a cheque does, and a panel showing only the
 * dividend makes an issuer that does the former look like it returns nothing.
 */
export function DividendPanel({ profile }: { profile: Resource<ProfileData> }) {
  const data = profile.data;
  const detail = data?.dividendDetail ?? null;
  const paysDividend = (detail?.annualDividend ?? data?.dividend ?? null) !== null;
  const buysBack = (detail?.buybackYield ?? null) !== null;
  if (profile.state !== "loading" && !paysDividend && !buysBack) return null;

  const exIn = daysUntil(detail?.exDividendDate ?? data?.exDividendDate);

  return (
    <Panel title="Shareholder returns" meta={detail?.payoutFrequency ? <Chip tone="quiet">{detail.payoutFrequency.toLowerCase()}</Chip> : null}>
      {profile.state === "loading" ? (
        <SkeletonStats columns={4} />
      ) : (
        <>
          <StatGrid columns={4}>
            <Stat
              label="Dividend yield"
              value={rate(detail?.dividendYield ?? data?.dividendYield ?? null, 2)}
              note={usd(detail?.annualDividend ?? data?.dividend ?? null) + " a year"}
            />
            <Stat
              label="Ex-dividend date"
              value={detail?.exDividendDate || data?.exDividendDate ? dateShort(detail?.exDividendDate ?? data?.exDividendDate) : "—"}
              note={whenPhrase(exIn) ?? "buy before this date to receive it"}
            />
            <Stat
              label="Payout ratio"
              value={rate(detail?.payoutRatio ?? null)}
              note="of earnings paid out"
              tone={detail?.payoutRatio !== null && detail?.payoutRatio !== undefined && detail.payoutRatio > 90 ? "down" : undefined}
            />
            <Stat
              label="Raised for"
              value={detail?.growthYears ? plural(detail.growthYears, "year") : "—"}
              note={detail?.growth1Y !== null && detail?.growth1Y !== undefined ? `${pct(detail.growth1Y)} last raise` : "consecutive increases"}
            />
          </StatGrid>
          {buysBack ? (
            <div className="sw-ledger">
              <Row label="Buyback yield" value={rate(detail?.buybackYield ?? null, 2)} note="stock retired over the last year" />
              <Row label="Shareholder yield" value={rate(detail?.shareholderYield ?? null, 2)} note="dividend and buyback together" />
            </div>
          ) : null}
          <Note>Ex-dividend date is when the stock trades without the next payment, which is also when it opens lower by roughly that amount.</Note>
        </>
      )}
    </Panel>
  );
}

/**
 * Which way the estimates are moving, which is the half of the consensus that
 * carries information.
 *
 * The target level says almost nothing on its own: it is anchored to the price
 * and revised slowly, so the gap between target and price widens by itself
 * whenever a stock falls. Every broken name screens as having enormous upside.
 * The revision is what separates a business the street still believes in from
 * one it is quietly marking down, and it only exists once this workstation has
 * watched the same ticker on two different days.
 */
export function RevisionPanel({ analyst }: { analyst: Resource<AnalystData> }) {
  const trend = analyst.data?.trend ?? null;
  const windows = trend?.windows.filter((window) => window.comparedTo) ?? [];

  return (
    <Panel
      title="Estimate revisions"
      span="full"
      meta={trend?.since ? `watching since ${dateShort(trend.since)} · ${plural(trend.points.length, "observation")}` : null}
      caption="A target that has not moved while the price fell is not upside. This is whether the estimates behind it are rising or being cut."
    >
      {analyst.state === "loading" ? (
        <SkeletonStats columns={3} />
      ) : !windows.length ? (
        <Empty>
          {trend?.points.length
            ? "Only one dated observation is held so far, so there is nothing to compare it against. A second reading on a later day starts the series."
            : "No dated history yet. Each visit records one observation a day; run the daily collector to build the series without opening the page."}
        </Empty>
      ) : (
        <>
          <StatGrid columns={3}>
            {windows.map((window) => (
              <Stat
                key={window.label}
                label={window.label}
                value={window.epsPercent === null ? (window.targetPercent === null ? "—" : pct(window.targetPercent)) : pct(window.epsPercent)}
                tone={tone(window.epsPercent ?? window.targetPercent)}
                note={
                  window.epsPercent === null
                    ? `price target, from ${dateShort(window.comparedTo)}`
                    : `consensus EPS, from ${dateShort(window.comparedTo)}`
                }
              />
            ))}
          </StatGrid>
          <div className="sw-ledger">
            {windows.map((window) => (
              <Row
                key={window.label}
                label={`${window.label} detail`}
                value={`${window.targetChange === null ? "—" : usd(window.targetChange)} target · ${window.epsChange === null ? "—" : usd(window.epsChange)} EPS`}
                note={window.analystChange ? `${window.analystChange > 0 ? "+" : ""}${window.analystChange} analysts covering` : "coverage unchanged"}
              />
            ))}
          </div>
          <Note>
            Earnings estimates are only compared when both readings describe the same fiscal year; when the consensus rolls forward to
            the next year the comparison is dropped rather than reported as a revision. Five numbers are kept per ticker per day.
          </Note>
        </>
      )}
    </Panel>
  );
}

/**
 * Strikes priced away from the volatility curve around them.
 *
 * There is a popular claim that a strike whose implied volatility spikes above
 * its neighbours is a level dealers defend, and that this beats gamma exposure
 * for precision. The mechanism in that claim does not exist: open interest does
 * not raise a strike's volatility, because open interest does not record which
 * side initiated. Overwriting flow builds enormous open interest by selling
 * calls, which leaves dealers long and quoting that strike cheaper — the same
 * size, the opposite sign. And hedging pressure is a gamma quantity, which is
 * what the walls on the levels panel already measure.
 *
 * What survives is narrower and still useful: a strike priced away from the
 * fitted smile is evidence that somebody wanted that particular contract. This
 * panel reports that and refuses to dress it up as anything else.
 */
export function VolDislocationPanel({ options }: { options: Resource<OptionBridgeData> }) {
  const view = options.data?.volDislocation ?? null;

  if (options.state === "loading") {
    return (
      <Panel title="Strike vol dislocation" span="full" meta="loading">
        <SkeletonStats columns={3} />
      </Panel>
    );
  }

  return (
    <Panel
      title="Strike vol dislocation"
      span="full"
      meta={view ? `${view.expiry} · ${plural(view.readable, "readable strike")}` : null}
      caption="Where one strike is priced away from the volatility curve fitted through its neighbours. Demand for a contract, not pressure on the underlying."
    >
      {!view ? (
        <Empty>{options.error ?? "No option chain is available for this ticker."}</Empty>
      ) : !view.strikes.length ? (
        <Empty>
          Every readable strike sits on its own curve, within {rate(view.noise * 2.5, 1)} of the fit. Nothing here is priced unusually
          — which is the ordinary case, and a panel that always finds something would be finding noise.
        </Empty>
      ) : (
        <>
          <table className="sw-table sw-table--compact">
            <thead>
              <tr>
                <th scope="col">Strike</th>
                <th scope="col" className="sw-num">Implied vol</th>
                <th scope="col" className="sw-num">Curve</th>
                <th scope="col" className="sw-num">Away by</th>
                <th scope="col" className="sw-num">Open interest</th>
                <th scope="col" className="sw-num">Volume</th>
                <th scope="col" className="sw-num">Quote precision</th>
              </tr>
            </thead>
            <tbody>
              {view.strikes.map((row) => (
                <tr key={row.strike}>
                  <th scope="row">{usd(row.strike)}</th>
                  <td className="sw-num">{rate(row.iv)}</td>
                  <td className="sw-num sw-quiet">{rate(row.fitted)}</td>
                  {/* Richer than the curve is not bullish and cheaper is not
                      bearish, so the sign is coloured as neutral emphasis
                      rather than as a direction. */}
                  <td className="sw-num"><Chip tone={Math.abs(row.residual) >= view.noise * 4 ? "warn" : "neutral"}>{pct(row.residual)}</Chip></td>
                  <td className="sw-num">{count(row.openInterest)}</td>
                  <td className="sw-num">{count(row.volume)}</td>
                  {/* Vol points the bid-ask cannot resolve — the figure that
                      decides whether the strike was readable at all. */}
                  <td className="sw-num sw-quiet">±{row.ivUncertainty.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <StatGrid columns={3}>
            <Stat label="Curve noise" value={rate(view.noise, 2)} note="typical distance from the fit, in vol points" />
            <Stat label="Readable strikes" value={String(view.readable)} note="quoted tightly enough to trust" />
            <Stat
              label="Discarded"
              value={String(view.rejected.total)}
              note={`${view.rejected.illiquid} too thin · ${view.rejected.unquoted} unquoted`}
            />
          </StatGrid>
        </>
      )}

      <Note>
        Read as demand for a contract, not as support or resistance. A wide market read at its midpoint prints a volatility that looks
        like a spike and is really an absence of quotes, so strikes with thin or crossed markets are discarded rather than reported —
        that is what the discarded count is. Dealer hedging pressure is a gamma quantity and lives on the option levels panel.
      </Note>
    </Panel>
  );
}

/* ============================================ deterioration and base rates */

type TrapFlag = { label: string; verdict: "clear" | "watch" | "flag" | "unknown"; detail: string };

/**
 * The five ways a cheap stock is usually cheap for a reason.
 *
 * Every check compares the latest filed year against the oldest held, and each
 * one is answerable from filings already loaded. None of them is a sell signal
 * on its own — a single year of margin compression is noise, and a company that
 * issues stock to buy something is not thereby impaired. What the panel is for
 * is the count: one flag is a question, four flags is an answer.
 */
export function ValueTrapPanel({ stock, analyst }: { stock: StockData; analyst: Resource<AnalystData> }) {
  const history = stock.fundamentals?.history ?? [];
  // Filings arrive newest first; a trend reads oldest to newest.
  const series = [...history].reverse();
  const first = series[0] ?? null;
  const last = series.at(-1) ?? null;

  const trend = (
    label: string,
    pick: (row: (typeof series)[number]) => number | null | undefined,
    { falling, unit = "%" }: { falling: "flag" | "clear"; unit?: string },
  ): TrapFlag => {
    const start = first ? pick(first) ?? null : null;
    const end = last ? pick(last) ?? null : null;
    if (start === null || end === null || !(Math.abs(start) > 0) || series.length < 3) {
      return { label, verdict: "unknown", detail: "not enough filed years" };
    }
    const change = ((end - start) / Math.abs(start)) * 100;
    const worsening = falling === "flag" ? change < -10 : change > 25;
    const watching = falling === "flag" ? change < 0 : change > 10;
    return {
      label,
      verdict: worsening ? "flag" : watching ? "watch" : "clear",
      detail: `${pct(change)} over ${plural(series.length, "filed year")}${unit === "%" ? "" : unit}`,
    };
  };

  const margin = (row: (typeof series)[number]) =>
    row.grossProfit !== null && row.grossProfit !== undefined && row.revenue ? (row.grossProfit / row.revenue) * 100 : null;
  const fcfOf = (row: (typeof series)[number]) => freeCashFlow(row.operatingCashFlow, row.capex);

  const estimateFlag = ((): TrapFlag => {
    const window = analyst.data?.trend?.windows?.find((entry) => entry.days === 91) ?? null;
    if (!window || window.epsPercent === null) {
      return { label: "Estimate direction", verdict: "unknown", detail: "no dated history yet — collected daily from here" };
    }
    return {
      label: "Estimate direction",
      verdict: window.epsPercent < -5 ? "flag" : window.epsPercent < 0 ? "watch" : "clear",
      detail: `${pct(window.epsPercent)} on ${window.label} of consensus EPS`,
    };
  })();

  const flags: TrapFlag[] = [
    trend("Revenue", (row) => row.revenue, { falling: "flag" }),
    trend("Free cash flow", fcfOf, { falling: "flag" }),
    trend("Gross margin", margin, { falling: "flag" }),
    trend("Debt", (row) => row.debt, { falling: "clear" }),
    trend("Share count", (row) => row.shares, { falling: "clear" }),
    estimateFlag,
  ];
  const raised = flags.filter((flag) => flag.verdict === "flag").length;
  const watching = flags.filter((flag) => flag.verdict === "watch").length;

  return (
    <Panel
      title="Deterioration check"
      span="full"
      meta={
        <Chip tone={raised >= 3 ? "down" : raised ? "warn" : "up"}>
          {raised ? `${raised} flagged` : watching ? `${watching} to watch` : "none flagged"}
        </Chip>
      }
      caption="A falling price is only a discount if the business behind it is intact. Each line compares the oldest filed year held against the newest."
    >
      <div className="sw-ledger">
        {flags.map((flag) => (
          <Row
            key={flag.label}
            label={flag.label}
            value={flag.verdict === "unknown" ? "—" : flag.verdict === "flag" ? "deteriorating" : flag.verdict === "watch" ? "softening" : "intact"}
            note={flag.detail}
          />
        ))}
      </div>
      <Note>
        Debt and share count are read the other way round: rising debt and a rising count are the warnings, and a shrinking count is a
        buyback. One flag is a question to answer, not a verdict.
      </Note>
    </Panel>
  );
}

/**
 * What followed the last time this stock was this beaten up.
 *
 * The distribution is the output, not an average. Whether the worst comparable
 * case was −6% or −28% is the part that decides position size.
 */
export function BaseRatePanel({ stock }: { stock: StockData }) {
  const rates = stock.baseRates ?? null;
  if (!rates) {
    return (
      <Panel title="Setup base rates" span="full">
        <Empty>Ten years of daily bars are needed to find comparable setups, and fewer are held for this ticker.</Empty>
      </Panel>
    );
  }

  return (
    <Panel
      title="Setup base rates"
      span="full"
      meta={rates.match ? `RSI ${rates.match.rsiLow.toFixed(0)}–${rates.match.rsiHigh.toFixed(0)} · ${rates.match.drawdownLow.toFixed(0)}–${rates.match.drawdownHigh.toFixed(0)}% off the high` : null}
      caption="Days in this ticker's own history that resembled today, and what the next few weeks did from there."
    >
      <StatGrid columns={3}>
        <Stat label="Today" value={rates.setup.rsi === null ? "—" : `RSI ${rates.setup.rsi.toFixed(0)}`} note={rates.setup.drawdown === null ? undefined : `${rate(rates.setup.drawdown)} below the 52-week high`} />
        <Stat label="Comparable days" value={rates.matches ? String(rates.matches) : "—"} note={rates.episodes ? `across ${plural(rates.episodes, "separate episode")}` : "no close analogue found"} />
        <Stat
          label="Resolved higher"
          value={rates.outcomes[0] ? rate(rates.outcomes[0].positiveShare, 0) : "—"}
          note={rates.outcomes[0] ? `of the ${rates.outcomes[0].horizonDays}-session outcomes` : "not enough matches"}
          tone={rates.outcomes[0] ? tone(rates.outcomes[0].positiveShare - 50) : undefined}
        />
      </StatGrid>

      {rates.outcomes.length ? (
        <table className="sw-table sw-table--compact">
          <thead>
            <tr>
              <th scope="col">Forward window</th>
              <th scope="col" className="sw-num">Worst</th>
              <th scope="col" className="sw-num">10th</th>
              <th scope="col" className="sw-num">Median</th>
              <th scope="col" className="sw-num">90th</th>
              <th scope="col" className="sw-num">Best</th>
              <th scope="col" className="sw-num">Higher</th>
            </tr>
          </thead>
          <tbody>
            {rates.outcomes.map((outcome) => (
              <tr key={outcome.horizonDays}>
                <th scope="row">{outcome.horizonDays} sessions</th>
                <td className="sw-num is-down">{pct(outcome.worst)}</td>
                <td className="sw-num">{pct(outcome.p10)}</td>
                <td className={`sw-num is-${tone(outcome.median)}`}>{pct(outcome.median)}</td>
                <td className="sw-num">{pct(outcome.p90)}</td>
                <td className="sw-num is-up">{pct(outcome.best)}</td>
                <td className="sw-num">{rate(outcome.positiveShare, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>This ticker has not been in a comparable state often enough in ten years to say anything from its own record.</Empty>
      )}

      <Note>
        Comparable days cluster: matches drawn from {rates.episodes || "a few"} separate declines overlap heavily, so the sample count
        overstates how much independent evidence there is. Ten years also covers one broad regime — nothing here has seen 2008. A
        distribution of what happened before is not a forecast of what happens next.
      </Note>
    </Panel>
  );
}

export function CashFlowHistoryPanel({ stock }: { stock: StockData }) {
  const history = stock.fundamentals?.history ?? [];
  const series = history
    .filter((row) => row.operatingCashFlow !== null && row.capex !== null)
    .slice(0, 5)
    .reverse()
    .map((row) => ({ year: row.end.slice(0, 4), value: freeCashFlow(row.operatingCashFlow, row.capex)! }))
    .filter((row) => Number.isFinite(row.value));

  return (
    <Panel title="Reported free cash flow" meta={series.length ? `${plural(series.length, "year")} of filings` : null}>
      <CashFlowChart series={series} />
    </Panel>
  );
}

/* ============================================================== positioning */

export function AnalystPanel({ stock, analyst }: { stock: StockData; analyst: Resource<AnalystData> }) {
  const data = analyst.data;
  const average = data?.average ?? null;
  const low = data?.low ?? null;
  const high = data?.high ?? null;
  const upside = guardedPercent(average !== null && stock.price !== null ? average - stock.price : null, stock.price);

  return (
    <Panel
      title="Analyst consensus"
      span="full"
      meta={data?.updated ? `updated ${data.updated}` : analyst.state === "loading" ? "loading" : null}
    >
      {analyst.state === "loading" ? (
        <SkeletonStats columns={3} />
      ) : /* Any one figure is worth showing. Requiring all of them meant a single
            unparsed number reported that no consensus existed at all. */
      !data || (average === null && low === null && high === null && !data.consensus) ? (
        <Empty>{analyst.error ?? data?.error ?? "No published consensus was found for this ticker."}</Empty>
      ) : (
        <>
          <StatGrid columns={4}>
            <Stat label="Average target" value={usd(average)} note="12-month" />
            <Stat label="Median target" value={usd(data.median ?? null)} note="half above, half below" />
            <Stat label="Versus last close" value={pct(upside)} tone={tone(upside)} note={usd(stock.price)} />
            <Stat label="Consensus" value={data.consensus ?? "—"} note={data.count ? `${plural(data.count, "analyst")}` : undefined} />
          </StatGrid>
          <AnalystTargets low={low} average={average} median={data.median ?? null} high={high} price={stock.price} />
          {low !== null && high !== null && stock.price !== null ? (
            <StatGrid columns={3}>
              <Stat label="Downside to low" value={pct(guardedPercent(low - stock.price, stock.price))} tone="down" note={usd(low)} />
              <Stat label="Spread" value={usd(high - low)} note={`${rate(guardedPercent(high - low, stock.price))} of the last close`} />
              <Stat label="Upside to high" value={pct(guardedPercent(high - stock.price, stock.price))} tone="up" note={usd(high)} />
            </StatGrid>
          ) : null}
          <Note>
            <a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source ?? "public consensus"}</a>
            {data.checkedAt ? ` · checked ${dateShort(data.checkedAt)}` : ""}. Third-party, may lag, moves independently of the filings.
          </Note>
        </>
      )}
    </Panel>
  );
}

/**
 * What the street expects the business to earn, beside what it has reported.
 *
 * The consensus target on the panel above is a price; this is the revenue and
 * per-share earnings that target is presumably built on, which is the part a
 * reader can actually disagree with.
 */
export function ForecastPanel({ analyst, stock }: { analyst: Resource<AnalystData>; stock: StockData }) {
  const data = analyst.data;
  const years = (data?.fiscalYears ?? []).filter((row) => row.revenue !== null || row.eps !== null);
  const revenueYears = years.filter((row) => row.revenue !== null);

  /**
   * Earnings per share by fiscal year, from the filings where the publisher
   * withholds them.
   *
   * The consensus page gates its own per-share history behind a subscription:
   * Apple came back with two years where revenue had six, and a two-bar chart
   * says nothing about a trajectory. The reported half is taken from the SEC
   * facts already loaded for this ticker and matched to the publisher's fiscal
   * labels by year. The two are on different bases — the filings are GAAP and
   * the estimates are the publisher's adjusted figure — which is why they stay
   * on separate rows of the ledger and why the note below says so.
   */
  const epsYears = (() => {
    const published = years.filter((row) => row.eps !== null);
    const filed = new Map(
      (stock.fundamentals?.epsHistory ?? []).map((row) => [`FY ${Number(row.end.slice(0, 4))}`, row.value]),
    );
    if (!filed.size) return published;
    const merged = years.map((row) => (row.eps === null && !row.forecast && filed.has(row.label) ? { ...row, eps: filed.get(row.label)! } : row));
    // A filed year the publisher's table does not list at all still belongs on
    // the chart, oldest first, ahead of the years it does list.
    const known = new Set(merged.map((row) => row.label));
    const extra = [...filed.entries()]
      .filter(([label]) => !known.has(label))
      .map(([label, value]) => ({
        label,
        periodEnding: null,
        revenue: null,
        revenueGrowth: null,
        eps: value,
        epsGrowth: null,
        netIncome: null,
        freeCashFlow: null,
        analysts: null,
        forecast: false,
      }));
    return [...extra, ...merged].filter((row) => row.eps !== null).sort((left, right) => left.label.localeCompare(right.label));
  })();
  /**
   * Year-on-year growth for the per-share series, computed where the publisher
   * withholds it.
   *
   * Only from a positive prior year: the percentage change from a loss to a
   * profit is arithmetic that produces a number without producing a meaning.
   */
  const epsGrowth = epsYears.map((row, index) => {
    if (row.epsGrowth !== null) return row.epsGrowth;
    const prior = epsYears[index - 1]?.eps ?? null;
    if (prior === null || prior <= 0 || row.eps === null) return null;
    return (row.eps / prior - 1) * 100;
  });
  const forecastYear = years.find((row) => row.forecast) ?? null;
  const lastReported = [...years].reverse().find((row) => !row.forecast) ?? null;

  if (analyst.state === "loading") {
    return (
      <Panel title="Revenue and earnings forecast" span="full" meta="loading">
        <Skeleton rows={6} />
      </Panel>
    );
  }
  if (!revenueYears.length && !epsYears.length) {
    return (
      <Panel title="Revenue and earnings forecast" span="full">
        <Empty>{analyst.error ?? "No published financial forecast was found for this ticker."}</Empty>
      </Panel>
    );
  }

  return (
    <>
      <Panel
        title="Revenue forecast"
        span="full"
        meta={
          forecastYear
            ? `${forecastYear.label} consensus${forecastYear.analysts ? ` · ${plural(forecastYear.analysts, "analyst")}` : ""}`
            : null
        }
      >
        <ForecastSeries
          series={revenueYears.map((row) => ({ label: row.label, value: row.revenue, forecast: row.forecast }))}
          range={data?.revenueForecast ?? null}
          format={(value) => money(value)}
          label="Reported and forecast revenue by fiscal year"
        />
        <ForecastLedger
          years={revenueYears.map((row) => ({ label: row.label, forecast: row.forecast }))}
          rows={[
            { label: "Reported", note: "as filed", values: revenueYears.map((row) => (row.forecast ? null : money(row.revenue))) },
            { label: "Estimate", note: "consensus", values: revenueYears.map((row) => (row.forecast ? money(row.revenue) : null)) },
            {
              label: "Growth",
              note: "year on year",
              values: revenueYears.map((row) => (row.revenueGrowth === null ? null : pct(row.revenueGrowth))),
              tones: revenueYears.map((row) => tone(row.revenueGrowth)),
            },
            { label: "Analysts", note: "contributing", values: revenueYears.map((row) => (row.analysts ? String(row.analysts) : null)) },
          ]}
        />
        <StatGrid columns={4}>
          <Stat label="Last reported" value={money(lastReported?.revenue ?? null)} note={lastReported?.label} />
          <Stat label="Consensus" value={money(forecastYear?.revenue ?? null)} note={forecastYear?.label} />
          <Stat label="Implied growth" value={pct(forecastYear?.revenueGrowth ?? null)} tone={tone(forecastYear?.revenueGrowth ?? null)} note="on the reported year" />
          <Stat
            label="Estimate range"
            value={data?.revenueForecast?.low !== null && data?.revenueForecast?.high !== null && data?.revenueForecast
              ? `${money(data.revenueForecast.low)} – ${money(data.revenueForecast.high)}`
              : "—"}
            note={data?.revenueForecast?.year ? `low to high, ${data.revenueForecast.year}` : undefined}
          />
        </StatGrid>
      </Panel>

      {epsYears.length >= 2 ? (
        <Panel
          title="EPS forecast"
          span="full"
          meta={data?.epsForecast?.year ? `${data.epsForecast.year} consensus` : null}
        >
          <ForecastSeries
            series={epsYears.map((row) => ({ label: row.label, value: row.eps, forecast: row.forecast }))}
            range={data?.epsForecast ?? null}
            format={(value) => usd(value)}
            label="Reported and forecast earnings per share by fiscal year"
          />
          <ForecastLedger
            years={epsYears.map((row) => ({ label: row.label, forecast: row.forecast }))}
            rows={[
              { label: "Reported", note: "as filed", values: epsYears.map((row) => (row.forecast ? null : usd(row.eps))) },
              { label: "Estimate", note: "consensus", values: epsYears.map((row) => (row.forecast ? usd(row.eps) : null)) },
              {
                label: "Growth",
                note: "year on year",
                values: epsGrowth.map((value) => (value === null ? null : pct(value))),
                tones: epsGrowth.map((value) => tone(value)),
              },
              { label: "Analysts", note: "contributing", values: epsYears.map((row) => (row.analysts ? String(row.analysts) : null)) },
            ]}
          />
          <StatGrid columns={4}>
            <Stat label="Last reported" value={usd(lastReported?.eps ?? null)} note={lastReported?.label} />
            <Stat label="Consensus" value={usd(forecastYear?.eps ?? null)} note={forecastYear?.label} />
            <Stat label="Implied growth" value={pct(forecastYear?.epsGrowth ?? null)} tone={tone(forecastYear?.epsGrowth ?? null)} note="on the reported year" />
            <Stat
              label="Estimate range"
              value={data?.epsForecast?.low !== null && data?.epsForecast?.high !== null && data?.epsForecast
                ? `${usd(data.epsForecast.low)} – ${usd(data.epsForecast.high)}`
                : "—"}
              note={data?.epsForecast?.year ? `low to high, ${data.epsForecast.year}` : undefined}
            />
          </StatGrid>
        </Panel>
      ) : null}

      <Panel title="Forecast detail" span="full">
        <table className="sw-table sw-table--compact">
          <thead>
            <tr>
              <th scope="col">Fiscal year</th>
              <th scope="col" className="sw-num">Revenue</th>
              <th scope="col" className="sw-num">Growth</th>
              <th scope="col" className="sw-num">EPS</th>
              <th scope="col" className="sw-num">Net income</th>
              <th scope="col" className="sw-num">Free cash flow</th>
              <th scope="col">Basis</th>
            </tr>
          </thead>
          <tbody>
            {years.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="sw-num">{money(row.revenue)}</td>
                <td className={`sw-num is-${tone(row.revenueGrowth)}`}>{pct(row.revenueGrowth)}</td>
                <td className="sw-num">{usd(row.eps ?? epsYears.find((entry) => entry.label === row.label)?.eps ?? null)}</td>
                <td className="sw-num">{money(row.netIncome)}</td>
                <td className="sw-num">{money(row.freeCashFlow)}</td>
                <td>
                  {row.forecast ? (
                    <Chip tone="neutral">estimate</Chip>
                  ) : (
                    <span className="sw-quiet">reported</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Note>
          Estimates are the analyst consensus, not company guidance, and are stated on a non-GAAP adjusted basis where the publisher
          reports them that way — so they will not tie exactly to the SEC figures on the filing panel. Reported earnings per share are
          the diluted figure as filed, which is why a reported year and an estimated year are never averaged into one series here.
        </Note>
      </Panel>
    </>
  );
}

/**
 * Form 4 transaction codes, in the plain words the tape needs.
 *
 * A grant, a gift and an option exercise struck at zero all carry no cash
 * consideration, so `shares * price` is legitimately 0 for them. Printing that
 * as "$0" reads as a zero-dollar trade, and on a ticker whose recent filings
 * are all grants it made the whole tape look broken. Those rows show the share
 * count — the quantity that actually moved — and say what kind of transaction
 * it was.
 */
const INSIDER_CODES: Record<string, string> = {
  P: "open-market buy",
  S: "open-market sale",
  A: "grant",
  M: "option exercise",
  F: "tax withholding",
  G: "gift",
  D: "returned to issuer",
  C: "conversion",
  X: "option exercise",
};

function insiderCode(code: string | null) {
  if (!code) return "Form 4";
  return INSIDER_CODES[code] ?? `code ${code}`;
}

export function OwnershipPanel({
  ownership,
}: {
  ownership: Resource<OwnershipData> & { institutionalState?: "idle" | "loading" | "ready" | "error" };
}) {
  const data = ownership.data;
  const institutionalPending = ownership.institutionalState === "loading";

  if (ownership.state === "loading") {
    return (
      <Panel title="Ownership and short interest" meta="loading">
        <SkeletonStats columns={4} />
        <Skeleton rows={5} />
      </Panel>
    );
  }
  if (!data || data.error) {
    return (
      <Panel title="Ownership and short interest">
        <Empty>{ownership.error ?? data?.error ?? "No SEC or FINRA disclosure was returned for this issuer."}</Empty>
      </Panel>
    );
  }

  const holders = data.institutional?.topHolders ?? [];
  const largest = holders[0]?.value ?? 0;
  const buys = data.insiders.filter((row) => row.side === "buy").length;
  const sells = data.insiders.filter((row) => row.side === "sell").length;

  return (
    <Panel
      title="Ownership and short interest"
      meta={data.stale ? <Chip tone="warn">saved</Chip> : `checked ${dateShort(data.checkedAt)}`}
      caption="Quarterly and twice-monthly disclosures. Not live order flow."
    >
      <StatGrid columns={4}>
        <Stat label="13F reported value" value={money(data.institutional?.reportedValue ?? null)} note={institutionalPending ? "still loading" : data.institutional?.asOf ? `as of ${dateShort(data.institutional.asOf)}` : "latest dataset"} />
        <Stat label="Reported ownership" value={rate(data.institutional?.ownershipPercent ?? null)} note={institutionalPending ? "still loading" : data.institutional ? `${plural(data.institutional.managers, "manager")} · 13F only` : undefined} />
        <Stat label="Quarter change" value={pct(data.institutional?.changePercent ?? null)} tone={tone(data.institutional?.changePercent ?? null)} note="reported value vs prior dataset" />
        <Stat label="Short interest" value={count(data.shortInterest?.current ?? null)} note={data.shortInterest?.settlementDate ? `settled ${dateShort(data.shortInterest.settlementDate)}` : "FINRA"} />
        <Stat label="Days to cover" value={data.shortInterest?.daysToCover === null || data.shortInterest?.daysToCover === undefined ? "—" : data.shortInterest.daysToCover.toFixed(1)} note="on FINRA average volume" />
        <Stat label="Short-sale ratio" value={rate(data.shortSaleVolume?.ratio ?? null)} note={data.shortSaleVolume?.tradeDate ? `Reg SHO · ${dateShort(data.shortSaleVolume.tradeDate)}` : "FINRA daily file"} />
      </StatGrid>

      <div className="sw-split">
        <div>
          <h3 className="sw-subhead">Largest disclosed holders</h3>
          {institutionalPending && !holders.length ? (
            <Skeleton rows={5} />
          ) : holders.length ? (
            <div className="sw-holders">
              {holders.slice(0, 6).map((holder) => (
                <div className="sw-holder" key={holder.manager}>
                  <span>{holder.manager}</span>
                  <Meter value={largest ? holder.value / largest : null} label={`${holder.manager} reported value`} />
                  <em>
                    {money(holder.value)}
                    <small>{holder.percent === null ? "— of company" : `${rate(holder.percent, 2)} of company`}</small>
                  </em>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No matching 13F rows were found in the latest dataset.</Empty>
          )}
        </div>
        <div>
          <h3 className="sw-subhead">
            Insider tape <small>{buys} buys · {sells} sells</small>
          </h3>
          {data.insiders.length ? (
            <div className="sw-insiders">
              {data.insiders.slice(0, 6).map((row, index) => (
                <a className={`sw-insider is-${row.side}`} key={`${row.url}-${index}`} href={row.url} target="_blank" rel="noreferrer">
                  <b>{row.owner}</b>
                  {/* EDGAR returns an empty officerTitle for directors rather
                      than omitting it, so `??` left the row opening with a
                      stray separator. */}
                  <small>{row.title || "Form 4"} · {insiderCode(row.code)} · {dateShort(row.date ?? row.filed)}</small>
                  <em>{row.value ? money(row.value) : `${count(row.shares)} sh`}</em>
                </a>
              ))}
            </div>
          ) : (
            <Empty>No recent Form 4 transactions were returned.</Empty>
          )}
        </div>
      </div>

      <Note>
        13F excludes short positions. Short interest is twice-monthly; the daily short-sale ratio is a different measure.{" "}
        <a href="https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets" target="_blank" rel="noreferrer">13F</a> ·{" "}
        <a href="https://www.sec.gov/edgar/search/" target="_blank" rel="noreferrer">EDGAR</a> ·{" "}
        <a href="https://www.finra.org/finra-data/browse-catalog/equity-short-interest/files" target="_blank" rel="noreferrer">FINRA</a>
      </Note>
    </Panel>
  );
}

export function CatalystPanel({ catalysts }: { catalysts: Resource<CatalystData> }) {
  const data = catalysts.data;
  return (
    <Panel title="Filings and calendar" meta={catalysts.state === "loading" ? "loading" : data?.stale ? <Chip tone="warn">saved</Chip> : null}>
      {catalysts.state === "loading" ? (
        <Skeleton rows={3} />
      ) : !data?.filings.length && !data?.irCalendar ? (
        <Empty>{catalysts.error ?? "No filing ledger is mapped for this ticker."}</Empty>
      ) : (
        <div className="sw-filings">
          {data.filings.slice(0, 5).map((filing) => (
            <a key={`${filing.form}-${filing.date}`} href={filing.url} target="_blank" rel="noreferrer">
              <b>{filing.form}</b>
              <span>{filing.label}</span>
              <em>{dateShort(filing.date)}</em>
            </a>
          ))}
          {data.irCalendar ? (
            <a href={data.irCalendar} target="_blank" rel="noreferrer">
              <b>IR</b>
              <span>Investor relations calendar</span>
              <em>confirm earnings ↗</em>
            </a>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
