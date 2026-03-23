import logging
import os
from time import perf_counter

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from api.errors import InvalidTickerError, NoOptionsDataError, RateLimitError, UpstreamAPIError
from api.futures_map import get_futures_translation
from api.options_chain import fetch_options_chain
from api.yfinance_client import YFinanceClient

logging.basicConfig(
    level=os.getenv('GEXLAB_LOG_LEVEL', 'INFO').upper(),
    format='%(asctime)s %(levelname)s %(name)s %(message)s',
)
logger = logging.getLogger(__name__)

app = FastAPI(title='GEXLAB Backend', version='3.1.0')

allowed_origins = [
    origin.strip()
    for origin in os.getenv('GEXLAB_ALLOWED_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000,null').split(',')
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=['GET'],
    allow_headers=['*'],
)

data_client = YFinanceClient()


@app.exception_handler(RateLimitError)
async def rate_limit_exception_handler(_, exc: RateLimitError):
    return JSONResponse(
        status_code=429,
        content={
            'error': 'rate_limited',
            'detail': str(exc),
            'retry_after_seconds': 60,
        },
        headers={'Retry-After': '60'},
    )


@app.exception_handler(InvalidTickerError)
async def invalid_ticker_exception_handler(_, exc: InvalidTickerError):
    return JSONResponse(status_code=404, content={'error': 'invalid_ticker', 'detail': str(exc)})


@app.exception_handler(NoOptionsDataError)
async def no_options_exception_handler(_, exc: NoOptionsDataError):
    return JSONResponse(status_code=404, content={'error': 'no_options_data', 'detail': str(exc)})


@app.exception_handler(UpstreamAPIError)
async def upstream_exception_handler(_, exc: UpstreamAPIError):
    return JSONResponse(status_code=502, content={'error': 'upstream_error', 'detail': str(exc)})


@app.get('/api/health')
async def health_check():
    return {
        'status': 'ok',
        'service': 'gexlab-backend',
        'allowed_origins': allowed_origins,
    }


@app.get('/api/data-status')
async def data_status():
    is_connected = await data_client.check_connection()
    return {'api_connected': is_connected}


def _build_gex_response(ticker: str, max_expirations: int) -> dict:
    result = fetch_options_chain(ticker, max_expirations=max_expirations)
    futures = get_futures_translation(ticker, result.get('spot', 0))
    result['futures'] = futures
    return result


@app.get('/api/gex/{ticker}')
async def get_gex_data(ticker: str, max_expirations: int = Query(default=3, ge=1, le=10)):
    symbol = ticker.upper()
    started_at = perf_counter()

    try:
        result = await run_in_threadpool(_build_gex_response, symbol, max_expirations)
        logger.info(
            'gex_request_completed ticker=%s max_expirations=%s duration_ms=%.1f cache_hit=%s',
            symbol,
            max_expirations,
            (perf_counter() - started_at) * 1000,
            result.get('meta', {}).get('cache_hit'),
        )
        return result
    except (RateLimitError, InvalidTickerError, NoOptionsDataError, UpstreamAPIError):
        raise
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception('gex_request_failed ticker=%s max_expirations=%s', symbol, max_expirations)
        raise HTTPException(status_code=500, detail='Internal server error while computing GEX.') from exc
