# Context Handoff — GEXLab V3

Next.js 16 / React 19 / TypeScript. Main workspaces include Macro `/`, Options `/structure`, Engine `/engine`, and an experimental Equity Desk under `/stocks`.
Updated 2026-09-29. The current release candidate includes substantial Equity Desk and repo-packaging changes. Inspect `git status` and the latest release commit before editing. The test/build status in this file is not current; do not repeat historical counts as a present verification result.

```
npm test          # node --experimental-strip-types --test tests/*.test.mjs
npm run check     # lint + test + build
npm run dev
```

## House rules — load-bearing, not preferences

1. **Public endpoints, explicit provenance.** No market-data API key is configured. Core macro
   inputs use public official sources; price context and parts of the Equity Desk also use
   unofficial third-party endpoints. SEC routes require `GEXLAB_SEC_CONTACT` at runtime.
2. **Never fabricate.** A missing value renders as a missing state, never a plausible number.
   Several commits here exist only because something confidently displayed nothing.
3. **Strict walk-forward.** Treat predictive skill as established only when it beats its base rate
   out of sample after correction. Counts and scores are time-sensitive; inspect current saved
   evaluation output before reporting them.
4. **Comments explain why, not what**, and record what was measured — several say "this regressed
   twice" or carry the numbers that justified a threshold. Match that register.

## What changed, by area

### Pine indicator (`src/lib/indicator.ts`, ~48k chars in a `String.raw` template)

- Zone width comes from each book's own modal strike increment, measured from the chain, rescaled
  onto the chart. **NDX is a 10-point grid, not 25** — measured; my earlier claim was wrong.
- Levels use non-maximum suppression + exposure-weighted centroid, then **snap to a listed strike**
  so they land on histogram bars.
- Back-to-back histograms (index left, ETF right of a shared axis). Merging is **per book** — a
  cross-book merge took one book's price and the other's width.
- Bin height is exactly half a strike increment, so bins tile and a default zone is one bin tall.
- Label lanes are spaced by the **longest caption actually drawn**, assigned by occupancy rather
  than cycling 0–3. A fixed 9-bar step was about one label wide, so crowded runs still overlapped.
- `calc_bars_count=5000` bounds the historical offset. Raising `max_bars_back` alone regressed
  **twice** — it treats the symptom.
- Conversion ratio is sampled **live** on synchronized bars with `session.extended`. A daily-close
  version was tried and reverted: the user was right that levels must drift with the market.
- Settled expiries are withdrawn (Hide / Dim / Draw). A payload outlives its contracts and age
  cannot detect it — copied at 15:55, it is ten minutes old at 16:05 with dead 0DTE walls.
- Payload-trust warning, silent unless something is actually wrong.

**Pine is never compiled here.** Everything above is verified only by string assertions in the test
file. `array.join`, `array.max`, `array.new_bool(n, false)`, `str.tostring(x, "#")`, `chart.bg_color`
and the lane logic have never been run by a Pine interpreter. **A paste into TradingView is the
outstanding check.**

### Options API (`src/app/api/options/[symbol]/route.ts`)

- **Expiries drop at settlement, not midnight.** Was `expiry >= today`, so the 0DTE book stayed
  selectable all evening. Now per *contract* via `expirationIso`: NDX/SPX monthlies are AM-settled
  and gone at 09:30 ET; NDXP/SPXW/ETFs trade to 16:00. Both roots share a date, so a per-date cutoff
  is wrong for one of them. `yearsToExpiry` floors at one hour, which is why expired contracts were
  priced as though an hour remained instead of failing loudly.
- A requested date the *clock* invalidated is no longer a 400 — it falls back and reports
  `selection.settledExpiries`. An unknown date still 400s.
- `?expiry=` (empty) returned **200 with zero contracts and null levels**. `??` does not catch `""`.
  Params now trim-and-normalise to null.
- New `flow` block — see Large trades below.

### Surface history (`iv_surface_history`)

Migration `iv-surface-settled-rows-v1`, already applied to the live DB:

- Deleted 10 rows captured at their own expiry's settlement. ATM IV solves divide by sqrt(T), so
  these came back at **115%, 159%, 233%, 354%**. Unrecoverable, so deleted. New ones are refused
  inside an hour of settlement, measured in real time — `yearsToExpiry` cannot tell 8 minutes from 60.
