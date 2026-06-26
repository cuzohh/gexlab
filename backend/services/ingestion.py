import yfinance as yf
import pandas as pd
import time
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ingestion")

class GexIngestionService:
    def __init__(self, ticker_symbol: str = "SPY"):
        self.ticker_symbol = ticker_symbol
        self.ticker = yf.Ticker(ticker_symbol)
        self.cache: Dict[str, Any] = {}
        self.last_fetch_time: Optional[datetime] = None
        self.cache_expiry_seconds = 60

    def get_expirations(self) -> List[str]:
        """Fetch available expiration dates from yfinance."""
        try:
            return list(self.ticker.options)
        except Exception as e:
            logger.error(f"Error fetching expiries for {self.ticker_symbol}: {e}")
            return []

    def fetch_full_chain(self, expiries_to_fetch: int = 5) -> Dict[str, Any]:
        """
        Fetch options chains for the next N expiries.
        Implements basic rate limiting and caching.
        """
        now = datetime.now()
        
        # Check cache
        if self.last_fetch_time and (now - self.last_fetch_time).total_seconds() < self.cache_expiry_seconds:
            logger.info("Returning cached options chain data")
            return self.cache

        expirations = self.get_expirations()
        if not expirations:
            return {}

        selected_expiries = expirations[:expiries_to_fetch]
        logger.info(f"Fetching chains for {self.ticker_symbol}: {selected_expiries}")

        full_data = []
        spot_price = self.get_spot_price()

        for expiry in selected_expiries:
            try:
                chain = self.ticker.option_chain(expiry)
                
                # Combine calls and puts
                calls = chain.calls.copy()
                puts = chain.puts.copy()
                
                calls['type'] = 'call'
                puts['type'] = 'put'
                calls['expiry'] = expiry
                puts['expiry'] = expiry
                
                full_data.append(pd.concat([calls, puts]))
                
                # Rate limiting to avoid Yahoo IP block
                time.sleep(0.5) 
            except Exception as e:
                logger.error(f"Failed to fetch chain for {expiry}: {e}")

        if not full_data:
            return {}

        df = pd.concat(full_data, ignore_index=True)
        
        result = {
            "symbol": self.ticker_symbol,
            "spotPrice": spot_price,
            "timestamp": now.isoformat(),
            "data": df.to_dict(orient="records")
        }

        # Update cache
        self.cache = result
        self.last_fetch_time = now
        logger.info(f"Ingestion complete for {self.ticker_symbol}. Total rows: {len(df)}")
        
        return result

    def get_spot_price(self) -> float:
        """Fetch the current spot price with multiple fallbacks for weekends."""
        try:
            # Method 1: Fast Info (Best for live)
            price = self.ticker.fast_info.get('lastPrice')
            if price and price > 0:
                return price
            
            # Method 2: History (Best for weekends)
            hist = self.ticker.history(period="1d")
            if not hist.empty:
                return hist['Close'].iloc[-1]
            
            # Method 3: Standard Info (Slow fallback)
            return self.ticker.info.get('regularMarketPrice') or self.ticker.info.get('previousClose') or 0.0
        except Exception as e:
            logger.error(f"Error fetching price for {self.ticker_symbol}: {e}")
            return 0.0

if __name__ == "__main__":
    service = GexIngestionService("SPY")
    data = service.fetch_full_chain(expiries_to_fetch=2)
    print(f"Fetched {len(data.get('data', []))} contracts for {data.get('symbol')}")
    print(f"Current Spot: {data.get('spotPrice')}")
