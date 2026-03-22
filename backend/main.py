from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.yfinance_client import YFinanceClient

app = FastAPI(title="GEX Dashboard Backend (YFinance)", version="1.0.0")

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