- `loadSurfaceHistory` ordered `dte ASC`, returning the *shortest*-dated row inside the tolerance
  rather than the closest. A 1DTE request got a 0DTE row whenever one existed, so NDX reported its
  session IV change against **115% instead of 34.4%**. Now orders by distance from target.
- `dte` was measured from `max(observationDate, today)`, so every row written from a stale snapshot
  was misfiled — the 24 July file, first read on the 27th, had all 61 rows three days short.
  Recomputed by the migration.

Result: 666 rows, zero misfiled, max ATM IV **3.5433 → 0.3793**.

### Greeks (`src/lib/options-math.ts`, `src/lib/normal.ts`)

All eight verified against independent references — first-order against a central difference of the
BSM price, higher-order against differences of the first-order greeks. Worst relative error 5e-6.
Charm is d(delta)/dt, decay as time *passes*; getting that sign backwards reads as a clean 200%
error. Provider-vs-model units checked on 238 live contracts: **provider vega is per vol point**,
model is per unit vol, so the `/100` in `aggregate` is correct.

`normalCdf` was **two copies** of Abramowitz & Stegun 7.1.26, and only the forecast copy was ever
tested — so the one setting every delta on the chart had never been measured. Replaced with Hart 1968
in one shared `normal.ts`. 7e-8 absolute becomes ~1e-14, and it returns a real number at -10 sigma
where the old one returned 0. 17ns vs 12ns per call.

### Macro regime (`src/app/api/macro/route.ts`, `src/lib/regime-forecast.ts`)

- **Publication nowcast** (`src/lib/server/index-nowcast.ts`, shared by macro *and* engine). FRED
  publishes equity closes the next business day, so both ran a session behind — the engine spent
  every overnight forecasting a session that had already traded. The close is already in the DB from
  the options snapshot. Guards: snapshot date must postdate the last published close, that session
  must have finished, price positive, and **both indices advance together or neither**.
- **Next-session outlook with a calibrated confidence.** Direction/behaviour autocorrelate 0.97/0.91
  at one day and the label repeats 73.5% unaided, so this is persistence, not prediction, and says
  so. Probability = share of resampled one-day score changes leaving both labels intact. Raw is
  **overconfident by ~6.8%** (the score is smoothed, so it reaches thresholds on runs); a Platt
  scaler fitted only on already-resolved forecasts brings bias to -0.3%, Brier 0.1596 vs 0.1906 base.
- **Pivot return** — the exact shared index move that would change the direction label. More useful
  than the probability, and it is not estimated.
- Horizon is now in the question ("How has this market behaved over 20 sessions?"), and measured vs
  projected labels are visually separated. They are identical strings for different sessions, which
  confused the user badly.
- `OUTPUT_CACHE_KEY` is derived from `METHODOLOGY_VERSION`. They were two hand-kept strings, so
  adding a payload field served the old shape for the whole window — and indefinitely on a failed
  refresh, since the error path returns whatever is stored. **Bump the version when the payload
  shape changes.**

### Engine (`src/app/api/engine/route.ts`, `engine-v1.7.1`)

`wideRangeDay` and `volatilityExpansion` beat baseline (q = 2.4e-12, 1.9e-10) and had **no live
probability** — only backtest metrics. The page led with `direction`, which has none (q = 0.365).
Both now publish under `forecast.sessionCharacter` and render on `/engine` with their base rates.
Every input is known at the prior close, so it reads before the open.

### New data

- **Newspaper uncertainty** (FRED, no key): `USEPUINDXD`, `WLEMUINDXD` (both **daily**),
  `GEPUCURRENT` (monthly). The daily pair is 20-session averaged; raw prints are far too noisy.
- **Geopolitical risk** (`src/lib/server/geopolitical-sources.ts`) — Caldara and Iacoviello. Daily
  index back to 1985, threats/acts split, 44 countries. Published **only** as legacy `.xls`; the
  `.xlsx` and `.csv` paths were checked and 404. Hence the `xlsx` dependency, taken from **SheetJS's
  own CDN (0.20.3)**, not the `0.18.5` stranded on npm with open advisories. Wrapped in
  `.catch(() => null)` — an academic site must never fail the macro page. Currently 174.8 against a
  100 long-run normal.

