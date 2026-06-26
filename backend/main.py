from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import logging
from services.ingestion import GexIngestionService
from services.basis import BasisService
from services.analytics.service import GexAnalyticsService
from services.analytics.levels import LevelIntelligenceService
from services.analytics.bridge import BridgeService
from services.storage import SnapshotStorageService
from services.macro_events import MacroEventsService
from models import (
    AnalyticsResponse,
    BridgePayloadResponse,
    ErrorResponse,
    HealthResponse,
    RawMetricsResponse,
    RootResponse,
    SnapshotDatesResponse,
    SnapshotResponse,
    MacroEventsResponse,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

app = FastAPI(title="GexLab v2 API")

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to localhost:3000
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global store
state = {
    "tickers": ["SPY", "QQQ"],
    "data": {
        "SPY": {"raw": {}, "basis": {}, "analytics": {}},
        "QQQ": {"raw": {}, "basis": {}, "analytics": {}}
    },
    "is_running": False
}

ingestion_services = {t: GexIngestionService(t) for t in state["tickers"]}
analytics_service = GexAnalyticsService()
levels_service = LevelIntelligenceService()
bridge_service = BridgeService()
snapshot_service = SnapshotStorageService()
macro_events_service = MacroEventsService()

async def update_data_loop():
    """Background loop to refresh market data for all tickers."""
    state["is_running"] = True
    while state["is_running"]:
        for ticker in state["tickers"]:
            try:
                logger.info(f"Background update starting for {ticker}...")
                ingestion = ingestion_services[ticker]
                
                # 1. Fetch raw options chain
                raw_data = ingestion.fetch_full_chain(expiries_to_fetch=3)
                state["data"][ticker]["raw"] = raw_data
                
                # 2. Fetch basis
                basis_data = BasisService.get_futures_basis(ticker)
                state["data"][ticker]["basis"] = basis_data

                # 3. Running Analytics & Levels
                if raw_data.get("data"):
                    logger.info(f"Running quant analytics suite for {ticker}...")
                    analytics = analytics_service.process_chain(raw_data)

                    if analytics:
                        logger.info(f"Extracting levels for {ticker}...")
                        levels = levels_service.get_market_levels(analytics, raw_data)
                        analytics["levels"] = levels

                    state["data"][ticker]["analytics"] = analytics
                    snapshot_date = raw_data.get("timestamp", "")[:10] or None
                    snapshot_service.save_snapshot(
                        ticker=ticker,
                        raw_data=raw_data,
                        basis_data=basis_data,
                        analytics_data=analytics,
                        snapshot_date=snapshot_date,
                    )
                
                logger.info(f"Update successful for {ticker}.")
            except Exception as e:
                logger.exception(f"Error updating {ticker}: {e}")
            
            # Brief pause between tickers to avoid rate limits
            await asyncio.sleep(2)
        
        # Wait 30 seconds before next full cycle
        await asyncio.sleep(30)

@app.on_event("startup")
async def startup_event():
    # Start the background poller
    asyncio.create_task(update_data_loop())

@app.get("/", response_model=RootResponse)
async def root() -> RootResponse:
    return {"message": "GexLab v2 API is running. Visit /api/health for status."}

@app.get("/api/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return {
        "status": "healthy",
        "service": "GexLab v2 Backend",
        "polling": state["is_running"]
    }

@app.get("/api/metrics/raw", response_model=RawMetricsResponse)
async def get_raw_metrics() -> RawMetricsResponse:
    """Returns the latest raw options chain data and basis info."""
    return {
        "metrics": {ticker: state["data"][ticker]["raw"] for ticker in state["tickers"]},
        "basis": {ticker: state["data"][ticker]["basis"] for ticker in state["tickers"]}
    }

@app.get("/api/metrics/analytics/{ticker}", response_model=AnalyticsResponse | ErrorResponse)
async def get_analytics_metrics(ticker: str) -> AnalyticsResponse | ErrorResponse:
    """Returns aggregated GEX/DEX/Vanna for the requested ticker."""
    if ticker not in state["data"]:
        raise HTTPException(status_code=404, detail="Ticker not tracked")

    analytics = state["data"][ticker]["analytics"]
    if analytics:
        return analytics
    raise HTTPException(status_code=503, detail="No analytics available yet")

@app.get("/api/metrics/bridge/{ticker}", response_model=BridgePayloadResponse)
async def get_bridge_payload(ticker: str) -> BridgePayloadResponse:
    """Returns the compressed bridge string for the requested ticker."""
    if ticker not in state["data"]:
        raise HTTPException(status_code=404, detail="Ticker not tracked")

    if state["data"][ticker]["analytics"]:
        analytics = state["data"][ticker]["analytics"]
        return {
            "payload": bridge_service.generate_tv_payload(analytics),
            "timestamp": analytics.get("summary", {}).get("timestamp")
        }
    return {"payload": "", "error": "No data available"}


@app.get("/api/history/{ticker}/dates", response_model=SnapshotDatesResponse)
async def get_snapshot_dates(ticker: str) -> SnapshotDatesResponse:
    ticker_key = ticker.upper()
    if ticker_key not in state["data"]:
        raise HTTPException(status_code=404, detail="Ticker not tracked")

    return {
        "ticker": ticker_key,
        "dates": snapshot_service.list_snapshot_dates(ticker_key),
    }


@app.get("/api/history/{ticker}/{snapshot_date}", response_model=SnapshotResponse)
async def get_snapshot(ticker: str, snapshot_date: str) -> SnapshotResponse:
    ticker_key = ticker.upper()
    if ticker_key not in state["data"]:
        raise HTTPException(status_code=404, detail="Ticker not tracked")

    snapshot = snapshot_service.load_snapshot(ticker_key, snapshot_date)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return snapshot


@app.get("/api/events/macro", response_model=MacroEventsResponse)
async def get_macro_events() -> MacroEventsResponse:
    return {"events": await macro_events_service.get_events()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
