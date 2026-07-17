import json
import math
from datetime import date, datetime
from typing import Dict, Any
from zoneinfo import ZoneInfo

_FUTURES_MULTIPLIERS = {
    "SPY": 10.0,
    "QQQ": 40.0,
}
_MARKET_TIMEZONE = ZoneInfo("America/New_York")

# Fixed column order for the Pine Script CSV format
# flip,cw,pw,vanna,mp,d0cw,d0pw,d1cw,d1pw,floor,ceil,oicw,oipw
_CSV_FIELDS = [
    "flip", "cw", "pw", "vanna", "mp",
    "d0cw", "d0pw", "d1cw", "d1pw",
    "floor", "ceil", "oicw", "oipw",
]

class BridgeService:
    @staticmethod
    def _round_tick(value: float, tick_size: float = 0.25) -> float:
        return round(round(value / tick_size) * tick_size, 2)

    @staticmethod
    def _convert_to_futures_price(
        value: Any,
        basis_data: Dict[str, Any] | None = None,
        ticker: str = "QQQ",
    ) -> float | None:
        if value is None:
            return None

        try:
            etf_price = float(value)
        except (TypeError, ValueError):
            return None

        if etf_price == 0:
            return None

        basis_data = basis_data or {}
        multiplier = _FUTURES_MULTIPLIERS.get(ticker.upper(), 40.0)

        try:
            basis = float(basis_data.get("basis") or 0.0)
        except (TypeError, ValueError):
            basis = 0.0

        try:
            future_price = float(basis_data.get("future_price") or 0.0)
            source_etf_price = float(basis_data.get("etf_price") or 0.0)
        except (TypeError, ValueError):
            future_price = 0.0
            source_etf_price = 0.0

        if future_price > 0 and source_etf_price > 0:
            return BridgeService._round_tick(etf_price * (future_price / source_etf_price))

        return BridgeService._round_tick((etf_price * multiplier) + basis)

    @staticmethod
    def _extract_dte_levels(levels: Dict[str, Any], dte: int) -> Dict[str, Any]:
        by_dte = levels.get("byDte", []) if isinstance(levels, dict) else []
        if not isinstance(by_dte, list):
            return {}

        entry = next(
            (
                row for row in by_dte
                if isinstance(row, dict) and row.get("dte") == dte
            ),
            None,
        )
        if not isinstance(entry, dict):
            return {}

        return {
            f"d{dte}cw": entry.get("callWall"),
            f"d{dte}pw": entry.get("putWall"),
            f"d{dte}vt": entry.get("gammaFlip"),
        }

    @staticmethod
    def _reference_date(analytics_data: Dict[str, Any]) -> date:
        timestamp = (analytics_data.get("summary", {}) or {}).get("timestamp")
        if isinstance(timestamp, str):
            try:
                parsed = datetime.fromisoformat(timestamp)
                if parsed.tzinfo is None:
                    # Treat tz-naive timestamps as ET (old snapshots saved before
                    # service.py was fixed to emit timezone-aware timestamps).
                    parsed = parsed.replace(tzinfo=_MARKET_TIMEZONE)
                return parsed.astimezone(_MARKET_TIMEZONE).date()
            except ValueError:
                pass
        return datetime.now(_MARKET_TIMEZONE).date()

    @staticmethod
    def _front_expiry_rows(analytics_data: Dict[str, Any]) -> list[Dict[str, Any]]:
        levels = analytics_data.get("levels", {}) or {}
        rows = [
            row for row in (levels.get("byDte", []) or [])
            if isinstance(row, dict)
        ]
        reference_date = BridgeService._reference_date(analytics_data)

        dated_rows = []
        for row in rows:
            expiry = row.get("expiry")
            if not isinstance(expiry, str):
                continue
            try:
                expiry_date = date.fromisoformat(expiry[:10])
            except ValueError:
                continue
            if expiry_date >= reference_date:
                dated_rows.append((expiry_date, row))

        if dated_rows:
            return [row for _, row in sorted(dated_rows, key=lambda item: item[0])[:2]]

        by_dte = {
            row.get("dte"): row
            for row in rows
            if isinstance(row.get("dte"), int)
        }
        return [by_dte.get(0, {}), by_dte.get(1, {})]

    @staticmethod
    def _derive_lambda_bands(
        analytics_data: Dict[str, Any],
        target_expiries: set[str] | None = None,
    ) -> Dict[str, float | None]:
        summary = analytics_data.get("summary", {}) or {}
        spot = summary.get("spotPrice") or 0.0
        try:
            spot = float(spot)
        except (TypeError, ValueError):
            spot = 0.0
        if spot <= 0:
            return {}

        reference_date = BridgeService._reference_date(analytics_data)
        weights: list[float] = []
        ivs: list[float] = []
        dtes: list[float] = []

        for row in analytics_data.get("raw", []) or []:
            if not isinstance(row, dict):
                continue
            try:
                oi = float(row.get("openInterest") or 0.0)
                delta = float(row.get("delta") or 0.0)
                bid = float(row.get("bid") or 0.0)
                ask = float(row.get("ask") or 0.0)
                last = float(row.get("lastPrice") or 0.0)
                iv = min(max(float(row.get("iv") or row.get("impliedVolatility") or 0.0), 0.01), 3.0)
                expiry_raw = str(row.get("expiry", ""))[:10]
                expiry = date.fromisoformat(expiry_raw)
            except (TypeError, ValueError):
                continue

            if target_expiries and expiry_raw not in target_expiries:
                continue

            mid = ((bid + ask) / 2.0) if bid > 0 and ask > 0 else last
            if mid < 0.05 or oi <= 0:
                continue

            option_lambda = max(min(delta * spot / max(mid, 0.05), 50.0), -50.0)
            weight = abs(oi * option_lambda * 100.0)
            dte = min(max((expiry - reference_date).days, 1), 30)
            if weight > 0:
                weights.append(weight)
                ivs.append(iv)
                dtes.append(float(dte))

        if not weights:
            return {}

        total_weight = sum(weights)
        weighted_iv = sum(iv * weight for iv, weight in zip(ivs, weights)) / total_weight
        weighted_dte = sum(dte * weight for dte, weight in zip(dtes, weights)) / total_weight
        sigma_move = spot * weighted_iv * math.sqrt(weighted_dte / 252.0)
        return {
            "up1": round(spot + sigma_move, 2),
            "down1": round(spot - sigma_move, 2),
            "up2": round(spot + (2.0 * sigma_move), 2),
            "down2": round(spot - (2.0 * sigma_move), 2),
        }

    @staticmethod
    def generate_tv_payload(
        analytics_data: Dict[str, Any],
        basis_data: Dict[str, Any] | None = None,
        ticker: str = "QQQ",
    ) -> str:
        """
        Compact JSON string for TradingView — 0DTE and 1DTE walls + flip.
        """
        front, next_expiry = (BridgeService._front_expiry_rows(analytics_data) + [{}, {}])[:2]
        payload = {
            "d0cw": front.get("callWall"),
            "d0pw": front.get("putWall"),
            "d0vt": front.get("gammaFlip"),
            "d1cw": next_expiry.get("callWall"),
            "d1pw": next_expiry.get("putWall"),
            "d1vt": next_expiry.get("gammaFlip"),
        }
        payload = {
            key: BridgeService._convert_to_futures_price(value, basis_data, ticker)
            for key, value in payload.items()
        }
        return json.dumps(payload, separators=(',', ':'))

    @staticmethod
    def generate_futures_levels_csv(
        analytics_data: Dict[str, Any],
        basis_data: Dict[str, Any] | None = None,
        ticker: str = "QQQ",
    ) -> str:
        """
        Futures-ready compact level pack:
        d0cw,d0pw,d0vt,d1cw,d1pw,d1vt,vf,vcw,vpw,cf,ccw,cpw,l1u,l1d,l2u,l2d,sf,scw,spw,zf,zcw,zpw
        """
        levels = analytics_data.get("levels", {}) or {}

        def fmt(value: Any) -> str:
            converted = BridgeService._convert_to_futures_price(value, basis_data, ticker)
            if converted is None:
                return "0"
            return f"{converted:.2f}".rstrip("0").rstrip(".")

        d0, d1 = (BridgeService._front_expiry_rows(analytics_data) + [{}, {}])[:2]
        vanna = levels.get("vanna", {}) or {}
        charm = levels.get("charm", {}) or {}
        speed = levels.get("speed", {}) or {}
        zomma = levels.get("zomma", {}) or {}
        target_expiries = {
            str(row.get("expiry"))[:10]
            for row in (d0, d1)
            if isinstance(row, dict) and row.get("expiry")
        }
        lambda_bands = ((levels.get("lambda") or {}).get("bands") or {})
        if not lambda_bands:
            # target_expiries empty (no front rows) → pass None to use full chain.
            lambda_bands = BridgeService._derive_lambda_bands(
                analytics_data, target_expiries if target_expiries else None
            ) or {}
        values = [
            fmt(d0.get("callWall")),
            fmt(d0.get("putWall")),
            fmt(d0.get("gammaFlip")),
            fmt(d1.get("callWall")),
            fmt(d1.get("putWall")),
            fmt(d1.get("gammaFlip")),
            fmt(vanna.get("flip")),
            fmt(vanna.get("callWall")),
            fmt(vanna.get("putWall")),
            fmt(charm.get("flip")),
            fmt(charm.get("callWall")),
            fmt(charm.get("putWall")),
            fmt(lambda_bands.get("up1")),
            fmt(lambda_bands.get("down1")),
            fmt(lambda_bands.get("up2")),
            fmt(lambda_bands.get("down2")),
            fmt(speed.get("flip")),
            fmt(speed.get("callWall")),
            fmt(speed.get("putWall")),
            fmt(zomma.get("flip")),
            fmt(zomma.get("callWall")),
            fmt(zomma.get("putWall")),
        ]
        return ",".join(values)

    @staticmethod
    def generate_pine_csv(analytics_data: Dict[str, Any]) -> str:
        """
        13 key levels in ETF price space (main section).
        Column order: flip,cw,pw,vanna,mp,d0cw,d0pw,d1cw,d1pw,floor,ceil,oicw,oipw
        """
        levels  = analytics_data.get("levels", {}) or {}
        derived = levels.get("derived", {}) or {}

        d0, d1 = (BridgeService._front_expiry_rows(analytics_data) + [{}, {}])[:2]

        def fmt(v) -> str:
            return "0" if v is None else str(round(float(v), 2))

        values = [
            fmt(levels.get("gammaFlip")),
            fmt(levels.get("callWall")),
            fmt(levels.get("putWall")),
            fmt(levels.get("vannaMagnet")),
            fmt(levels.get("maxPain")),
            fmt(d0.get("callWall")),
            fmt(d0.get("putWall")),
            fmt(d1.get("callWall")),
            fmt(d1.get("putWall")),
            fmt(derived.get("sessionFloor")),
            fmt(levels.get("sessionCeiling")),
            fmt(derived.get("oiCallWall")),
            fmt(derived.get("oiPutWall")),
        ]

        return ",".join(values)

    @staticmethod
    def generate_greek_levels_csv(analytics_data: Dict[str, Any]) -> str:
        """
        12 Greek flip/wall levels in ETF price space (Greek section).
        Column order:
        vanna_flip, vanna_cw, vanna_pw,
        charm_flip, charm_cw, charm_pw,
        speed_flip, speed_cw, speed_pw,
        zomma_flip, zomma_cw, zomma_pw
        """
        levels = analytics_data.get("levels", {}) or {}

        def fmt(v) -> str:
            return "0" if v is None else str(round(float(v), 2))

        def greek(key: str) -> Dict[str, Any]:
            return levels.get(key, {}) or {}

        vanna = greek("vanna")
        charm = greek("charm")
        speed = greek("speed")
        zomma = greek("zomma")

        values = [
            fmt(vanna.get("flip")),
            fmt(vanna.get("callWall")),
            fmt(vanna.get("putWall")),
            fmt(charm.get("flip")),
            fmt(charm.get("callWall")),
            fmt(charm.get("putWall")),
            fmt(speed.get("flip")),
            fmt(speed.get("callWall")),
            fmt(speed.get("putWall")),
            fmt(zomma.get("flip")),
            fmt(zomma.get("callWall")),
            fmt(zomma.get("putWall")),
        ]

        return ",".join(values)
