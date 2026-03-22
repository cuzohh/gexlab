# Project Roadmap: GEX Dashboard

## Phases

### Phase 1: Setup & Data Connectivity
- [ ] Initialize Python environment (v3.10+) and ThetaTerminal requirements
- [ ] Create FastAPI backend structure and health-check endpoint
- [ ] Build ThetaData client class for fetching options chains and greeks
- [ ] Add basic UI scaffolding with Vite + React

### Phase 2: GEX Engine & Calculus
- [ ] Implement vectorized math engine for GEX, DEX, VEX, CEX
- [ ] Build endpoint for GEX by strike across multiple expirations
- [ ] Implement GEX scaling formula (Spot² × 0.01 / 1B)
- [ ] Validate math against sample data points

### Phase 3: UI Skeleton & Design System
- [ ] Define CSS design tokens (Colors, Typography, Spacing) for premium dark theme
- [ ] Build global layout with sidebar and grid-based dashboard containers
- [ ] Implement glassmorphism effects and micro-animations for interactivity
- [ ] Add ticker search and status bar components

### Phase 4: Core Analytics Visuals
- [ ] Build OI Gamma Exposure horizontal bar chart (React + ECharts/Plotly)
- [ ] Implement GEX Heatmap with √-normalization for strike/expiry intensity
- [ ] Add tooltips and level labels (Call Wall, Put Wall, Zero GEX)
- [ ] Sync chart components with backend data streams

### Phase 5: Unusual Flow & Advanced Metrics
- [ ] Build "Unusual Flow" bubble chart (Vol/OI prints > premium threshold)
- [ ] Calculate VEX (Vega Exposure) and CEX (Charm Exposure)
- [ ] Add sidebar for "Major Walls" and "Greeks Snapshot"
- [ ] Implement Vol Trigger extraction logic

### Phase 6: Intraday Replay & Live UX
- [ ] Create time-range slider for stepping through intraday bar snapshots
- [ ] Implement 60-second auto-refresh for live feeds
- [ ] Add "Live" badge and "Last Updated" timestamp logic
- [ ] Final polishing of responsive layout and performance audit

---
*Last updated: 2026-03-22*
