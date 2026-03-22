from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from api.yfinance_client import YFinanceClient
from api.options_chain import fetch_options_chain

app = FastAPI(title="GEX Dashboard Backend", version="2.0.0")

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
    max_expirations: int = Query(default=6, ge=1, le=20)
):
    """
    Fetch the full GEX analysis for a given ticker.
    
    Returns:
      - spot: current underlying price
      - gex_by_strike: per-strike GEX data (call_gex, put_gex, net_gex, oi, volume, iv)
      - key_levels: call_wall, put_wall, zero_gamma, max_pain, vol_trigger
      - expirations: list of expiry dates used
      - net_gex: total net GEX (billions)
      - net_dex: Delta Exposure (billions)
      - regime: LONG_GAMMA or SHORT_GAMMA
      - heatmap_data: per-expiry per-strike GEX for heatmap rendering
    """
    try:
        result = fetch_options_chain(ticker.upper(), max_expirations=max_expirations)
        return result
    except Exception as e:
        return {"error": str(e), "ticker": ticker}
