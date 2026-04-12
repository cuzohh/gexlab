import numpy as np
import pandas as pd
from typing import Dict, Any, List

class LevelIntelligenceService:
    @staticmethod
    def calculate_gamma_flip(agg_strikes: List[Dict[str, Any]]) -> float:
        """
        Find the price where net GEX crosses zero using linear interpolation.
        """
        df = pd.DataFrame(agg_strikes).sort_values('strike')
        if df.empty:
            return 0.0

        # Find where gex changes sign
        df['sign'] = np.sign(df['gex'])
        df['sign_change'] = df['sign'].diff().fillna(0)
        
        # Zero cross is where sign_change is not 0
        crossings = df[df['sign_change'] != 0]
        
        if crossings.empty:
            # If no crossing, return the strike with min absolute GEX as fallback
            return float(df.iloc[df['gex'].abs().idxmin()]['strike'])

        # Take the first crossing (closest to current price usually)
        # For precision, we interpolate between the crossing strike and the one before it
        idx = crossings.index[0]
        if idx == 0:
            return float(df.iloc[0]['strike'])

        s1 = df.iloc[idx-1] # Point before cross
        s2 = df.iloc[idx]   # Point after cross

        # Linear Interpolation: x = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
        # We want x where y=0
        flip_price = s1['strike'] + (0 - s1['gex']) * (s2['strike'] - s1['strike']) / (s2['gex'] - s1['gex'])
        
        return float(flip_price)

    @staticmethod
    def identify_walls(agg_strikes: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Identify major GEX walls and secondary levels.
        """
        df = pd.DataFrame(agg_strikes)
        if df.empty:
            return {}

        # Call Wall = Absolute Max Positive GEX
        call_wall_row = df.iloc[df['gex'].idxmax()]
        
        # Put Wall = Absolute Max Negative GEX
        put_wall_row = df.iloc[df['gex'].idxmin()]

        # Filter for top 2
        top_calls = df.sort_values('gex', ascending=False).head(2)
        top_puts = df.sort_values('gex', ascending=True).head(2)

        return {
            "callWall": float(call_wall_row['strike']),
            "callWallMag": float(call_wall_row['gex']),
            "putWall": float(put_wall_row['strike']),
            "putWallMag": float(put_wall_row['gex']),
            "majorWalls": {
                "calls": top_calls[['strike', 'gex']].to_dict(orient="records"),
                "puts": top_puts[['strike', 'gex']].to_dict(orient="records")
            }
        }

    @staticmethod
    def calculate_max_pain(raw_data: List[Dict[str, Any]]) -> float:
        """
        Calculate Max Pain level (strike where total intrinsic value is minimized).
        """
        df = pd.DataFrame(raw_data)
        if df.empty:
            return 0.0

        strikes = df['strike'].unique()
        pain_values = []

        for s in strikes:
            # Intrinsic value for Calls: max(0, spot - strike) * OI
            # Intrinsic value for Puts: max(0, strike - spot) * OI
            calls = df[df['type'] == 'call']
            puts = df[df['type'] == 'put']
            
            call_pain = (np.maximum(0, s - calls['strike']) * calls['openInterest'].fillna(0)).sum()
            put_pain = (np.maximum(0, puts['strike'] - s) * puts['openInterest'].fillna(0)).sum()
            
            pain_values.append(call_pain + put_pain)

        max_pain_strike = strikes[np.argmin(pain_values)]
        return float(max_pain_strike)

    def get_market_levels(self, analytics_data: Dict[str, Any], raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Aggregate all institutional levels.
        """
        agg_strikes = analytics_data.get("strikes", [])
        raw_list = raw_data.get("data", [])
        
        flip = self.calculate_gamma_flip(agg_strikes)
        walls = self.identify_walls(agg_strikes)
        max_pain = self.calculate_max_pain(raw_list)
        
        # Vanna Magnet (Highest absolute Vanna)
        df_agg = pd.DataFrame(agg_strikes)
        if not df_agg.empty and 'vex' in df_agg.columns:
            vanna_magnet = float(df_agg.iloc[df_agg['vex'].abs().idxmax()]['strike'])
        else:
            vanna_magnet = 0.0

        return {
            "gammaFlip": round(flip, 2),
            "callWall": walls.get("callWall"),
            "putWall": walls.get("putWall"),
            "maxPain": max_pain,
            "vannaMagnet": vanna_magnet,
            "majorWalls": walls.get("majorWalls")
        }
