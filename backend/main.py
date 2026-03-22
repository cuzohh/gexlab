from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from api.yfinance_client import YFinanceClient
from api.options_chain import fetch_options_chain
from api.futures_map import get_futures_translation

app = FastAPI(title="GEXLAB Backend", version="3.0.0")

# CORS middleware for Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

data_client = YFinanceClient()


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "gexlab-backend"}


@app.get("/api/data-status")
async def data_status():
    """Check if Yahoo Finance data API is reachable."""
    is_connected = await data_client.check_connection()
    return {"api_connected": is_connected}


@app.get("/api/gex/{ticker}")
async def get_gex_data(
    ticker: str,
    max_expirations: int = Query(default=3, ge=1, le=10)
):
    """
    Fetch the full GEX analysis for a given ticker.
    
    Includes futures translation for tickers with futures equivalents
    (SPY→/ES, QQQ→/NQ, IWM→/RTY, DIA→/YM, TLT→/ZN, GLD→/GC, SLV→/SI, USO→/CL).
    """
    try:
        result = fetch_options_chain(ticker.upper(), max_expirations=max_expirations)
        
        # Attach futures translation if available
        futures = get_futures_translation(ticker.upper(), result.get('spot', 0))
        result['futures'] = futures
        
        return result
    except Exception as e:
        return {"error": str(e), "ticker": ticker}