### Large trades (`src/lib/block-flow.ts`, "Large trades" shelf)

Not iceberg detection — that needs tick prints and book depth no free source publishes. This is
size: volume says how much traded, the open-interest change says how much stayed on.

**The alignment is the whole thing, and it is not intuitive.** Open interest lags a session: the
change between two chains is produced by the **earlier** one's volume. Measured on six stored NDX
chains — 0.2% impossible readings that way, **7.6%** the other. Backwards would label opens as
closes across the entire panel.

Ranked on **premium at risk** (extrinsic only). Gross premium fills the table with deep in-the-money
strikes whose price is mostly intrinsic — a 30000P against a 27192 spot is a $112M cheque that says
nothing. Two bugs caught against live data: contracts expiring the day they traded were `pending`
(now `expired`), and the route priced an old session against *today's* spot, which wiped extrinsic
value off every call and produced a 100%-puts ranking. Each session now prices against its own spot.

## Traps

- **Bash mangles template literals.** Heredocs and `node -e` containing `${...}` get eaten by the
  shell. This bit me repeatedly, including while writing this file. **Use the Write/Edit tools for
  anything containing `${}` or a regex.**
- **`/tmp` in Bash is not `/tmp` in Node** on this box. Use a repo-local scratch dir.
- Port 3000 is often held by the user's own dev server; 3001 is safe.
- SSR shows loading states — the dashboards fetch client-side, so `curl | grep` will not find
  rendered markup. There is **no browser tooling in the repo**, so no rendered UI here has been
  visually verified. Component logic is tested by extracting pure helpers into `.ts` modules.
- `next-env.d.ts` is rewritten differently by `next dev` and `next build`. `git checkout` it before
  committing.
- The macro route holds **two copies** of the regime scoring (`marketStateAt` and an inline block)
  with a guard that **throws** if they diverge by more than 1. Change both.

## Release and packaging notes

- The public README now describes the current Macro, Options, Engine, and experimental Equity Desk areas and makes no alpha claim.
- On 2026-09-30, `npm run check` passed on Node 24.14.0: ESLint, all 172 tests, and the production build. `npm audit` is clean after updating Next.js and `sharp`.
- A local production server using a temporary SQLite database returned `ok` from `/api/health` and HTTP 200 for the homepage. The temporary database was removed afterward.
- Docker Compose defines one production-mode Next.js instance with a persistent named SQLite volume. Docker was unavailable in the verification environment, so container build and persistence remain unverified.
- A source-terms review found material restrictions for the current automated Yahoo, Cboe, Nasdaq, and StockAnalysis adapters. No permissions are on file. Do not operate these adapters until their use is authorized or they are replaced; details and source links are in `docs/data-sources.md`.
- SEC requests use `GEXLAB_SEC_CONTACT`; configure a real monitored email in the runtime environment. Do not commit it.
- The automated checks do not replace a source-level review or the external TradingView, provider-terms, SEC-contact, and hosted-operations checks.

## Open items, in priority order

1. **Review the complete release diff.** Automated checks passed, but they do not constitute a source-level or visual review.
2. **Resolve provider rights.** Obtain written authorization for the current automated data integrations or replace them with licensed sources before operating them.
3. **Build and exercise Docker Compose on the intended host.** Verify the named volume survives container replacement and test backup/restore.
4. **Paste the Pine into TradingView.** String assertions do not compile the indicator.
5. Configure `GEXLAB_SEC_CONTACT` and set up access controls, HTTPS, monitoring, backups, and recovery before public hosting.
6. Decide whether to schedule `npm run collect:intraday` every 15 minutes during RTH. The script takes one sample and exits; it is optional, and each missed session is unrecoverable for positioning research.
7. Absolute histogram magnitude in the bridge — the profile normalises to +/-100 of its own peak, so
   a dead tape and a monster expiry draw identically.
8. Country-level geopolitical detail and the 8 category shares are parsed but not surfaced.
9. UI direction: reference dashboards can inform information hierarchy, but keep the GEXLab visual
   style. A composite score should show its contribution breakdown; avoid flat equal-weight tiles.

## Product context

NQ/NDX is the primary use case. State the forecast horizon and data source, show freshness, and
prefer an unavailable value to a number that cannot be measured reliably.
