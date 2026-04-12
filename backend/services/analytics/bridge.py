import json
from typing import Dict, Any

class BridgeService:
    @staticmethod
    def generate_tv_payload(analytics_data: Dict[str, Any]) -> str:
        """
        Generate a minimal, compressed JSON string for TradingView Pine Script.
        Reduces character count for copy-paste efficiency.
        """
        levels = analytics_data.get("levels", {})
        
        # Compressed Keys
        # f = flip, cw = call wall, pw = put wall, mp = max pain, v = vanna
        payload = {
            "f": levels.get("gammaFlip"),
            "cw": levels.get("callWall"),
            "pw": levels.get("putWall"),
            "mp": levels.get("maxPain"),
            "v": levels.get("vannaMagnet")
        }
        
        # Return as compact JSON string (no spaces)
        return json.dumps(payload, separators=(',', ':'))
