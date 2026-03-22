"""
GEX Engine — Core Math for Gamma Exposure Calculations.

Implements Black-Scholes Greeks (Delta, Gamma) and the industry-standard
GEX formula used by SpotGamma / GEXRADAR:

    GEX = Gamma × Open_Interest × 100 × Spot² × 0.01 / 1,000,000,000

Result is in billions of dollars of hedging flow per 1% move.
"""

import numpy as np
from scipy.stats import norm
from typing import Optional


def black_scholes_delta(
    S: float,         # Spot price
    K: float,         # Strike price
    T: float,         # Time to expiration in years
    r: float,         # Risk-free rate
    sigma: float,     # Implied volatility (annualised)
    option_type: str  # 'call' or 'put'
) -> float:
    """Calculate Black-Scholes Delta."""
    if T <= 0 or sigma <= 0:
        # At or past expiration: intrinsic delta
        if option_type == 'call':
            return 1.0 if S > K else 0.0
        else:
            return -1.0 if S < K else 0.0

    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))

    if option_type == 'call':
        return float(norm.cdf(d1))
    else:
        return float(norm.cdf(d1) - 1.0)


def black_scholes_gamma(
    S: float,         # Spot price
    K: float,         # Strike price
    T: float,         # Time to expiration in years
    r: float,         # Risk-free rate
    sigma: float      # Implied volatility (annualised)
) -> float:
    """
    Calculate Black-Scholes Gamma.
    Gamma is the same for calls and puts.
    """
    if T <= 0 or sigma <= 0:
        return 0.0

    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    gamma = float(norm.pdf(d1) / (S * sigma * np.sqrt(T)))
    return gamma


def calculate_gex(
    gamma: float,
    open_interest: int,
    spot: float
) -> float:
    """
    GEX = Gamma × OI × 100 × Spot² × 0.01 / 1,000,000,000

    Returns GEX in BILLIONS of dollars per 1% move.
    """
    return (gamma * open_interest * 100 * (spot ** 2) * 0.01) / 1_000_000_000


def calculate_gex_vectorized(
    gammas: np.ndarray,
    open_interests: np.ndarray,
    spot: float
) -> np.ndarray:
    """
    Vectorised GEX calculation across an entire options chain.
    Much faster than looping strike-by-strike.
    """
    return (gammas * open_interests * 100 * (spot ** 2) * 0.01) / 1_000_000_000


def find_zero_gamma(strikes: np.ndarray, cumulative_gex: np.ndarray) -> Optional[float]:
    """
    Find the strike price where cumulative GEX crosses zero (sign change).
    This is the 'Gamma Flip' level — the most important level on the chart.
    
    Uses linear interpolation between the last positive and first negative
    cumulative GEX values (or vice versa).
    """
    sign_changes = np.where(np.diff(np.sign(cumulative_gex)))[0]
    
    if len(sign_changes) == 0:
        return None
    
    # Take the sign change closest to the middle of the chain (nearest ATM)
    mid_idx = len(strikes) // 2
    closest_idx = sign_changes[np.argmin(np.abs(sign_changes - mid_idx))]
    
    # Linear interpolation
    x0, x1 = strikes[closest_idx], strikes[closest_idx + 1]
    y0, y1 = cumulative_gex[closest_idx], cumulative_gex[closest_idx + 1]
    
    if y1 == y0:
        return float(x0)
    
    zero_strike = x0 + (0 - y0) * (x1 - x0) / (y1 - y0)
    return float(zero_strike)


def compute_max_pain(
    strikes: np.ndarray,
    call_oi: np.ndarray,
    put_oi: np.ndarray
) -> float:
    """
    Max Pain is the strike where total option holder losses are maximised
    (equivalently, the strike where total option dollar value is minimised).
    
    For each candidate expiry price P:
      total_pain = sum(call_intrinsic(K, P) * call_OI(K)) + sum(put_intrinsic(K, P) * put_OI(K))
    
    We find the P that minimises total_pain.
    """
    total_pain = np.zeros(len(strikes))
    
    for i, test_price in enumerate(strikes):
        call_pain = np.maximum(test_price - strikes, 0) * call_oi * 100
        put_pain = np.maximum(strikes - test_price, 0) * put_oi * 100
        total_pain[i] = np.sum(call_pain) + np.sum(put_pain)
    
    min_idx = np.argmin(total_pain)
    return float(strikes[min_idx])
