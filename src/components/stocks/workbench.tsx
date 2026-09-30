"use client";

import { useMemo, useState } from "react";
import { dateShort, freeCashFlow, money, plural, rate, tone, usd } from "@/components/stocks/format";
import { Chip, Empty, Note, Panel, Row, Stat, StatGrid } from "@/components/stocks/ui";
import type { Resource } from "@/components/stocks/data";
import type { CatalystData, OptionBridgeData, ProfileData, StockData } from "@/components/stocks/types";

/** A labelled numeric input. The unit belongs beside the field, not in the label. */
function Field({
  label,
  value,
  onChange,
  unit,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  hint?: string;
}) {
  return (
    <label className="sw-field">
      <span className="sw-field__label">{label}</span>
      <span className="sw-field__input">
        <input value={value} inputMode="decimal" onChange={(event) => onChange(event.target.value)} />
        {unit ? <i>{unit}</i> : null}
      </span>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

/* ================================================================== value */

/** Years of explicit projection before the terminal value takes over. */
const HORIZON = 10;

/**
 * A discounted cash flow the reader can argue with.
 *
 * Free cash flow grows from a starting rate and fades to the stable rate over
 * ten years; the discount rate is built from the risk-free rate, a market beta,
 * an equity premium, and the issuer's own cost of debt rather than typed in
 * directly. The implied-growth figure inverts the same model against the
 * current price, which is the only output here that says anything about what
 * the market is assuming.
 *
 * Three things used to push every estimate far below the traded price:
 *
 *   - Operating cash flow is stated after interest paid, so free cash flow is
 *     already a figure the lenders have been served out of. Discounting it at
 *     the cost of equity and then subtracting net debt charged for the debt
 *     twice: Home Depot lost $48 a share and AT&T $17 to the double count.
 *     Interest is added back after tax to get a firm-level cash flow, and that
 *     is discounted at the weighted average cost of capital instead.
 *   - Only cash and equivalents counted as an offset while the whole debt
 *     balance was subtracted. Marketable securities are now included.
 *   - Fading to the terminal rate over five years caps the model at roughly
 *     fifteen times free cash flow no matter what is typed in, which no
 *     established compounder has traded at in this cycle. Ten years is the
 *     conventional window and lets the near-term rate matter.
 *
 * What remains between this and the market is an assumption, not an error: the
 * implied-growth stat is there to state it.
 */
export function ValueWorkbench({ stock }: { stock: StockData }) {
  const [growth, setGrowth] = useState("");
  const [fade, setFade] = useState("2.5");
  const [riskFree, setRiskFree] = useState("4.3");
  const [equityPremium, setEquityPremium] = useState("5");
  const [beta, setBeta] = useState("");
  const [shareGrowth, setShareGrowth] = useState("0");

  const annual = stock.fundamentals?.annual;
  const ttm = stock.fundamentals?.ttm;
  const fundamentals = stock.fundamentals;

  const model = useMemo(() => {
    const rows = (fundamentals?.history ?? [])
      .map((row) => ({ ...row, fcf: freeCashFlow(row.operatingCashFlow, row.capex) }))
      .filter((row): row is typeof row & { fcf: number } => row.fcf !== null);
    const recent = rows.slice(0, 3);
    const normalized = recent.length ? recent.reduce((sum, row) => sum + row.fcf, 0) / recent.length : null;
    const ttmFcf = freeCashFlow(ttm?.operatingCashFlow, ttm?.capex);
    const levered = ttmFcf ?? normalized ?? freeCashFlow(annual?.operatingCashFlow, annual?.capex);

    // The long-window market beta, not the sixty-day sector one shown on the
    // metrics panel. That figure swung from −0.71 to 3.95 across ordinary large
    // caps and dragged this model to a twelfth of the share price in one case.
    const betaValue = Number(beta || stock.valuationBeta?.toFixed(2) || "1");
    const costOfEquity = Number(riskFree) / 100 + betaValue * (Number(equityPremium) / 100);
    const stable = Number(fade) / 100;
    const dilution = Number(shareGrowth) / 100;
    const shares = annual?.shares ?? annual?.dilutedShares ?? 0;
    const debt = annual?.debt ?? 0;
    const netCash = (annual?.cash ?? 0) + (annual?.investments ?? 0) - debt;

    // The effective rate the issuer actually paid, and the rate it actually
    // borrowed at, in place of a typed-in guess. Both are bounded because one
    // odd year of tax or a rounding-sized debt balance otherwise dominates.
    const bound = (value: number | null, low: number, high: number, fallback: number) =>
      value !== null && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
    const taxRate = bound(
      annual?.pretaxIncome && annual.pretaxIncome > 0 && annual.incomeTax !== null ? annual.incomeTax / annual.pretaxIncome : null,
      0.05,
      0.4,
      0.21,
    );
    const costOfDebt = bound(
      debt > 0 && annual?.interestExpense ? Math.abs(annual.interestExpense) / debt : null,
      0.02,
      0.12,
      Number(riskFree) / 100 + 0.015,
    );
    // Interest is paid before the free cash flow above is struck, so it is added
    // back after tax to reach the cash the whole capital structure is entitled
    // to. That figure belongs to lenders and owners together, which is why it is
    // discounted at the blended rate and net debt is subtracted once, at the end.
    const starting = levered === null ? null : levered + Math.abs(annual?.interestExpense ?? 0) * (1 - taxRate);
    const marketEquity = stock.price !== null && shares > 0 ? stock.price * shares : null;
    const debtWeight = marketEquity !== null && marketEquity + debt > 0 ? debt / (marketEquity + debt) : 0;
    const discount = costOfEquity * (1 - debtWeight) + costOfDebt * (1 - taxRate) * debtWeight;

    // A flat 8% start was applied to every issuer regardless of what it has
    // done. The issuer's own free-cash-flow record is the better prior, but five
    // filings is a short and noisy series — one peak year put Apple's trailing
    // rate near zero — so it is shrunk halfway toward the 8% it replaced rather
    // than used raw. The reader still overrides it in the field.
    const historicGrowth = (() => {
      const series = rows.filter((row) => row.fcf > 0);
      const oldest = series.at(-1);
      const newest = series[0];
      if (!oldest || !newest || series.length < 3 || oldest === newest) return null;
      return Math.pow(newest.fcf / oldest.fcf, 1 / (series.length - 1)) - 1;
    })();
    const suggestedGrowth = historicGrowth === null ? 8 : Math.min(15, Math.max(3, (historicGrowth * 100 + 8) / 2));
    const near = Number(growth || suggestedGrowth.toFixed(1)) / 100;

    const value = (initialGrowth: number, rateOfReturn: number) => {
      // Compounding a negative free cash flow produces a larger negative and a
      // meaningless per-share figure — Oracle came out at −$0.07 rather than
      // saying the method does not apply.
      if (starting === null || starting <= 0 || shares <= 0 || rateOfReturn <= stable || !Number.isFinite(rateOfReturn) || !Number.isFinite(initialGrowth)) return null;
      let cash = starting;
      const projections = Array.from({ length: HORIZON }, (_, index) => {
        const yearGrowth = initialGrowth + (stable - initialGrowth) * (index / (HORIZON - 1));
        cash *= 1 + yearGrowth;
        return { year: index + 1, growth: yearGrowth, fcf: cash, presentValue: cash / Math.pow(1 + rateOfReturn, index + 1) };
      });
      const terminal = (projections[HORIZON - 1].fcf * (1 + stable)) / (rateOfReturn - stable);
      const enterprise = projections.reduce((sum, row) => sum + row.presentValue, 0) + terminal / Math.pow(1 + rateOfReturn, HORIZON);
      const equity = enterprise + netCash;
      const futureShares = shares * Math.pow(1 + dilution, HORIZON);
      return { projections, enterprise, equity, perShare: equity / futureShares, futureShares };
    };

    const cases = [
      { label: "Bear", growth: near - 0.03, rate: discount + 0.01 },
      { label: "Base", growth: near, rate: discount },
      { label: "Bull", growth: near + 0.03, rate: Math.max(discount - 0.01, stable + 0.005) },
    ].map((scenario) => ({ ...scenario, result: value(scenario.growth, scenario.rate) }));

    // Bisection on starting growth until the model reproduces the market price.
    const implied = (() => {
      if (stock.price === null || starting === null || shares <= 0) return null;
      let low = -0.4;
      let high = 0.8;
      for (let iteration = 0; iteration < 50; iteration += 1) {
        const mid = (low + high) / 2;
        const result = value(mid, discount);
        if (!result) return null;
        if (result.perShare < stock.price) low = mid;
        else high = mid;
      }
      return (low + high) / 2;
    })();

    return { starting, levered, normalized, recent, discount, costOfEquity, costOfDebt, taxRate, debtWeight, netCash, betaValue, stable, near, suggestedGrowth, shares, cases, implied, value };
  }, [annual, ttm, fundamentals, growth, fade, riskFree, equityPremium, beta, shareGrowth, stock.valuationBeta, stock.price]);

  const base = model.cases[1].result;
  const basis = [
    freeCashFlow(ttm?.operatingCashFlow, ttm?.capex) !== null
      ? "TTM free cash flow"
      : model.recent.length
        ? `${plural(model.recent.length, "year")} normalized`
        : "annual filing",
    model.shares ? (annual?.sharesSource?.split(" · ")[0] === "EntityCommonStockSharesOutstanding" ? "cover-page share count" : "share count from the financial statements") : "share count unavailable",
    stock.valuationBeta === null || stock.valuationBeta === undefined ? "beta typed in" : `beta ${stock.valuationBeta.toFixed(2)} vs market`,
  ].join(" · ");

  return (
    <Panel title="Valuation workbench" meta={basis}>
      <div className="sw-fields">
        <Field
          label="Near-term FCF growth"
          value={growth || model.suggestedGrowth.toFixed(1)}
          onChange={setGrowth}
          unit="%"
          hint={`year 1, fades over ${HORIZON} years`}
        />
        <Field label="Stable growth" value={fade} onChange={setFade} unit="%" hint="terminal rate" />
        <Field label="Risk-free rate" value={riskFree} onChange={setRiskFree} unit="%" />
        <Field label="Equity premium" value={equityPremium} onChange={setEquityPremium} unit="%" />
        <Field label="Beta" value={beta || stock.valuationBeta?.toFixed(2) || "1"} onChange={setBeta} hint="weekly vs market, 2 years" />
        <Field label="Share growth" value={shareGrowth} onChange={setShareGrowth} unit="%" hint="annual dilution or buyback" />
      </div>

      {base ? (
        <>
          {/* The base case is the answer; naming it "Base" alone left readers
              asking what the number was. It is stated as a fair value, against
              the price, with the two alternative assumption sets beside it. */}
          <div className="sw-fair">
            <div className="sw-fair__headline">
              <span>Fair value estimate · base case</span>
              <strong>{usd(base.perShare)}</strong>
              <small>per share, on the assumptions above</small>
            </div>
            <div className="sw-fair__gap">
              <span>Last close {usd(stock.price)}</span>
              {stock.price ? (
                <b className={`sw-delta is-${tone(base.perShare - stock.price)}`}>
                  {base.perShare >= stock.price ? "+" : ""}
                  {(((base.perShare - stock.price) / stock.price) * 100).toFixed(1)}%
                  {base.perShare >= stock.price ? " above price" : " below price"}
                </b>
              ) : null}
            </div>
          </div>

          <div className="sw-cases">
            {model.cases.map((scenario) => (
              <article key={scenario.label} data-case={scenario.label.toLowerCase()}>
                <span>{scenario.label === "Base" ? "Base · fair value" : scenario.label}</span>
                <strong>{scenario.result ? usd(scenario.result.perShare) : "—"}</strong>
                <small>{rate(scenario.growth * 100)} start · {rate(scenario.rate * 100)} discount rate</small>
              </article>
            ))}
          </div>

          <StatGrid columns={4}>
            <Stat label="Last close" value={usd(stock.price)} note={stock.asOf ? dateShort(stock.asOf) : undefined} />
            <Stat
              label="Discount rate"
              value={rate(model.discount * 100)}
              note={
                model.debtWeight > 0.005
                  ? `${rate(model.costOfEquity * 100)} equity, ${rate(model.costOfDebt * (1 - model.taxRate) * 100)} debt after tax, ${rate(model.debtWeight * 100)} debt-funded`
                  : `${riskFree}% + ${model.betaValue.toFixed(2)} × ${equityPremium}%, no net borrowing weight`
              }
            />
            <Stat label="Market implies" value={model.implied === null ? "—" : rate(model.implied * 100)} note="starting FCF growth needed to justify the price" />
            <Stat label="Starting cash flow" value={money(model.starting)} note="free cash flow with after-tax interest added back" />
          </StatGrid>

          <details className="sw-details">
            <summary>Projection and sensitivity</summary>
            <div className="sw-ledger">
              <Row label="Net cash / (debt)" value={money(model.netCash)} note="cash and marketable securities less debt" />
              <Row label="Free cash flow, levered" value={money(model.levered)} note="as reported, after interest paid" />
              <Row label={`Shares now / in ${HORIZON} years`} value={`${(model.shares / 1e9).toFixed(2)}B / ${(base.futureShares / 1e9).toFixed(2)}B`} note={annual?.sharesSource ?? "reflects the share-growth setting"} />
              <Row
                label="Terminal share of value"
                value={base.enterprise ? `${Math.round(((base.enterprise - base.projections.reduce((sum, row) => sum + row.presentValue, 0)) / base.enterprise) * 100)}%` : "—"}
                note="how much rests on the terminal assumption"
              />
            </div>

            <table className="sw-table sw-table--compact">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col" className="sw-num">Growth</th>
                  <th scope="col" className="sw-num">Free cash flow</th>
                  <th scope="col" className="sw-num">Present value</th>
                </tr>
              </thead>
              <tbody>
                {base.projections.map((row) => (
                  <tr key={row.year}>
                    <th scope="row">Year {row.year}</th>
                    <td className="sw-num">{rate(row.growth * 100)}</td>
                    <td className="sw-num">{money(row.fcf)}</td>
                    <td className="sw-num">{money(row.presentValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="sw-subhead">Per-share sensitivity</h3>
            <table className="sw-table sw-table--compact">
              <thead>
                <tr>
                  <th scope="col">Growth \ cost</th>
                  {[-0.01, 0, 0.01].map((offset) => (
                    <th scope="col" className="sw-num" key={offset}>{rate((model.discount + offset) * 100)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[-0.03, 0, 0.03].map((offset) => (
                  <tr key={offset}>
                    <th scope="row">{rate((model.near + offset) * 100)}</th>
                    {[-0.01, 0, 0.01].map((rateOffset) => (
                      <td className="sw-num" key={rateOffset}>
                        {usd(model.value(model.near + offset, model.discount + rateOffset)?.perShare ?? null)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : (
        <Empty>
          {model.starting !== null && model.starting <= 0
            ? "This issuer's reported free cash flow is negative, so discounting it produces no meaningful fair value. A company that does not yet generate cash has to be valued on something other than the cash it generates."
            : !model.shares
              ? "No undimensioned share count appears in this issuer's filings. Multi-class issuers tag the cover-page count once per class, and the SEC's company-facts service carries only the untagged figures, so there is no total to divide by. A per-share value would have to invent one."
              : model.discount <= model.stable
                ? `The discount rate (${rate(model.discount * 100)}) is at or below the terminal growth rate (${rate(model.stable * 100)}). A perpetuity only converges when it grows more slowly than it is discounted — raise the beta or the equity premium, or lower stable growth.`
                : model.starting === null
                  ? "No annual cash-flow statement is available for this issuer, so there is nothing to discount."
                  : "This model needs reported free cash flow, a share count, and a discount rate above the stable growth rate. One of those is unavailable for this issuer."}
        </Empty>
      )}

      <Note>Built from SEC annual filings. A research range, not a recommendation.</Note>
    </Panel>
  );
}

/* =================================================================== risk */

export function RiskWorkbench({
  stock,
  options,
  catalysts,
  profile,
}: {
  stock: StockData;
  options: Resource<OptionBridgeData>;
  catalysts: Resource<CatalystData>;
  profile: Resource<ProfileData>;
}) {
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [stopBasis, setStopBasis] = useState<"atr" | "percent" | "swing">("atr");
  const [stopMultiple, setStopMultiple] = useState("1.5");
  const [targetMultiple, setTargetMultiple] = useState("2");
  const [entry, setEntry] = useState("");
  const [riskBudget, setRiskBudget] = useState("100");
  // The published date, until the reader types over it. Asking someone to look
  // up the next earnings date and key it in was the only input on this page
  // that could be answered by the workstation itself.
  const [typedEarningsDate, setTypedEarningsDate] = useState("");
  // Only a date still ahead is worth filling in. The publisher states the most
  // recent report until the next one is confirmed, and prefilling that would
  // size an event that has already passed.
  // Compared against the last close rather than the wall clock: both are plain
  // calendar dates, so the comparison is a string one, and reading the clock
  // during render is neither pure nor more accurate here.
  const published = profile.data?.earningsDate ?? "";
  const publishedEarnings = published && published >= (stock.asOf ?? "") ? published : "";
  const earningsDate = typedEarningsDate || publishedEarnings;
  const setEarningsDate = setTypedEarningsDate;

  const start = Number(entry) || stock.price || 0;
  const atr = stock.atr14 ?? 0;
  const swing = direction === "long" ? stock.swingLow20 ?? start : stock.swingHigh20 ?? start;
  const distance =
    stopBasis === "atr" ? atr * (Number(stopMultiple) || 1)
      : stopBasis === "percent" ? (start * (Number(stopMultiple) || 1)) / 100
        : Math.abs(start - swing);
  const stop = direction === "long" ? start - distance : start + distance;
  const target = direction === "long" ? start + distance * (Number(targetMultiple) || 2) : start - distance * (Number(targetMultiple) || 2);
  const shares = distance > 0 ? Math.floor((Number(riskBudget) || 0) / distance) : 0;

  const eventDays = earningsDate && stock.asOf
    ? Math.ceil((Date.parse(`${earningsDate}T20:00:00Z`) - Date.parse(`${stock.asOf}T20:00:00Z`)) / 86_400_000)
    : null;
  const eventIv = options.data?.surface[0]?.atmIv ?? null;
  const earningsMove =
    stock.price !== null && eventIv && eventDays !== null && eventDays >= 0
      ? stock.price * eventIv * Math.sqrt(Math.max(eventDays, 1) / 365)
      : null;

  const preset = (mode: "conservative" | "balanced" | "aggressive") => {
    setStopMultiple(mode === "conservative" ? "2" : mode === "aggressive" ? "1" : "1.5");
    setTargetMultiple(mode === "conservative" ? "1.5" : mode === "aggressive" ? "3" : "2");
  };

  return (
    <>
      <Panel title="Position sizing" meta="scenario, not an order">
        <div className="sw-presets">
          {(["conservative", "balanced", "aggressive"] as const).map((mode) => (
            <button type="button" key={mode} onClick={() => preset(mode)}>{mode}</button>
          ))}
        </div>

        <div className="sw-fields">
          <label className="sw-field">
            <span className="sw-field__label">Direction</span>
            <span className="sw-field__input">
              <select value={direction} onChange={(event) => setDirection(event.target.value as "long" | "short")}>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </span>
          </label>
          <label className="sw-field">
            <span className="sw-field__label">Stop basis</span>
            <span className="sw-field__input">
              <select value={stopBasis} onChange={(event) => setStopBasis(event.target.value as "atr" | "percent" | "swing")}>
                <option value="atr">ATR</option>
                <option value="percent">Percent</option>
                <option value="swing">20-day swing</option>
              </select>
            </span>
          </label>
          <Field label="Stop multiple" value={stopMultiple} onChange={setStopMultiple} />
          <Field label="Target" value={targetMultiple} onChange={setTargetMultiple} unit="R" />
          <Field label="Entry" value={entry} onChange={setEntry} hint={stock.price !== null ? `last ${usd(stock.price)}` : undefined} />
          <Field label="Risk budget" value={riskBudget} onChange={setRiskBudget} unit="$" />
        </div>

        <StatGrid columns={4}>
          <Stat label="Risk distance" value={distance ? usd(distance) : "—"} note={stopBasis === "atr" ? `${stopMultiple}× ATR` : stopBasis === "percent" ? `${stopMultiple}% of price` : "to the 20-day swing"} />
          <Stat label="Scenario stop" value={stop > 0 ? usd(stop) : "—"} />
          <Stat label="Scenario target" value={target > 0 ? usd(target) : "—"} />
          <Stat label="Position size" value={shares ? `${shares.toLocaleString()} sh` : "—"} note="at the risk budget above" />
        </StatGrid>
      </Panel>

      <Panel
        title="Event risk"
        caption="Confirm the date from investor relations, then size the implied move."
        meta={
          publishedEarnings && !typedEarningsDate ? (
            <Chip tone="quiet">published {dateShort(publishedEarnings)}</Chip>
          ) : typedEarningsDate ? (
            <Chip tone="neutral">your date</Chip>
          ) : profile.state === "loading" ? (
            "loading"
          ) : null
        }
      >
        <label className="sw-field sw-field--wide">
          <span className="sw-field__label">Earnings date</span>
          <span className="sw-field__input">
            <input
              type="date"
              value={earningsDate}
              onChange={(event) => {
                setEarningsDate(event.target.value);
                try {
                  localStorage.setItem(`gexlab-v3:earnings-date:${stock.symbol}`, event.target.value);
                } catch {
                  // Storage is optional.
                }
              }}
            />
          </span>
        </label>

        <StatGrid columns={3}>
          <Stat
            label="Days away"
            value={eventDays === null ? "—" : eventDays < 0 ? "past" : String(eventDays)}
            note={eventDays !== null && eventDays < 0 ? "update from investor relations" : "from the last close"}
            tone={eventDays !== null && eventDays >= 0 && eventDays <= 7 ? "down" : undefined}
          />
          <Stat
            label="Implied move to date"
            value={earningsMove === null ? "—" : `±${usd(earningsMove)}`}
            note={earningsMove !== null && stock.price ? `${rate((earningsMove / stock.price) * 100)} at current ATM IV` : "needs a date and an option snapshot"}
          />
          <Stat
            label="Front expected move"
            value={options.data?.expectedMove ? `±${usd(options.data.expectedMove.dollars)}` : "—"}
            note={options.data?.expectedMove?.expiry ?? "from the delayed snapshot"}
          />
        </StatGrid>

        <StatGrid columns={3}>
          <Stat label="Overnight gaps" value={rate(stock.gapRisk60.average)} note={`60-day average · p90 ${rate(stock.gapRisk60.p90)}`} />
          <Stat label="Gaps over 2%" value={stock.gapRisk60.gapsOverTwoPercent === null ? "—" : String(stock.gapRisk60.gapsOverTwoPercent)} note="in the last 60 sessions" />
          <Stat label="Beta" value={stock.beta60 === null ? "—" : stock.beta60.toFixed(2)} note={`60-day vs ${stock.benchmark}`} />
        </StatGrid>

        {catalysts.data?.irCalendar ? (
          <Note>
            <a href={catalysts.data.irCalendar} target="_blank" rel="noreferrer">Confirm the date on the issuer&rsquo;s calendar ↗</a>
          </Note>
        ) : null}
      </Panel>
    </>
  );
}
