from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import logging
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
from services.ingestion import GexIngestionService
from services.cboe_ingestion import CboeIngestionService
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

@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _bg_task
    for ticker in TICKERS:
        _state_locks[ticker] = asyncio.Lock()
    # Seed state from the latest EOD snapshot so overnight/premarket loads
    # show valid data while waiting for the first good live fetch.
    for ticker in TICKERS:
        dates = snapshot_service.list_snapshot_dates(ticker)
        if dates:
            snap = snapshot_service.load_snapshot(ticker, dates[0])
            if snap and snap.get("analytics"):
                state["data"][ticker]["analytics"] = snap["analytics"]
                state["data"][ticker]["basis"] = snap.get("basis") or {}
                logger.info(f"Seeded {ticker} state from EOD snapshot {dates[0]}.")
    _bg_task = asyncio.create_task(update_data_loop())
    asyncio.create_task(cboe_eod_loop())
    yield


app = FastAPI(title="GexLab v2 API", lifespan=lifespan)

# allow_credentials must not be used with allow_origins=["*"] (Fetch spec forbids it).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TICKERS = ["SPY", "QQQ"]
MARKET_TIMEZONE = ZoneInfo("America/New_York")
EOD_SNAPSHOT_START = time(16, 5)
EOD_SNAPSHOT_FREEZE = time(17, 0)

state = {
    "tickers": TICKERS,
    "data": {
        "SPY": {"raw": {}, "basis": {}, "analytics": {}},
        "QQQ": {"raw": {}, "basis": {}, "analytics": {}}
    },
    "is_running": False
}

# Per-ticker locks ensure API handlers never read a partially-updated state dict.
_state_locks: dict[str, asyncio.Lock] = {}
# Strong reference prevents the background task from being garbage-collected.
_bg_task: asyncio.Task | None = None

ingestion_services = {t: GexIngestionService(t) for t in TICKERS}
cboe_services = {t: CboeIngestionService(t) for t in TICKERS}
analytics_service = GexAnalyticsService()
levels_service = LevelIntelligenceService()
bridge_service = BridgeService()
snapshot_service = SnapshotStorageService()
macro_events_service = MacroEventsService()


def _most_recent_trading_day(d: date) -> date:
    """Return d if it is a weekday, otherwise walk back to Friday."""
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def get_eod_snapshot_date(now: datetime | None = None) -> str | None:
    now_et = now or datetime.now(MARKET_TIMEZONE)
    if now_et.tzinfo is None:
        now_et = now_et.replace(tzinfo=MARKET_TIMEZONE)
    else:
        now_et = now_et.astimezone(MARKET_TIMEZONE)

    today = now_et.date()

    # During the primary EOD window on a weekday, target today.
    if now_et.weekday() < 5 and now_et.time() >= EOD_SNAPSHOT_START:
        return today.isoformat()

    # Outside that window (overnight, premarket, weekend) target the most
    # recent trading day so a missing snapshot can still be back-filled.
    candidate = _most_recent_trading_day(
        today if now_et.time() >= EOD_SNAPSHOT_START else today - timedelta(days=1)
    )
    return candidate.isoformat()


def should_save_eod_snapshot(
    ticker: str,
    snapshot_date: str | None,
    now: datetime | None = None,
    snapshot_store: SnapshotStorageService | None = None,
) -> bool:
    if snapshot_date is None:
        return False

    now_et = now or datetime.now(MARKET_TIMEZONE)
    if now_et.tzinfo is None:
        now_et = now_et.replace(tzinfo=MARKET_TIMEZONE)
    else:
        now_et = now_et.astimezone(MARKET_TIMEZONE)

    # During the primary EOD window always overwrite (data is still settling).
    if now_et.weekday() < 5 and EOD_SNAPSHOT_START <= now_et.time() <= EOD_SNAPSHOT_FREEZE:
        return True

    # Outside the window (overnight, premarket, weekend): back-fill only if
    # the snapshot is missing — yfinance OI is unchanged until next open.
    store = snapshot_store or snapshot_service
    return not store.snapshot_exists(ticker, snapshot_date)


