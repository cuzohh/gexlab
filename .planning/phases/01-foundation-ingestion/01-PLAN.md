# Phase 01: Foundation & Ingestion - Plan

## Objective
Establish the project monorepo, initialize the Python backend (FastAPI), the Next.js frontend, and implement the core `yfinance` ingestion engine with dynamic basis calculation.

## Requirements Addressed
- [REQ-01] Connect to yfinance for options chains.
- [REQ-03] Calculate the Basis (Future Price - ETF Price).
- [REQ-04] Basic health check API.

## Plans

### Plan 01: Monorepo & Environment Setup
**Wave 1 | Autonomous: True**
- **Objective**: Scaffold the root directory, initialize Git, and create Python/Next.js subdirectories.
- **Tasks**:
  1. `<action>Create 'backend' directory and initialize Python venv.</action><read_first>README.md</read_first><acceptance_criteria>backend/venv exists</acceptance_criteria>`
  2. `<action>Initialize Next.js in 'frontend' directory using npx create-next-app@latest ./ --typescript --tailwind --eslint.</action><read_first>README.md</read_first><acceptance_criteria>frontend/package.json exists</acceptance_criteria>`
  3. `<action>Create root .gitignore for both Python and Node.js.</action><read_first>.gitignore</read_first><acceptance_criteria>.gitignore contains venv and node_modules</acceptance_criteria>`

### Plan 02: GexIngestionService (Python)
**Wave 2 | Autonomous: True**
- **Objective**: Build the service that fetches raw options chains from Yahoo Finance.
- **Tasks**:
  1. `<action>Create 'backend/services/ingestion.py' with a class GexIngestionService that uses yfinance to fetch all available expiries.</action><read_first>backend/services/ingestion.py</read_first><acceptance_criteria>Service can list SPY expiries</acceptance_criteria>`
  2. `<action>Implement 'fetch_chain_for_date' method with adaptive rate limiting (time.sleep).</action><read_first>backend/services/ingestion.py</read_first><acceptance_criteria>Chain contains strike, OI, and volume columns</acceptance_criteria>`
  3. `<action>Implement internal cache mapping to store the most recent chains.</action><read_first>backend/services/ingestion.py</read_first><acceptance_criteria>Cache prevents redundant API hits for 60s</acceptance_criteria>`

### Plan 03: BasisService & FastAPI App
**Wave 2 | Autonomous: True**
- **Objective**: Create the math service for Basis calculation and the main API shell.
- **Tasks**:
  1. `<action>Create 'backend/services/basis.py' to fetch ES=F and NQ=F prices and calculate the delta from SPY/QQQ.</action><read_first>backend/services/basis.py</read_first><acceptance_criteria>Basis returns a float value</acceptance_criteria>`
  2. `<action>Create 'backend/main.py' using FastAPI with /api/health and /api/metrics/raw endpoints.</action><read_first>backend/main.py</read_first><acceptance_criteria>GET /api/health returns 200</acceptance_criteria>`
  3. `<action>Add a background task in FastAPI to trigger the GexIngestionService periodically.</action><read_first>backend/main.py</read_first><acceptance_criteria>Logs show periodic ingestion start</acceptance_criteria>`

### Plan 04: Frontend Shell & Connectivity
**Wave 3 | Autonomous: True**
- **Objective**: Setup the basic Next.js page and ensure it can hit the backend.
- **Tasks**:
  1. `<action>Modify 'frontend/app/page.tsx' to include a basic 'Service Status' dashboard.</action><read_first>frontend/app/page.tsx</read_first><acceptance_criteria>Page shows "Backend Status: Checking..."</acceptance_criteria>`
  2. `<action>Implement basic fetch logic to ping /api/health from the frontend.</action><read_first>frontend/app/page.tsx</read_first><acceptance_criteria>Dashboard shows "Backend: Online" when FastAPI is running</acceptance_criteria>`

## Verification Criteria
### Automated
- `pytest` for `ingestion.py` and `basis.py` (mocking yfinance).
- `npm run lint` in the frontend.

### Manual (UAT)
- Run the backend, check logs for successful `yfinance` ingestion.
- Open the UI and confirm the "Online" status green light.

---
*must_haves*
- backend/venv
- backend/main.py
- frontend/package.json
- ingestion.py logic for multiple expiries
- basis calculation for ES/NQ
