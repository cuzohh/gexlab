import numpy as np
import pandas as pd
import yfinance as yf
import logging
from datetime import datetime, timedelta
from typing import Dict, Any
from services.analytics.engine import GreeksEngine

logger = logging.getLogger("analytics_service")

_RFR_CACHE_TTL = timedelta(hours=1)

class GexAnalyticsService:
    def __init__(self):
        self.engine = GreeksEngine()
        self._rfr_cache: float | None = None
        self._rfr_fetched_at: datetime | None = None

    def get_risk_free_rate(self) -> float:
        """Fetch 13-week T-bill yield (^IRX), cached for 1 hour."""
        now = datetime.now()
        if (
            self._rfr_cache is not None
            and self._rfr_fetched_at is not None
            and now - self._rfr_fetched_at < _RFR_CACHE_TTL
        ):
            return self._rfr_cache
        try:
            irx = yf.Ticker("^IRX")
            rate = irx.fast_info['lastPrice'] / 100.0
            if rate > 0:
                self._rfr_cache = rate
                self._rfr_fetched_at = now
                return rate
        except Exception:
            pass
        return self._rfr_cache if self._rfr_cache is not None else 0.045

    def process_chain(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process raw options chain data into exposure metrics.
        """
        df_raw = pd.DataFrame(raw_data.get("data", []))
        if df_raw.empty:
            return None

        spot = raw_data.get("spotPrice", 0.0)
        r = self.get_risk_free_rate()
        # Approximate dividend yields: SPY ~1.5%, QQQ ~0.6%
        ticker = raw_data.get("symbol", "SPY").upper()
        q = 0.006 if ticker == "QQQ" else 0.015
        
        # Prepare inputs for engine
        S = np.full(len(df_raw), spot)
        K = df_raw['strike'].values
        
        # Calculate Time to Expiration (T) in years
        now = datetime.now()
        df_raw['expiry_dt'] = pd.to_datetime(df_raw['expiry'])
        T = (df_raw['expiry_dt'] - now).dt.total_seconds() / (365 * 24 * 3600)
        T = np.maximum(T, 1e-5) # Prevent division by zero for expired contracts
        
        # Implied Volatility — fill NaN with a neutral 20% default before flooring
        # so a single missing IV doesn't propagate NaN through all Greeks.
        sigma = df_raw['impliedVolatility'].fillna(0.2).values
        sigma = np.maximum(sigma, 0.01)
        
        flags = df_raw['type'].map({'call': 'c', 'put': 'p'}).values

        # 1. Calculate Standard Greeks
        greeks = self.engine.calculate_basic_greeks(S, K, T, r, sigma, flags, q=q)

        delta = greeks['delta']
        gamma = greeks['gamma']
        vega = greeks['vega']
        theta = greeks['theta']

        # Attribution mask for dealer positioning
        is_call = (flags == 'c')

        # 2. Calculate Higher Order Greeks — reuse d1/d2/sqrt_t already in greeks
        higher = self.engine.calculate_higher_order_greeks(S, K, T, r, q, sigma, flags, _precomputed=greeks)
        
        # 3. Calculate Dealer Exposures (EX)
        # Exposure = Greek * OpenInterest * Multiplier * SpotPrice (for GEX)
        # Attribution: Dealers short Calls (Positive Gamma) / short Puts (Negative Gamma)
        # Note: In standard GEX models, Gamma(total) = (Call Gamma - Put Gamma) * OI * 100 * S^2 * 0.01
        
        oi = df_raw['openInterest'].fillna(0).values

        def numeric_column(name: str) -> np.ndarray:
            if name not in df_raw.columns:
                return np.zeros(len(df_raw))
            return pd.to_numeric(df_raw[name], errors='coerce').fillna(0).values

        bid = numeric_column('bid')
        ask = numeric_column('ask')
        last = numeric_column('lastPrice')
        mid = np.where((bid > 0) & (ask > 0), (bid + ask) / 2.0, last)
        valid_lambda_premium = mid >= 0.05
        raw_lambda = np.where(valid_lambda_premium, delta * spot / np.maximum(mid, 0.05), 0.0)
        option_lambda = np.clip(raw_lambda, -50.0, 50.0)
        
        # GEX (Dollar Gamma per 1% move)
        # Formula: OI * Gamma * 100 * Spot * Spot * 0.01
        gex_all = oi * gamma * 100 * spot * spot * 0.01
        df_raw['gex'] = np.where(is_call, gex_all, -gex_all)
        
        # DEX (Dollar Delta)
        dex_all = oi * delta * 100 * spot
        df_raw['dex'] = np.where(is_call, dex_all, -dex_all)

        # Lambda Exposure (LEX) — guarded option elasticity exposure.
        # Capped and premium-filtered so tiny stale OTM quotes do not dominate.
        lex_all = oi * option_lambda * 100
        df_raw['lex'] = np.where(is_call, lex_all, -lex_all)
        
        # Vanna Exposure (VEX) — delta sensitivity to vol; dealer rehedge pressure on IV moves
        vex_all = oi * higher['vanna'] * 100 * spot
        df_raw['vex'] = np.where(is_call, vex_all, -vex_all)

        # Charm Exposure (CHEX) — delta decay over time; dealer unwind pressure approaching expiry
        chex_all = oi * higher['charm'] * 100 * spot
        df_raw['chex'] = np.where(is_call, chex_all, -chex_all)

        # Speed Exposure (SPEX) — rate of gamma change per $1 spot move; gamma instability zones
        spex_all = oi * higher['speed'] * 100 * spot * spot
        df_raw['spex'] = np.where(is_call, spex_all, -spex_all)

        # Zomma Exposure (ZOMEX) — gamma sensitivity to vol; activates on vol spikes
        zomex_all = oi * higher['zomma'] * 100 * spot * spot * 0.01
        df_raw['zomex'] = np.where(is_call, zomex_all, -zomex_all)

        # Vomma Exposure (VOMEX) — vega convexity; where rising vol creates exponential vega growth
        vomex_all = oi * higher['vomma'] * 100
        df_raw['vomex'] = np.where(is_call, vomex_all, -vomex_all)

        df_raw['delta'] = delta
        df_raw['gamma'] = gamma
        df_raw['vega'] = vega
        df_raw['theta'] = theta
        df_raw['lambda'] = option_lambda
        df_raw['optionMid'] = mid
        df_raw['vanna'] = higher['vanna']
        df_raw['charm'] = higher['charm']
        df_raw['speed'] = higher['speed']
        df_raw['zomma'] = higher['zomma']
        df_raw['vomma'] = higher['vomma']
        df_raw['iv'] = sigma

        # Aggregation by Strike
        agg = df_raw.groupby('strike').agg({
            'gex': 'sum',
            'dex': 'sum',
            'lex': 'sum',
            'vex': 'sum',
            'chex': 'sum',
            'spex': 'sum',
            'zomex': 'sum',
            'vomex': 'sum',
            'openInterest': 'sum',
            'volume': 'sum',
            'iv': 'mean',
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
