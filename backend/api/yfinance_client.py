from yahooquery import Ticker
import logging

logger = logging.getLogger(__name__)

class YFinanceClient:
    def __init__(self):
        self.default_ticker = "SPY"
    
    async def check_connection(self) -> bool:
        """
        Hit yahooquery for a simple quote to verify connection to Yahoo Finance servers.
        """
        try:
            ticker = Ticker(self.default_ticker)
            price_data = ticker.all_modules.get(self.default_ticker, {}).get('price', {})
            price = float(price_data.get('regularMarketPrice', 0))
            
            # If we get a valid close or last price, the connection is good.
            if price > 0:
                return True
            return False
        except Exception as e:
            logger.warning(f"Failed to connect to YahooQuery: {e}")
            return False
