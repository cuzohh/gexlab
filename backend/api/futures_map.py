"""
Futures translation service — maps ETF tickers to their futures equivalents
and provides live ratio-based price conversion.

For futures traders, ETF-based GEX levels need to be translated to /ES, /NQ, etc.
We fetch both the ETF and futures prices from yfinance, compute the ratio,
and apply it to every key level.
"""

import yfinance as yf
import logging

logger = logging.getLogger(__name__)

# ETF → Futures symbol mapping
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


def get_futures_translation(ticker: str, etf_spot: float) -> dict | None:
    """
    Fetch the live futures price and compute the ETF→Futures conversion ratio.
    
    Returns dict with:
      - symbol: futures ticker (e.g., 'ES=F')
      - name: short name (e.g., '/ES')
      - full_name: full description
      - futures_price: current futures price
      - ratio: futures_price / etf_price (multiply any ETF level by this)
    """
    mapping = FUTURES_MAP.get(ticker.upper())
    if not mapping:
        return None
    
    try:
        futures_ticker = yf.Ticker(mapping['symbol'])
        futures_price = float(futures_ticker.fast_info.last_price)
        
        if etf_spot <= 0:
            return None
            
        ratio = futures_price / etf_spot
        
        return {
            'symbol': mapping['symbol'],
            'name': mapping['name'],
            'full_name': mapping['full_name'],
            'futures_price': round(futures_price, 2),
            'ratio': round(ratio, 6),
        }
    except Exception as e:
        logger.warning(f"Failed to fetch futures price for {mapping['symbol']}: {e}")
        return None
