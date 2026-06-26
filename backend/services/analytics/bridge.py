import json
from typing import Dict, Any

class BridgeService:
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
    def generate_tv_payload(analytics_data: Dict[str, Any]) -> str:
        """
        Generate a minimal, compressed JSON string for TradingView Pine Script.
        Only includes 0DTE and 1DTE Call Wall, Put Wall, and Volume Trigger.
        """
        levels = analytics_data.get("levels", {})

        payload = {}
        for dte in [0, 1]:
            payload.update(BridgeService._extract_dte_levels(levels, dte))

        return json.dumps(payload, separators=(',', ':'))
