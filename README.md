# GEXLab V3

The V3 interface foundation for a beginner-friendly NQ/ES market-regime and options-structure briefing.

## Current state

- Two primary workspaces: Macro and Options.
- Macro categories: Overview, Regime, and History.
- Options categories: Exposure, Levels, Chain, Volatility, Term Structure, and Indicator.
- Warm Ledger light theme and Ink Ledger dark theme.
- Intentional typography:
  - Instrument Sans for interface and explanations.
  - Newsreader for page questions and interpretive statements.
  - IBM Plex Mono for market values, dates, and aligned metadata.
- Custom regime map, NQ/ES exposure atlas, event runway, driver flow, and historical distribution.
- Structure Atlas with Gamma, Delta, Vanna, Charm, Vega, Speed, Zomma, and Vomma lenses.
- Progressive-disclosure research shelf for key levels, chain positioning, volatility skew, term structure, and TradingView indicator exports.
- Compact chart bridge with a Pine v6 indicator and a MotiveWave Java study for 0DTE, 1DTE, gamma,
  and delta levels. Both read the same payload; see [motivewave/README.md](motivewave/README.md).
- The indicator treats NDX/NDXP and SPX/SPXW as the option sources and NQ/ES as chart targets.
- Native index strikes can be converted with a synchronized observed ratio or additive basis; the last
  valid cash-session relationship is held outside cash hours to avoid converting against a stale index print.
- Bridge payloads identify native versus futures-ready price space, preventing accidental double conversion.
- Persistent SQLite storage for option snapshots, futures settlements, macro observations, release
  vintages, refresh timestamps, and versioned calculation outputs.
- EOD options mode makes no recurring requests. Live mode checks the active index/ETF pair once per
  15-minute window during regular market hours and reuses the saved full chain for every UI control.
- Daily NQ/ES settlements are stored by trade date and reused across restarts.
- Macro observations use direct releases where the definition and freshness match, with persistent
  fallback coverage for the remaining series.
- Raw observations and calculated outputs are stored separately so formulas can be validated and
  recalculated without redownloading history.

The local database is created at `data/gexlab.sqlite` and is intentionally excluded from source
control. Set `GEXLAB_DATA_DIR` to use a different storage directory.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

Node.js 22.5 or newer is required for the built-in SQLite runtime. Node.js 24 is recommended.

## Verify

```powershell
npm run lint
npm test
npm run build
npm audit --omit=dev
```

`npm run check` runs lint, deterministic calculation tests, and the production build together.

## Calculation policy

- Snapshot timestamps are normalized before any expiry-time calculation.
- Higher-order Greeks use the saved snapshot valuation time, never the current wall clock.
- Standard NDX/SPX roots use their AM settlement clock; NDXP/SPXW and ETF roots use the PM close.
- Missing delta, gamma, or vega values are modeled from snapshot IV instead of being silently set to zero.
- Gamma flip is the nearest zero found by repricing the selected book across candidate spot values.
  The simpler strike-profile crossing remains a separate diagnostic.
- Primary walls use the strongest signed gamma strike on the appropriate side of spot within a documented
  ±6% trading window; larger tail concentrations remain visible in the profile and export.
- The modeled risk-free input uses the latest 3-month Treasury observation available as of the option snapshot.
- Missing observations remain unavailable rather than becoming zero.
- Blank economic CSV observations are rejected explicitly and cannot enter return or volatility calculations.
- Macro series are checked for chronological order, duplicate dates, finite values, and reasonable
  latest-value ranges before regime calculations run.
- Formula changes require a methodology-version bump so saved results remain reproducible.
- Locally captured macro revisions support point-in-time reconstruction going forward. History from
  before local capture remains clearly labeled as a revised-data reconstruction. Its outcome window begins
  no earlier than the end of the following month to reduce release look-ahead.
