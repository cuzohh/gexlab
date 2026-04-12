# Research: Stack - GexLab v2

## Backend
- **FastAPI**: Main API framework for high-concurrency async handling.
- **Pydantic**: For strict data validation and type safety.
- **py_vollib**: Core library for Black-Scholes Greeks and Implied Volatility.
- **Pandas/NumPy**: Essential for aggregating massive options chains and performing vector calculations.
- **Redis**: Local cache to persist the latest chain and avoid redundant API hits.

## Data Providers
- **yfinance**: Primary "Free" provider for delayed options chains.
- **MarketData.app**: Secondary fallback (has a limited free tier with better data quality).
- **Custom Scraper**: Internal logic to handle the specific "15-sec delayed" sources mentioned by the user.

## Frontend
- **Next.js**: Framework for the UI.
- **Tailwind CSS**: Styling.
- **Lucide React**: Icons.
- **Framer Motion**: Smooth transitions for the "premium" feel.
- **Shadcn/UI**: Component library.

## Deployment/Execution
- **Local Dev Server**: Python and Node running locally.
- **Docker (Optional)**: For easy environment replication.
