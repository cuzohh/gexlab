import json
import logging
import re
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger("cboe_ingestion")

_CBOE_CHAIN_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/{ticker}.json"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://www.cboe.com/",
}


def _parse_osi_symbol(symbol: str) -> Optional[tuple]:
    """Parse OSI option symbol TICKER+YYMMDD+C/P+8-digit-strike."""
    cleaned = symbol.replace(" ", "")
    m = re.match(r"^([A-Z]+)(\d{6})([CP])(\d{8})$", cleaned)
    if not m:
        return None
    _, date_str, cp, strike_str = m.groups()
    try:
        expiry = datetime.strptime(date_str, "%y%m%d").date().isoformat()
        strike = int(strike_str) / 1000.0
        opt_type = "call" if cp == "C" else "put"
        return expiry, strike, opt_type
    except ValueError:
        return None


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        return int(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _parse_chain(raw: Dict[str, Any], ticker: str) -> Dict[str, Any]:
    data = raw.get("data", raw)
    spot = _safe_float(data.get("current_price") or data.get("close") or data.get("last"))
    timestamp = raw.get("timestamp") or raw.get("updated") or datetime.now().isoformat()

    option_list: List[Dict[str, Any]] = data.get("options", [])
    if not option_list and isinstance(data, list):
        option_list = data

    contracts = []
    for opt in option_list:
        if not isinstance(opt, dict):
            continue
        symbol = str(opt.get("option") or opt.get("symbol") or "")
        parsed = _parse_osi_symbol(symbol)
        if not parsed:
            continue
        expiry, strike, opt_type = parsed

        oi = _safe_int(opt.get("open_interest") or opt.get("openInterest"))
        bid = _safe_float(opt.get("bid"))
        ask = _safe_float(opt.get("ask"))
        iv = _safe_float(opt.get("iv") or opt.get("impliedVolatility"))
        last = _safe_float(opt.get("last_trade_price") or opt.get("last_price") or opt.get("lastPrice") or opt.get("last"))
        volume = _safe_int(opt.get("volume"))

        contracts.append({
            "contractSymbol": symbol,
            "lastTradeDate": timestamp,
            "strike": strike,
            "lastPrice": last,
            "bid": bid,
            "ask": ask,
            "change": 0.0,
            "percentChange": 0.0,
            "volume": volume,
            "openInterest": oi,
            "impliedVolatility": iv,
            "inTheMoney": (
                (opt_type == "call" and strike < spot) or
                (opt_type == "put" and strike > spot)
            ) if spot > 0 else False,
            "contractSize": "REGULAR",
            "currency": "USD",
            "type": opt_type,
            "expiry": expiry,
        })

    return {
        "symbol": ticker.upper(),
        "spotPrice": spot,
        "timestamp": timestamp,
        "data": contracts,
    }


class CboeIngestionService:
    def __init__(self, ticker: str):
        self.ticker = ticker.upper()
        self._url = _CBOE_CHAIN_URL.format(ticker=self.ticker)

    def fetch_chain(self) -> Dict[str, Any]:
        logger.info(f"Fetching CBOE chain for {self.ticker}...")
        try:
            req = urllib.request.Request(self._url, headers=_HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            logger.error(f"CBOE fetch failed for {self.ticker}: {exc}")
            return {}

        result = _parse_chain(raw, self.ticker)
        n = len(result.get("data", []))
        oi_count = sum(1 for c in result["data"] if c["openInterest"] > 0)
        logger.info(
            f"CBOE {self.ticker}: {n} contracts, {oi_count} with OI, "
            f"spot={result['spotPrice']}"
        )
        return result

