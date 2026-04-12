from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import logging
from .services.ingestion import GexIngestionService
from .services.basis import BasisService
from .services.analytics.service import GexAnalyticsService
from .services.analytics.levels import LevelIntelligenceService

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
    "raw_data": {},
    "basis": {},
    "analytics": {},
    "is_running": False
}

ingestion_service = GexIngestionService("SPY")
analytics_service = GexAnalyticsService()
levels_service = LevelIntelligenceService()

async def update_data_loop():
    """Background loop to refresh market data."""
    state["is_running"] = True
    while state["is_running"]:
        try:
            logger.info("Background update starting...")
            # 1. Fetch raw options chain
            raw_data = ingestion_service.fetch_full_chain(expiries_to_fetch=3)
            state["raw_data"] = raw_data
            
            # 2. Fetch basis
            basis_data = BasisService.get_futures_basis("SPY")
            state["basis"] = basis_data

            # 3. Running Analytics & Levels
            if raw_data.get("data"):
                logger.info("Running quant analytics suite...")
                analytics = analytics_service.process_chain(raw_data)
                
                logger.info("Extracting level intelligence...")
                levels = levels_service.get_market_levels(analytics, raw_data)
                analytics["levels"] = levels
                
                state["analytics"] = analytics
            
            logger.info("Background update successful.")
        except Exception as e:
            logger.error(f"Error in background update: {e}")
        
        # Wait 30 seconds before next refresh
        await asyncio.sleep(30)

@app.on_event("startup")
async def startup_event():
    # Start the background poller
    asyncio.create_task(update_data_loop())

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "GexLab v2 Backend",
        "polling": state["is_running"]
    }

@app.get("/api/metrics/raw")
async def get_raw_metrics():
    """Returns the latest raw options chain data and basis info."""
    return {
        "metrics": state["raw_data"],
        "basis": state["basis"]
    }

@app.get("/api/metrics/analytics")
async def get_analytics_metrics():
    """Returns the aggregated GEX/DEX/Vanna exposures."""
    return state["analytics"]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
