import logging

from yahooquery import Ticker

logger = logging.getLogger(__name__)


class YFinanceClient:
    def __init__(self):
        self.default_ticker = 'SPY'

    async def check_connection(self) -> bool:
        try:
            ticker = Ticker(self.default_ticker)
            price_data = ticker.all_modules.get(self.default_ticker, {}).get('price', {})
            price = float(price_data.get('regularMarketPrice', 0))
            return price > 0
        except (AttributeError, KeyError, TypeError, ValueError) as exc:
            logger.warning('yahoo_connection_check_failed error=%s', exc)
            return False
