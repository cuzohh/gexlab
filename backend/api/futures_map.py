import logging

from cachetools import TTLCache, cached
from yahooquery import Ticker

logger = logging.getLogger(__name__)

futures_cache = TTLCache(maxsize=50, ttl=600)

FUTURES_MAP = {
    'SPY': {'symbol': 'ES=F', 'name': '/ES', 'full_name': 'S&P 500 E-mini'},
    'QQQ': {'symbol': 'NQ=F', 'name': '/NQ', 'full_name': 'Nasdaq 100 E-mini'},
    'IWM': {'symbol': 'RTY=F', 'name': '/RTY', 'full_name': 'Russell 2000 E-mini'},
    'DIA': {'symbol': 'YM=F', 'name': '/YM', 'full_name': 'Dow E-mini'},
    'TLT': {'symbol': 'ZN=F', 'name': '/ZN', 'full_name': '10-Year Note'},
    'GLD': {'symbol': 'GC=F', 'name': '/GC', 'full_name': 'Gold'},
    'SLV': {'symbol': 'SI=F', 'name': '/SI', 'full_name': 'Silver'},
    'USO': {'symbol': 'CL=F', 'name': '/CL', 'full_name': 'Crude Oil'},
}


@cached(futures_cache)
def get_futures_translation(ticker: str, etf_spot: float) -> dict | None:
    mapping = FUTURES_MAP.get(ticker.upper())
    if not mapping or etf_spot <= 0:
        return None

    try:
        futures_ticker = Ticker(mapping['symbol'])
        price_data = futures_ticker.price.get(mapping['symbol'], {})
        futures_price = float(price_data.get('regularMarketPrice', 0))
        if futures_price <= 0:
            return None

        ratio = futures_price / etf_spot
        return {
            'symbol': mapping['symbol'],
            'name': mapping['name'],
            'full_name': mapping['full_name'],
            'futures_price': round(futures_price, 2),
            'ratio': round(ratio, 6),
        }
    except (AttributeError, KeyError, TypeError, ValueError) as exc:
        logger.warning("futures_translation_failed symbol=%s error=%s", mapping['symbol'], exc)
        return None
