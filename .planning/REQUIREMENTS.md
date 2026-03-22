# Scoped Requirements: GEX Dashboard V1

## R.1 — Backend Engine
- [ ] Connect to local ThetaTerminal via REST API (port 25510)
- [ ] Implement `thetadata-api-python` or custom REST calls
- [ ] Dynamic math: Calculate GEX using Spot² scaling and 1% move standard
- [ ] Endpoints: `/options-chain/{ticker}`, `/gex-history/{ticker}`, `/unusual-flow`

## R.2 — GEX Visualizations
- [ ] **GEX Bar Chart:** Horizontal bars, Green/Red for Call/Put GEX, Y-axis as Strike
- [ ] **GEX Heatmap:** X-axis as Expiration, Y-axis as Strike, Color as Intensity
- [ ] **Unusual Flow Chart:** X-axis as Strike, Y-axis as Vol/OI%, Bubble size as Premium
- [ ] **Level Overlay:** Dotted lines for Call Wall (peak pos GEX), Put Wall (peak neg GEX), Zero Gamma line

## R.3 — User Interface
- [ ] **Terminal Mode:** Premium dark theme, glassmorphism sidebar, grid layout
- [ ] **Ticker Selector:** Search box for SPY, QQQ, TSLA, etc.
- [ ] **Replay Slider:** Time-range slider at bottom for intraday replay
- [ ] **Live Badge:** Dynamic status indicator for 60s refreshes

## R.4 — Reliability & Performance
- [ ] Vectorized processing (NumPy) to handle thousands of strikes < 500ms
- [ ] Error handling for disconnected ThetaTerminal (clear visual warning)
- [ ] Client-side caching for stable data points (EOD strikes/OI)
