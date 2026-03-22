from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.thetadata_client import ThetaClient

app = FastAPI(title="GEX Dashboard Backend", version="1.0.0")

# CORS middleware for Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

theta_client = ThetaClient()

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "gexlab-backend"}

@app.get("/api/theta-status")
async def theta_status():
    """Check if the local ThetaTerminal is responding."""
    is_connected = await theta_client.check_connection()
    return {"terminal_connected": is_connected}
