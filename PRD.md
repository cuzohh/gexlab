# GEXLAB Dashboard

## Objective
Build a free, web-based Gamma Exposure (GEX) dashboard to provide institutional-grade options analytics to retail traders.

## Core Features
- **OI Gamma Exposure:** Visualise dealer gamma by strike and expiry. Identify call walls, put walls, and the gamma flip level.
- **GEX Heatmap:** Per-expiry √-normalised heatmap showing dealer exposure across all live expirations.
- **Unusual Flow:** Bubble chart of high Vol/OI prints filtered by premium threshold.
- **Intraday Replay:** Step through the trading session bar by bar to see gamma shifts.
- **Daily Key Levels:** Gamma flip, vol trigger, call wall, put wall, max pain with distance from spot.
- **Live Data:** refresh every 60 seconds with live badge and computed greeks.

## Tech Stack
- **Backend:** Python (FastAPI) for data retrieval and GEX calculations (Black-Scholes).
- **Frontend:** React + Vite (Vanilla CSS) for a premium, dark-mode dashboard feel.
- **Data Provider:** Reliable options market data API (e.g., Yahoo Finance).
- **Visuals:** ECharts for complex, high-performance visualizations.

## Formula
GEX = Gamma × Open Interest × 100 × Spot² × 0.01 / 1,000,000,000
(Billions of dollars per 1% move).
