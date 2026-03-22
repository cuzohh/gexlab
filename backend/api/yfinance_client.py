import yfinance as yf
import logging

logger = logging.getLogger(__name__)

class YFinanceClient:
    def __init__(self):
        self.default_ticker = "SPY"
    
    async def check_connection(self) -> bool:
        """
        Hit yfinance for a simple quote to verify connection to Yahoo Finance servers.
        """
        try:
            ticker = yf.Ticker(self.default_ticker)
            info = ticker.fast_info
            
            # If we get a valid close or last price, the connection is good.
            if hasattr(info, "last_price") and info.last_price > 0:
                return True
            return False
        except Exception as e:
            logger.warning(f"Failed to connect to YFinance: {e}")
            return False
