"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { assess } from "@/components/stocks/assess";
import { DEFAULT_WATCHLIST, isTicker, useFlowScan, useJson, useWatchlist, useWatchlistRows } from "@/components/stocks/data";
import { money, pct, plural, tone, usd } from "@/components/stocks/format";
import { TickerSearch } from "@/components/stocks/ticker-search";
import { BreadthBar, Chip, DivergingBar, Empty, Panel, Sparkline } from "@/components/stocks/ui";
import type { MacroData, StockData } from "@/components/stocks/types";

type SortKey = "symbol" | "today" | "relative" | "flow";

function monthRelative(row: StockData | undefined) {
  return row?.relativeStrength.find((item) => item.periods === 20)?.versusSector ?? null;
}

/**
 * The saved list.
 *
 * The table carries a diverging bar behind each move so the ordering is legible
 * without reading every figure, and the page closes with sector and mover
 * panels rather than stopping at the last row and leaving two thirds of the
 * screen empty.
 */
export function Watchlist() {
  const { watchlist, setWatchlist, add, remove } = useWatchlist();
  const { rows, pending } = useWatchlistRows(watchlist);
  const { flow, scanning, error: flowError, scan, forget } = useFlowScan();
  const macro = useJson<MacroData>("/api/macro?view=regime");

  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState("");
  const [sort, setSort] = useState<SortKey>("today");
  const [descending, setDescending] = useState(true);
  const [sector, setSector] = useState("All");
  const [alertThreshold, setAlertThreshold] = useState(3);

  const present = watchlist.map((ticker) => rows[ticker]).filter((row): row is StockData => Boolean(row));
  const sectors = useMemo(() => ["All", ...new Set(present.map((row) => row.benchmark))], [present]);

  const visible = useMemo(() => {
    const filtered = watchlist.filter((ticker) => sector === "All" || rows[ticker]?.benchmark === sector);
    const direction = descending ? 1 : -1;
    return filtered.sort((left, right) => {
      const a = rows[left];
      const b = rows[right];
      if (sort === "symbol") return left.localeCompare(right) * -direction;
      if (sort === "relative") return ((monthRelative(b) ?? -Infinity) - (monthRelative(a) ?? -Infinity)) * direction;
      if (sort === "flow") {
        const total = (ticker: string) => (flow[ticker]?.summary.callNotional ?? 0) + (flow[ticker]?.summary.putNotional ?? 0);
        return (total(right) - total(left)) * direction;
      }
      return ((b?.dayReturn ?? -Infinity) - (a?.dayReturn ?? -Infinity)) * direction;
    });
  }, [watchlist, rows, flow, sort, descending, sector]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))) return;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-watch-row]"));
        const index = links.findIndex((link) => link === document.activeElement);
        const next = (index < 0 ? 0 : index) + (event.key === "j" ? 1 : -1);
        links[Math.max(0, Math.min(links.length - 1, next))]?.focus();
      }
      if (event.key === "/") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("#watchlist-ticker")?.focus();
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (!scanning) void scan(watchlist);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scan, scanning, watchlist]);

  function onAdd(symbol: string) {
    const ticker = symbol.trim().toUpperCase();
    if (!isTicker(ticker)) {
      setInputError("One to five letters.");
      return;
    }
    add(ticker);
    setDraft("");
    setInputError("");
  }

  function onRemove(ticker: string) {
    remove(ticker);
    forget(ticker);
  }

  const moves = present.map((row) => row.dayReturn).filter((value): value is number => value !== null);
  const averageMove = moves.length ? moves.reduce((total, value) => total + value, 0) / moves.length : null;
  const advancing = moves.filter((value) => value > 0).length;
  const declining = moves.filter((value) => value < 0).length;
  const scanned = watchlist.filter((ticker) => flow[ticker]).length;
  const alerts = present.filter((row) => Math.abs(row.dayReturn ?? 0) >= alertThreshold);

  // One scale for every bar in the table, so two rows are comparable.
  const moveScale = Math.max(...moves.map((value) => Math.abs(value)), 1);
  const relativeScale = Math.max(...present.map((row) => Math.abs(monthRelative(row) ?? 0)), 1);

  const leaders = [...present].sort((a, b) => (b.dayReturn ?? -Infinity) - (a.dayReturn ?? -Infinity));

  const bySector = useMemo(() => {
    const groups = new Map<string, StockData[]>();
    for (const row of present) {
      groups.set(row.benchmark, [...(groups.get(row.benchmark) ?? []), row]);
    }
    return [...groups.entries()]
      .map(([name, members]) => {
        const values = members.map((row) => row.dayReturn).filter((value): value is number => value !== null);
        return {
          name,
          count: members.length,
          average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        };
      })
      .sort((a, b) => (b.average ?? -Infinity) - (a.average ?? -Infinity));
  }, [present]);

  const sectorScale = Math.max(...bySector.map((row) => Math.abs(row.average ?? 0)), 1);

  const sortBy = (key: SortKey) => {
    if (sort === key) setDescending((current) => !current);
    else {
      setSort(key);
      setDescending(true);
    }
  };
  const ariaSort = (key: SortKey) => (sort === key ? (descending ? "descending" : "ascending") : "none");

  return (
    <div className="sw sw-watchlist">
      <div className="sw-bar">
        <div className="sw-bar__identity">
          <h1>Equity desk</h1>
          <span>{plural(watchlist.length, "name")}{pending ? ` · ${pending} loading` : ""}</span>
        </div>

        <TickerSearch
          value={draft}
          onChange={(next) => {
            setDraft(next);
            setInputError("");
          }}
          onSubmit={onAdd}
          error={inputError}
        />

        <div className="sw-bar__controls">
          <label>
            <span>Sector</span>
            <select value={sector} onChange={(event) => setSector(event.target.value)}>
              {sectors.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Alert ±</span>
            <input
              type="number"
              min={1}
              max={20}
              value={alertThreshold}
              onChange={(event) => setAlertThreshold(Math.max(1, Math.min(20, Number(event.target.value) || 3)))}
            />
          </label>
          <button type="button" className="sw-action" onClick={() => scan(watchlist)} disabled={scanning || !watchlist.length}>
            {scanning ? "Scanning…" : `Scan flow ${scanned}/${watchlist.length}`}
          </button>
        </div>
      </div>

      {inputError ? <p className="sw-inline-error" role="status">{inputError}</p> : null}
      {flowError ? <p className="sw-inline-error" role="status">{flowError}</p> : null}

      <div className="sw-summary">
        <article>
          <span>Average today</span>
          <strong className={`is-${tone(averageMove)}`}>{pct(averageMove)}</strong>
          {/* Every name counts once. This is not a portfolio return: the list
              carries no position sizes, so nothing here can be weighted. */}
          <small>{moves.length ? `equal-weighted across ${plural(moves.length, "name")}` : "loading closes"}</small>
        </article>
        <article>
          <span>Breadth</span>
          <strong>{moves.length ? `${advancing}/${moves.length}` : "—"}</strong>
          <BreadthBar up={advancing} down={declining} />
        </article>
        <article>
          <span>Leader</span>
          <strong>{leaders[0]?.symbol ?? "—"}</strong>
          <small className={`is-${tone(leaders[0]?.dayReturn ?? null)}`}>{pct(leaders[0]?.dayReturn ?? null)} today</small>
        </article>
        <article>
          <span>Alerts</span>
          <strong className={alerts.length ? "is-warn" : undefined}>{alerts.length || "—"}</strong>
          <small>moved ±{alertThreshold}% or more</small>
        </article>
      </div>

      <table className="sw-table sw-table--watch">
        <thead>
          <tr>
            <th scope="col" aria-sort={ariaSort("symbol")}>
              <button type="button" onClick={() => sortBy("symbol")}>Symbol</button>
            </th>
            <th scope="col" className="sw-num">Last</th>
            <th scope="col" className="sw-num" aria-sort={ariaSort("today")}>
              <button type="button" onClick={() => sortBy("today")}>Today</button>
            </th>
            <th scope="col" className="sw-plot" />
            <th scope="col" className="sw-num" aria-sort={ariaSort("relative")}>
              <button type="button" onClick={() => sortBy("relative")}>1mo vs sector</button>
            </th>
            <th scope="col" className="sw-plot" />
            <th scope="col">90-day</th>
            <th scope="col" className="sw-num">Off high</th>
            <th scope="col" className="sw-num">Estimates</th>
            <th scope="col" className="sw-num" aria-sort={ariaSort("flow")}>
              <button type="button" onClick={() => sortBy("flow")}>Flow</button>
            </th>
            <th scope="col">State</th>
            <th scope="col"><span className="sw-sr">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((ticker) => {
            const row = rows[ticker];
            const relative = monthRelative(row);
            const state = row ? assess(row, macro.data) : null;
            const scan = flow[ticker];
            const premium = scan ? (scan.summary.callNotional ?? 0) + (scan.summary.putNotional ?? 0) : null;
            const alerting = Math.abs(row?.dayReturn ?? 0) >= alertThreshold;
            return (
              <tr key={ticker} className={alerting ? "is-alerting" : undefined}>
                <th scope="row">
                  <Link href={`/stocks/${ticker}`} data-watch-row>
                    <b>{ticker}</b>
                    <small>{row?.benchmark ?? "—"}</small>
                  </Link>
                </th>
                <td className="sw-num">{usd(row?.price ?? null)}</td>
                <td className={`sw-num is-${tone(row?.dayReturn ?? null)}`}>{pct(row?.dayReturn ?? null)}</td>
                <td className="sw-plot"><DivergingBar value={row?.dayReturn ?? null} scale={moveScale} label={`${ticker} today`} /></td>
                <td className={`sw-num is-${tone(relative)}`}>{pct(relative)}</td>
                <td className="sw-plot"><DivergingBar value={relative} scale={relativeScale} label={`${ticker} versus sector`} /></td>
                <td className="sw-trend">
                  {row ? <Sparkline history={row.priceHistory} label={ticker} width={130} height={28} area /> : null}
                </td>
                <td className="sw-num">{(() => {
                  // How far below the 52-week high, which is the number that
                  // matters for a holding rather than the day's move.
                  const high = row?.technicals.high52w ?? null;
                  return high && row?.price ? pct(((row.price - high) / high) * 100) : "—";
                })()}</td>
                <td className={`sw-num is-${tone(row?.estimateDrift?.epsPercent ?? row?.estimateDrift?.targetPercent ?? null)}`}>
                  {row?.estimateDrift
                    ? pct(row.estimateDrift.epsPercent ?? row.estimateDrift.targetPercent ?? null)
                    : <span className="sw-quiet">—</span>}
                </td>
                <td className="sw-num">
                  {premium === null ? <span className="sw-quiet">—</span> : (
                    <>
                      {money(premium)}
                      <small>{scan?.summary.resolved ? "confirmed" : "pending"}</small>
                    </>
                  )}
                </td>
                <td>{state ? <Chip tone={state.tone}>{state.label}</Chip> : <span className="sw-quiet">loading</span>}</td>
                <td>
                  <button type="button" className="sw-remove" onClick={() => onRemove(ticker)} aria-label={`Remove ${ticker}`}>×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!watchlist.length ? (
        <Empty>
          The list is empty. Add a ticker above, or{" "}
          <button type="button" className="sw-link" onClick={() => setWatchlist(DEFAULT_WATCHLIST)}>restore the starter list</button>.
        </Empty>
      ) : null}
      {visible.length === 0 && watchlist.length ? <Empty>No saved name is classified under {sector}.</Empty> : null}

      {present.length ? (
        <div className="sw-panels">
          <Panel title="Sector" meta={`${plural(bySector.length, "group")} on the list`}>
            <div className="sw-sectors">
              {bySector.map((group) => (
                <button
                  type="button"
                  key={group.name}
                  className={sector === group.name ? "is-active" : undefined}
                  onClick={() => setSector(sector === group.name ? "All" : group.name)}
                >
                  <b>{group.name}</b>
                  <DivergingBar value={group.average} scale={sectorScale} label={`${group.name} average move`} />
                  <em className={`is-${tone(group.average)}`}>{pct(group.average)}</em>
                  <small>{plural(group.count, "name")}</small>
                </button>
              ))}
            </div>
          </Panel>

          {/* The State column is gated on macro risk appetite, and with that gate
              off screen every name reads "Selective" for no visible reason. */}
          <Panel title="Regime" meta={macro.state === "loading" ? "loading" : macro.data?.regime.posture ?? null}>
            {macro.data ? (
              <div className="sw-regime">
                <div className="sw-regime__gauge">
                  <span>Risk appetite</span>
                  <strong>{Math.round(macro.data.regime.riskAppetite)}<i>/100</i></strong>
                  <div className="sw-regime__track">
                    <i style={{ width: `${Math.max(0, Math.min(100, macro.data.regime.riskAppetite))}%` }} />
                    <b style={{ left: "60%" }} />
                  </div>
                  <small>
                    {macro.data.regime.riskAppetite >= 60
                      ? "Above the 60 gate — leadership alone marks a name Aligned."
                      : "Below the 60 gate — leadership alone marks a name Leadership, not Aligned."}
                  </small>
                </div>
                <p className="sw-regime__summary">{macro.data.regime.summary}</p>
              </div>
            ) : (
              <Empty>Macro posture is unavailable, so every state falls back to its leadership reading alone.</Empty>
            )}
          </Panel>
        </div>
      ) : null}

      <p className="sw-legend">
        <kbd>j</kbd><kbd>k</kbd> move · <kbd>/</kbd> add · <kbd>f</kbd> scan flow ·
        leadership is measured against each name&rsquo;s sector ETF, not QQQ · saved in this browser
      </p>
    </div>
  );
}
