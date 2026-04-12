# Project: GexLab v2 - All-Inclusive Options Flow Analysis Suite

## What This Is
A local-first, high-fidelity options flow analysis platform designed to calculate Dealer Gamma Exposure (GEX), Greeks (Standard and Higher-Order), and institutional-grade market levels. It provides a sleek UI for monitoring and a "copy-paste" integration for TradingView indicators, allowing users to visualize complex options-derived levels on futures charts (ES/NQ).

## Core Value
To provide institutional-grade options positioning data (GEX, Walls, Flip, Skew) for free or low-cost, bridging the gap between raw options chain data and actionable technical analysis levels on Futures charts.

## Context
- **Target Audience**: Retail quants and futures traders (NQ/ES).
- **Primary Integration**: Manual "Copy String" for TradingView Pine Script inputs.
- **Market Data**: Targeting ~15s delayed data (Yahoo Finance baseline, extensible to Tradier/Polygon).
- **Hosting**: Local execution (Windows).

## Requirements

### Backend (Python/FastAPI)
- [ ] **Data Provider Engine**: Flexible interface for fetching full options chains (initially `yfinance`).
- [ ] **Quant Engine**: Implementation of Black-Scholes for all standard Greeks (Delta, Gamma, Vega, Theta, Rho).
- [ ] **Higher-Order Greeks**: Implementation of Vanna, Charm, Vomma, Speed, Zomma, and Color.
- [ ] **GEX Aggregation**: Per-strike and per-expiry GEX calculation ($\text{Gamma} \times \text{OI} \times \text{Spot}^2 \times 0.01$).
- [ ] **Key Level Detection**:
    - Gamma Flip (Zero Gamma)
    - Call Wall / Put Wall
    - Max Pain (minimum holder P&L strike)
    - Vol Trigger (Vanna peak)
    - Volatility Skew (Put/Call skew levels)
- [ ] **Futures Conversion**: Accurate basis-adjusted price mapping (e.g., SPY -> ES).
- [ ] **Morning Report API**: Snapshot of EOD data with key levels for the session ahead.
- [ ] **Real-time API**: Periodic polling and re-calculation for intraday updates.

### Frontend (Next.js/React + Tailwind)
- [ ] **Dashboard**: Sleek, high-alpha UI (Dark Mode, Glassmorphism).
- [ ] **Metrics Display**: Quick-look cards for Spot, Net GEX, GEX Ratio, IV/RV Spread.
- [ ] **Level Table**: List of all key levels with "Regime Interpretation" (e.g., "Trending Mode" if Spot < Flip).
- [ ] **TradingView Exporter**: One-click button to copy a Pine Script-ready JSON string.
- [ ] **Visualizations**: Charts for GEX by strike, Vanna/Charm curves (optional but desired).

## Key Decisions
| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Local Python Backend | Ensures speed, privacy, and full control over quant math. | — Pending |
| Manual TV Copy/Paste | Avoids Pine Script external data limitations and approval hurdles. | — Pending |
| YFinance Baseline | Only 100% free source for full chains with minimal delay. | — Pending |

## Evolution
This document evolves at phase transitions and milestone boundaries.

**After each phase transition**:
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

---
*Last updated: 2026-04-12 after initialization*
