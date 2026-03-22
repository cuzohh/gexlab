# Research Summary: GEX Dashboard Ecosystem

## Market Landscape
- **Premium Tools:** GEXRADAR, SpotGamma, Barchart, Unusual Whales.
- **Data Prerequisite:** Live options chains with Greeks (Delta, Gamma, Theta, Vega).
- **Key Metric:** GEX (Gamma Exposure) measuring dealer hedging flow per 1% move.

## Data Source: ThetaData
- **Prerequisite:** Java 11+ and ThetaTerminal running locally/containerized.
- **API:** REST API (Port 25510 default) or Python SDK (`thetadata-api-python`).
- **Free Tier:** EOD (End of Day) data for all tickers. Real-time requires monthly sub.
- **Capabilities:** Historical greeks, bulk options chains, snapshots, unusual flow.

## Implementation Stack
- **Backend:** Python (FastAPI).
- **Processing:** NumPy/Pandas for vectorised math.
- **Frontend:** React + Vite.
- **Charts:**
    - **Lightweight Charts (TradingView):** Best for price action.
    - **Plotly.js / ECharts:** Best for horizontal bar GEX plots and Heatmaps.
    - **D3.js:** For custom "Unusual Flow" bubble charts.

## Key Challenges & Pitfalls
1. **ThetaTerminal Dependency:** The app won't work without the local terminal process. Need clear setup instructions.
2. **Math Precision:** GEX math requires scaling by `Spot²` and `0.01` (1% move). Small errors in scaling lead to massive distortions.
3. **Data Volume:** Full options chains can be massive (thousands of rows). Need efficient pagination/caching.
4. **0DTE Volatility:** Gamma explodes near expiration. Math needs to handle very high gamma values without overflow.