async def process_cboe_ticker(ticker: str, snapshot_date: str) -> None:
    """Fetch CBOE chain, run analytics, update state, save EOD snapshot."""
    cboe = cboe_services[ticker]
    raw_data = await asyncio.to_thread(cboe.fetch_chain)
    if not raw_data.get("data"):
        logger.error(f"CBOE: no data returned for {ticker}")
        return

    basis_data = await asyncio.to_thread(BasisService.get_futures_basis, ticker)
    analytics = await asyncio.to_thread(analytics_service.process_chain, raw_data)
    if not analytics:
        logger.error(f"CBOE: analytics failed for {ticker}")
        return

    levels = await asyncio.to_thread(levels_service.get_market_levels, analytics, raw_data)
    analytics["levels"] = levels
    analytics["summary"]["timestamp"] = raw_data.get("timestamp") or analytics["summary"]["timestamp"]

    async with _state_locks[ticker]:
        state["data"][ticker]["raw"] = raw_data
        state["data"][ticker]["basis"] = basis_data
        state["data"][ticker]["analytics"] = analytics

    try:
        snapshot_service.save_snapshot(
            ticker=ticker,
            raw_data=raw_data,
            basis_data=basis_data,
            analytics_data=analytics,
            snapshot_date=snapshot_date,
            source="cboe_eod",
        )
        logger.info(f"CBOE EOD snapshot saved for {ticker} ({snapshot_date}).")
    except Exception as exc:
        logger.error(f"CBOE snapshot save failed for {ticker}: {exc}")


async def cboe_eod_loop() -> None:
    """Pull CBOE EOD data daily at 5:15 PM ET, and backfill on startup if missed."""
    EOD_PULL_HOUR = 18
    EOD_PULL_MINUTE = 30

    # Always pull CBOE on startup. During market hours this returns yesterday's OI
    # (OI only settles once per day). After 6:30pm it returns today's closing OI.
    # Either way it's better than seeding from a potentially stale yfinance snapshot.
    startup_date = get_eod_snapshot_date()
    if startup_date:
        logger.info(f"CBOE startup pull for {startup_date}...")
        for ticker in TICKERS:
            try:
                await process_cboe_ticker(ticker, startup_date)
            except Exception as exc:
                logger.exception(f"CBOE startup pull failed for {ticker}: {exc}")
            await asyncio.sleep(1)

    while True:
        now = datetime.now(MARKET_TIMEZONE)
        target = now.replace(hour=EOD_PULL_HOUR, minute=EOD_PULL_MINUTE, second=0, microsecond=0)
        if now >= target:
            target = target + timedelta(days=1)
        while target.weekday() >= 5:
            target = target + timedelta(days=1)
        wait = (target - now).total_seconds()
        logger.info(f"Next CBOE EOD pull in {wait / 3600:.1f}h ({target.isoformat()})")
        await asyncio.sleep(wait)

        snapshot_date = target.date().isoformat()
        for ticker in TICKERS:
            try:
                await process_cboe_ticker(ticker, snapshot_date)
            except Exception as exc:
                logger.exception(f"CBOE EOD pull failed for {ticker}: {exc}")
            await asyncio.sleep(1)


async def update_data_loop():
    """Background loop: fetch → compute → atomically write state."""
    state["is_running"] = True
    while state["is_running"]:
        for ticker in TICKERS:
            try:
                logger.info(f"Background update starting for {ticker}...")
                ingestion = ingestion_services[ticker]

                # yfinance calls are blocking I/O — run on a thread pool thread so
                # the event loop stays responsive to API requests.
                raw_data = await asyncio.to_thread(ingestion.fetch_full_chain, expiries_to_fetch=3)
                basis_data = await asyncio.to_thread(BasisService.get_futures_basis, ticker)

                analytics = None
                spot = raw_data.get("spotPrice") or 0.0
                if raw_data.get("data") and spot > 0:
                    logger.info(f"Running quant analytics suite for {ticker}...")
                    analytics = await asyncio.to_thread(analytics_service.process_chain, raw_data)

                    if analytics:
                        logger.info(f"Extracting levels for {ticker}...")
                        levels = await asyncio.to_thread(
                            levels_service.get_market_levels, analytics, raw_data
                        )
                        analytics["levels"] = levels
                        # Use ingestion timestamp so ageMs reflects actual data age,
                        # not the time analytics finished processing.
                        analytics["summary"]["timestamp"] = (
                            raw_data.get("timestamp") or analytics["summary"]["timestamp"]
                        )
                else:
                    logger.warning(
                        f"Skipping analytics for {ticker}: "
                        f"no data or zero spot price (spot={spot})"
                    )

                # Write all keys together after all async work is done so API
                # handlers never observe a partially-updated state.
                # Skip the write if fetch returned empty — preserve last good state.
                if raw_data.get("data"):
                    contracts = raw_data["data"]
                    nonzero_oi = sum(1 for c in contracts if (c.get("openInterest") or 0) > 0)
                    oi_ratio = nonzero_oi / len(contracts) if contracts else 0.0
                    data_quality_ok = oi_ratio >= 0.05  # at least 5% of contracts have OI
                    if not data_quality_ok:
                        logger.warning(
                            f"Skipping analytics update for {ticker}: "
                            f"only {nonzero_oi}/{len(contracts)} contracts have OI ({oi_ratio:.1%})"
                        )
                    async with _state_locks[ticker]:
                        state["data"][ticker]["raw"] = raw_data
                        state["data"][ticker]["basis"] = basis_data
                        if analytics is not None and data_quality_ok:
                            state["data"][ticker]["analytics"] = analytics

                snapshot_date = get_eod_snapshot_date()
                if analytics is not None and data_quality_ok and should_save_eod_snapshot(ticker, snapshot_date):
                    logger.info(f"Saving EOD snapshot for {ticker} ({snapshot_date})...")
                    try:
                        snapshot_service.save_snapshot(
                            ticker=ticker,
                            raw_data=raw_data,
                            basis_data=basis_data,
                            analytics_data=analytics,
                            snapshot_date=snapshot_date,
                            source="eod",
                        )
                        logger.info(f"EOD snapshot saved for {ticker} ({snapshot_date}).")
                    except Exception as snap_err:
                        # Snapshot failures are logged but must not abort the update cycle.
                        logger.error(f"Snapshot save failed for {ticker} ({snapshot_date}): {snap_err}")

                logger.info(f"Update successful for {ticker}.")
            except Exception as e:
                logger.exception(f"Error updating {ticker}: {e}")

            await asyncio.sleep(2)

        await asyncio.sleep(30)


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
    result = {}
    basis = {}
    for ticker in TICKERS:
        async with _state_locks[ticker]:
            result[ticker] = state["data"][ticker]["raw"]
            basis[ticker] = state["data"][ticker]["basis"]
    return {"metrics": result, "basis": basis}


