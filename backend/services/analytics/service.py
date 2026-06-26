import numpy as np
import pandas as pd
import yfinance as yf
import logging
from datetime import datetime
from typing import Dict, Any
from services.analytics.engine import GreeksEngine

logger = logging.getLogger("analytics_service")

class GexAnalyticsService:
    def __init__(self):
        self.engine = GreeksEngine()

    def get_risk_free_rate(self) -> float:
        """Fetch current 13-week Treasury Bill yield (^IRX)."""
        try:
            irx = yf.Ticker("^IRX")
            rate = irx.fast_info['lastPrice'] / 100.0 # Convert 4.5 to 0.045
            return rate if rate > 0 else 0.045
        except Exception:
            return 0.045 # Default to 4.5% if fetch fails

    def process_chain(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process raw options chain data into exposure metrics.
        """
        df_raw = pd.DataFrame(raw_data.get("data", []))
        if df_raw.empty:
            return None

        spot = raw_data.get("spotPrice", 0.0)
        r = self.get_risk_free_rate()
        q = 0.015 # Default dividend yield for SPY
        
        # Prepare inputs for engine
        S = np.full(len(df_raw), spot)
        K = df_raw['strike'].values
        
        # Calculate Time to Expiration (T) in years
        now = datetime.now()
        df_raw['expiry_dt'] = pd.to_datetime(df_raw['expiry'])
        T = (df_raw['expiry_dt'] - now).dt.total_seconds() / (365 * 24 * 3600)
        T = np.maximum(T, 1e-5) # Prevent division by zero for expired contracts
        
        # Implied Volatility (use provided IV or interpolate)
        sigma = df_raw['impliedVolatility'].values
        sigma = np.maximum(sigma, 0.01) # Floor IV at 1%
        
        flags = df_raw['type'].map({'call': 'c', 'put': 'p'}).values

        # 1. Calculate Standard Greeks
        greeks = self.engine.calculate_basic_greeks(S, K, T, r, sigma, flags)
        
        delta = greeks['delta']
        gamma = greeks['gamma']
        vega = greeks['vega']
        theta = greeks['theta']

        # Attribution mask for dealer positioning
        is_call = (flags == 'c')
        
        # 2. Calculate Higher Order Greeks
        higher = self.engine.calculate_higher_order_greeks(S, K, T, r, q, sigma)
        
        # 3. Calculate Dealer Exposures (EX)
        # Exposure = Greek * OpenInterest * Multiplier * SpotPrice (for GEX)
        # Attribution: Dealers short Calls (Positive Gamma) / short Puts (Negative Gamma)
        # Note: In standard GEX models, Gamma(total) = (Call Gamma - Put Gamma) * OI * 100 * S^2 * 0.01
        
        oi = df_raw['openInterest'].fillna(0).values
        
        # GEX (Dollar Gamma per 1% move)
        # Formula: OI * Gamma * 100 * Spot * Spot * 0.01
        gex_all = oi * gamma * 100 * spot * spot * 0.01
        df_raw['gex'] = np.where(is_call, gex_all, -gex_all)
        
        # DEX (Dollar Delta)
        dex_all = oi * delta * 100 * spot
        df_raw['dex'] = np.where(is_call, dex_all, -dex_all)
        
        # Vanna Exposure (VEX)
        vex_all = oi * higher['vanna'] * 100 * spot
        df_raw['vex'] = np.where(is_call, vex_all, -vex_all)
        
        # Charm Exposure (CHEX)
        chex_all = oi * higher['charm'] * 100 * spot
        df_raw['chex'] = np.where(is_call, chex_all, -chex_all)

        df_raw['delta'] = delta
        df_raw['gamma'] = gamma
        df_raw['vega'] = vega
        df_raw['theta'] = theta
        df_raw['vanna'] = higher['vanna']
        df_raw['charm'] = higher['charm']
        df_raw['iv'] = sigma
        
        # Aggregation by Strike
        agg = df_raw.groupby('strike').agg({
            'gex': 'sum',
            'dex': 'sum',
            'vex': 'sum',
            'chex': 'sum',
            'openInterest': 'sum',
            'volume': 'sum',
            'iv': 'mean' # Skew visualization
        }).reset_index()
        
        # Metrics summary
        total_gex = df_raw['gex'].sum()
        total_dex = df_raw['dex'].sum()
        
        # Metadata for Surface
        # Group by Expiry then Strike to build matrix
        pivoted = df_raw.pivot_table(index='expiry', columns='strike', values='iv', aggfunc='mean').fillna(0)
        
        surface = {
            "expiries": pivoted.index.tolist(),
            "strikes": pivoted.columns.tolist(),
            "matrix": pivoted.values.tolist()
        }

        return {
            "summary": {
                "totalNetGex": total_gex,
                "totalNetDex": total_dex,
                "spotPrice": spot,
                "riskFreeRate": r,
                "timestamp": datetime.now().isoformat()
            },
            "strikes": agg.to_dict(orient="records"),
            "surface": surface,
            "raw": df_raw.to_dict(orient="records")
        }
