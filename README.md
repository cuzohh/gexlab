

https://github.com/user-attachments/assets/0f865f55-29f5-4da7-9587-a58a45307878

# GEXLab V3

GEXLab is a self-hosted market research workbench for NQ/ES. It brings macro conditions, index options structure, market history, and an experimental equity research desk into one interface. It is designed to explain the data and its limits, not to send orders.

> **Research software, not a trading system.** Data can be delayed, revised, incomplete, or unavailable. At the last local review, the daily direction model did not beat its saved out-of-sample baseline; that local database is not included in Git. No backtest result is a promise of future performance.

## What it includes

- **Macro briefing:** growth, inflation, policy, liquidity, credit, volatility, positioning, and event context, with source and freshness details.
- **Options structure:** NDX/NDXP and SPX/SPXW exposure, levels, chains, volatility surfaces, and term structure. ETF chains are also available in the stock workspace.
- **Forecast research:** NQ/ES regime and session-character outputs with historical evaluation. Treat these as research artifacts, not trade recommendations.
- **Equity desk:** company fundamentals, estimates, options, ownership, catalysts, and cross-asset context. Some pages use third-party public pages and remain experimental.
- **Chart bridge:** TradingView Pine and MotiveWave Java studies. The Pine script still needs a manual TradingView compile check; see [the MotiveWave notes](motivewave/README.md) and [release checklist](docs/production-readiness.md).
- **Local history:** source observations and versioned calculations are stored separately in SQLite so calculations can be inspected and reproduced.

## Run locally

Requirements: Node.js 22.13 or later; Node.js 24 is recommended. GEXLab uses Node's built-in SQLite API, which is still pre-stable in the Node 24 line, so pin the runtime and validate upgrades. See the [Node.js SQLite status](https://nodejs.org/api/sqlite.html).

```powershell
npm ci
npm run dev
```

Open <http://localhost:3000>. No market-data API key is required. The first request to a page may fetch upstream data; failures should appear as unavailable or stale data rather than invented values.

The database is created at `data/gexlab.sqlite`. That directory is ignored by Git. Set `GEXLAB_DATA_DIR` to move it. Copy `.env.example` to `.env.local` for local Next.js settings, or to `.env` for Docker Compose. Set `GEXLAB_SEC_CONTACT` to a real monitored email before using SEC-backed pages; keep that address and other private values out of Git. The one-pass collector scripts read environment variables from the shell that launches them.

## Collecting observations

The collector scripts make one pass and exit. Start the app first.

```powershell
npm run collect
npm run collect:intraday
```

`collect` records a daily pass when the market session is settled. `collect:intraday` records one in-session options-positioning observation; it does not schedule itself. Configure an external scheduler only if you intend to build that history. The intraday model is not validated as a strategy.

## Checks

```powershell
npm run lint
npm test
npm run build
npm run check
npm audit --omit=dev
```

`npm run check` runs lint, the existing deterministic calculation tests, and a production build.

## Run in a single-instance container

Docker Compose provides a production-mode Next.js server and a named volume for SQLite:

```powershell
docker compose up --build
```

For Compose environment values, copy `.env.example` to `.env` and fill in `GEXLAB_SEC_CONTACT` if you use SEC-backed pages. Open <http://localhost:3000>. The port is bound to loopback by default. The `/api/health` check confirms the app can read its SQLite store. The database lives in the `gexlab-v3-data` Docker volume and survives `docker compose down`; **do not use `docker compose down -v` unless you intend to delete that database**. This setup is for one app instance. SQLite WAL storage is not configured for multiple replicas or shared network filesystems.

Do not expose the included live-data adapters as a public hosted service yet. The current Yahoo, Cboe, Nasdaq, and StockAnalysis integrations need written authorization for their exact automated use or replacement with appropriately licensed sources. Before any public instance, also configure a persistent volume and backups, set `GEXLAB_SEC_CONTACT` for SEC requests, and put HTTPS and access/abuse controls in front of it. See [the programmatic-access review](docs/data-sources.md#programmatic-access-review-2026-09-30) and [production readiness](docs/production-readiness.md).

## Data and model limits

Some adapters issue direct HTTP requests to public, no-account endpoints. That does not grant programmatic-use rights; see the [source terms review](docs/data-sources.md#programmatic-access-review-2026-09-30). Sources can change formats, impose limits, or stop responding. Some market data is delayed, and some historical macro data predates GEXLab's local vintage capture; those older periods are revised-data reconstructions rather than point-in-time archives. A source list and notes are in [Data sources](docs/data-sources.md).

The interface exposes freshness and missing-data states, but users still need to check observation dates and source notes before relying on a reading. This software is for research and education. It is not investment, legal, or tax advice and does not execute trades.

## Repository notes

- [Development and contribution guide](CONTRIBUTING.md)
- [Production-readiness checklist](docs/production-readiness.md)
- [Data sources and reuse boundaries](docs/data-sources.md)
- [Product and calculation plan](PLAN.md)
- [Technical context handoff](HANDOFF.md)
- [License](LICENSE)

The MIT license applies to GEXLab-authored source code. It does not grant rights to third-party market data, provider services, or external content; see [Data sources](docs/data-sources.md).

## Version history

V3 is the current project version. The original V2 source and commits remain reachable in this repository's Git history; the history is being retained rather than reset.
