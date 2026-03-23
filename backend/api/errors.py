class MarketDataError(Exception):
    """Base class for market data fetch and transform failures."""


class RateLimitError(MarketDataError):
    """Raised when the upstream market data provider rate limits requests."""


class InvalidTickerError(MarketDataError):
    """Raised when a ticker is invalid or does not resolve to price data."""


class NoOptionsDataError(MarketDataError):
    """Raised when a ticker has no options chain data available."""


class UpstreamAPIError(MarketDataError):
    """Raised when the upstream provider returns an unexpected response."""