@app.get("/api/metrics/basis")
async def get_basis_metrics():
    out = {}
    for ticker in TICKERS:
        async with _state_locks[ticker]:
            out[ticker] = state["data"][ticker]["basis"]
    return {"basis": out}


@app.get("/api/metrics/analytics/{ticker}", response_model=AnalyticsResponse | ErrorResponse)
async def get_analytics_metrics(ticker: str) -> AnalyticsResponse | ErrorResponse:
    if ticker not in state["data"]:
        raise HTTPException(status_code=404, detail="Ticker not tracked")

    async with _state_locks[ticker]:
        analytics = state["data"][ticker]["analytics"]
    if analytics:
        return analytics
    raise HTTPException(status_code=503, detail="No analytics available yet")


@app.get("/api/metrics/bridge/{ticker}", response_model=BridgePayloadResponse)
async def get_bridge_payload(ticker: str) -> BridgePayloadResponse:
    if ticker not in state["data"]:
        raise HTTPException(status_code=404, detail="Ticker not tracked")

    async with _state_locks[ticker]:
        analytics = state["data"][ticker]["analytics"]
        basis = state["data"][ticker]["basis"]
    if analytics:
        return {
            "payload": bridge_service.generate_tv_payload(analytics, basis, ticker),
            "timestamp": analytics.get("summary", {}).get("timestamp")
        }
    return {"payload": "", "error": "No data available"}


@app.get("/api/metrics/bridge")
async def get_combined_bridge():
    """
    Returns legacy ETF CSVs plus the default futures-ready Pine payload.
    Pine format: es_csv|nq_csv.
    Each section: d0cw,d0pw,d0vt,d1cw,d1pw,d1vt,gp1,gp2,gp3,gp4,gp5,gn1,gn2,gn3,gn4,gn5,dc1,dc2,dc3,dp1,dp2,dp3.
    """
    spy_csv = ""
    qqq_csv = ""
    spy_greeks = ""
    qqq_greeks = ""
    es_csv = ""
    nq_csv = ""
    timestamp = None

    for ticker, attr in [("SPY", "spy"), ("QQQ", "qqq")]:
        async with _state_locks[ticker]:
            analytics = state["data"][ticker]["analytics"]
            basis = state["data"][ticker]["basis"]
        if analytics:
            main_csv   = bridge_service.generate_pine_csv(analytics)
            greek_csv  = bridge_service.generate_greek_levels_csv(analytics)
            if attr == "spy":
                spy_csv    = main_csv
                spy_greeks = greek_csv
                es_csv     = bridge_service.generate_futures_levels_csv(analytics, basis, ticker)
                timestamp  = analytics.get("summary", {}).get("timestamp")
            else:
                qqq_csv    = main_csv
                qqq_greeks = greek_csv
                nq_csv     = bridge_service.generate_futures_levels_csv(analytics, basis, ticker)
                timestamp  = analytics.get("summary", {}).get("timestamp") or timestamp

    # Pine format: es_csv|nq_csv. Each section has walls/VT plus strongest gamma and delta levels.
    pine_string = f"{es_csv}|{nq_csv}"
    return {
        "spy": spy_csv, "qqq": qqq_csv,
        "spy_greeks": spy_greeks, "qqq_greeks": qqq_greeks,
        "es": es_csv,
        "nq": nq_csv,
        "mnq": nq_csv,
        "pine": pine_string,
        "timestamp": timestamp,
    }


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
