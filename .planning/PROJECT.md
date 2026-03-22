# GEX Dashboard Project (GEXRADAR Clone)

## Objective
Build a free, high-perf web dashboard replicating GEXRADAR's features using ThetaData as the source.

## Vision
A premium, dark-mode terminal for options analytics that provides institutional-grade GEX data (Call Walls, Put Walls, Gamma Flip) to retail traders at zero cost.

## Requirements

### Validated
(None yet - ship to validate)

### Active
- [ ] **Data Integration:** Fetch live/EOD options chains from ThetaData (FastAPI backend)
- [ ] **GEX Engine:** Vectorized Python math to compute GEX, DEX, VEX, CEX
- [ ] **OI Gamma Exposure Chart:** Vertical horizontal bar chart showing dealer positioning
- [ ] **GEX Heatmap:** Per-expiry heatmap with √-normalization
- [ ] **Unusual Flow:** Real-time bubble chart for Vol/OI spikes
- [ ] **Intraday Replay:** Time-slider functionality for gamma shifts
- [ ] **Key Levels Display:** Automated extraction of Call Wall, Put Wall, Zero GEX
- [ ] **UI/UX:** Premium, dark-mode terminal interface using Vite + React

### Out of Scope
- **Proprietary Data Feeds:** Stick to ThetaData (Free tier compatible)
- **Direct Trading Execution:** Analysis only for V1

## Key Decisions
| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **Vite + React** | Premium UI responsiveness and developer speed | — Approved |
| **FastAPI** | Fast, modern Python backend for math heavy lifting | — Approved |
| **Vanilla CSS** | Maximum control over glassmorphism/premium aesthetics | — Preferred |
| **ThetaData API** | Most affordable high-quality options data (OPRA) | — Locked |

## Evolution
This document evolves at phase transitions.

---
*Last updated: 2026-03-22 after initialization*
