# Research Summary: GexLab v2

## Stack Recommendations
- **Language**: Python 3.10+
- **Quant Library**: `py_vollib` for standard Greeks; custom implementation for higher-order (Vanna, Charm).
- **Backend**: FastAPI for high-performance async API.
- **Data**: `yfinance` (Free), `ib_insync` (if Interactive Brokers used), or `Polygon.io` (Premium).
- **Frontend**: Next.js 14 (App Router), Tailwind CSS, Framer Motion for animations.
- **State/Cache**: Redis for storing the latest options chain and calculated levels.

## Features & UX
### Table Stakes
- **GEX Profiles**: Aggregate GEX per strike with Zero Gamma identification.
- **Institutional Levels**: Call Walls, Put Walls, and Max Pain.
- **Futures Mapping**: Automatic conversion from ETFs (SPY/QQQ) to Futures (ES/NQ) prices.
- **TradingView Bridge**: Copy-to-clipboard JSON payload.

### Differentiators
- **Higher-Order Greek Curves**: Vanna (vol exposure) and Charm (time exposure) heatmaps.
- **Regime Classification**: Auto-tagging the market as "Stabilizing" (Long Gamma) or "Trending" (Short Gamma).
- **Session Ceilings**: Multi-DTE aggregated ceilings.

## Architecture
- **Provider Layer**: Pluggable data fetchers to allow easy swapping of APIs.
- **Quant Engine**: Core logic for Black-Scholes and Greek aggregation.
- **Webhook/Exporter**: Logic to format data specifically for Pine Script compatibility.

## Critical Pitfalls
1. **0DTE OI Lag**: Open Interest only updates once a day; for 0DTE, we must estimate intra-day shifts using Volume.
2. **Basis Drift**: Spot-Future basis changes; the conversion engine needs real-time price feeds for both to stay accurate.
3. **Gamma Burn**: Levels lose magnetism as expiration approaches; UI must warn of "unpinning" risk.
