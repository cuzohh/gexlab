"""
Options Chain Service — fetches data from Yahoo Finance and runs GEX calculations.

Orchestrates:
  1. Fetch the full options chain for a ticker via yfinance.
  2. Calculate Black-Scholes Gamma for every strike using IV from Yahoo.
  3. Apply the GEX formula to produce per-strike GEX values.
  4. Derive key levels: Call Wall, Put Wall, Zero Gamma, Max Pain, Vol Trigger.
"""

import yfinance as yf
import numpy as np
import pandas as pd
from datetime import datetime, date
from typing import Optional
import logging

from engine.gex_calculator import (
    black_scholes_gamma,
    black_scholes_delta,
    black_scholes_vanna,
    calculate_gex_vectorized,
    find_zero_gamma,
    compute_max_pain,
)

logger = logging.getLogger(__name__)

# Risk-free rate (approx 10-year Treasury yield as of 2024-2025)
RISK_FREE_RATE = 0.043


def _safe_int(val) -> int:
    """Safely convert a value to int, treating NaN/None as 0."""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return 0
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


def _safe_float(val) -> float:
    """Safely convert a value to float, treating NaN/None as 0.0."""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def _years_to_expiry(expiry_str: str) -> float:
    """Convert an expiration date string to fractional years from now."""
    exp_date = datetime.strptime(expiry_str, "%Y-%m-%d").date()
    today = date.today()
    days = (exp_date - today).days
    return max(days / 365.0, 1 / 365.0)  # Floor at 1 day to avoid div/0


def fetch_options_chain(ticker_symbol: str, max_expirations: int = 6):
    """
    Fetch the full options chain for a ticker and compute GEX data.
    
    Returns a dict with:
      - spot: current underlying price
      - gex_by_strike: list of per-strike GEX data
      - key_levels: dict with call_wall, put_wall, zero_gamma, max_pain, vol_trigger
      - expirations: list of expiration dates used
      - net_gex: total net GEX across all strikes (billions)
      - regime: 'LONG_GAMMA' or 'SHORT_GAMMA' 
      - heatmap_data: per-expiry GEX for heatmap rendering
    """
    ticker = yf.Ticker(ticker_symbol)
    
    # Get current spot price
    fast_info = ticker.fast_info
    spot = float(fast_info.last_price)
    
    # Get available expirations, limit to nearest N
    all_expirations = ticker.options
    expirations = list(all_expirations[:max_expirations])
    
    # Aggregate across all expirations
    all_strikes_data = []
    heatmap_data = []

    for exp_date in expirations:
        try:
            chain = ticker.option_chain(exp_date)
        except Exception as e:
            logger.warning(f"Failed to fetch chain for {exp_date}: {e}")
            continue
        
        calls_df = chain.calls
        puts_df = chain.puts
        
        T = _years_to_expiry(exp_date)
        
        # ─── Process CALLS ────────────────────────────────────────────
        for _, row in calls_df.iterrows():
            strike = _safe_float(row['strike'])
            oi = _safe_int(row.get('openInterest', 0))
            volume = _safe_int(row.get('volume', 0))
            iv = _safe_float(row.get('impliedVolatility', 0))
            last_price = _safe_float(row.get('lastPrice', 0))
            
            if iv <= 0 or oi <= 0:
                continue
            
            gamma = black_scholes_gamma(spot, strike, T, RISK_FREE_RATE, iv)
            delta = black_scholes_delta(spot, strike, T, RISK_FREE_RATE, iv, 'call')
            vanna = black_scholes_vanna(spot, strike, T, RISK_FREE_RATE, iv)
            
            all_strikes_data.append({
                'strike': strike,
                'expiration': exp_date,
                'type': 'call',
                'oi': oi,
                'volume': volume,
                'iv': iv,
                'gamma': gamma,
                'delta': delta,
                'vanna': vanna,
                'last_price': last_price,
                'T': T,
            })
        
        # ─── Process PUTS ─────────────────────────────────────────────
        for _, row in puts_df.iterrows():
            strike = _safe_float(row['strike'])
            oi = _safe_int(row.get('openInterest', 0))
            volume = _safe_int(row.get('volume', 0))
            iv = _safe_float(row.get('impliedVolatility', 0))
            last_price = _safe_float(row.get('lastPrice', 0))
            
            if iv <= 0 or oi <= 0:
                continue
            
            gamma = black_scholes_gamma(spot, strike, T, RISK_FREE_RATE, iv)
            delta = black_scholes_delta(spot, strike, T, RISK_FREE_RATE, iv, 'put')
            vanna = black_scholes_vanna(spot, strike, T, RISK_FREE_RATE, iv)
            
            all_strikes_data.append({
                'strike': strike,
                'expiration': exp_date,
                'type': 'put',
                'oi': oi,
                'volume': volume,
                'iv': iv,
                'gamma': gamma,
                'delta': delta,
                'vanna': vanna,
                'last_price': last_price,
                'T': T,
            })
    
    if not all_strikes_data:
        return {
            'spot': spot,
            'gex_by_strike': [],
            'key_levels': {},
            'expirations': expirations,
            'net_gex': 0,
            'regime': 'UNKNOWN',
            'heatmap_data': [],
        }
    
    df = pd.DataFrame(all_strikes_data)
    
    # ─── Calculate GEX per row ────────────────────────────────────────
    gammas = df['gamma'].values
    ois = df['oi'].values
    
    gex_raw = calculate_gex_vectorized(gammas, ois, spot)
    
    # Convention: Calls are positive GEX, Puts are negative GEX
    signs = np.where(df['type'] == 'call', 1.0, -1.0)
    df['gex'] = gex_raw * signs
    
    # ─── Aggregate by strike (sum across expirations) ─────────────────
    strike_agg = df.groupby('strike').agg(
        call_gex=('gex', lambda x: x[df.loc[x.index, 'type'] == 'call'].sum()),
        put_gex=('gex', lambda x: x[df.loc[x.index, 'type'] == 'put'].sum()),
        total_oi=('oi', 'sum'),
        total_volume=('volume', 'sum'),
        avg_iv=('iv', 'mean'),
    ).reset_index()
    
    strike_agg['net_gex'] = strike_agg['call_gex'] + strike_agg['put_gex']
    
    # Sort by strike
    strike_agg = strike_agg.sort_values('strike').reset_index(drop=True)
    
    strikes = strike_agg['strike'].values
    net_gex = strike_agg['net_gex'].values
    
    # ─── Cumulative GEX for Zero Gamma calculation ────────────────────
    cumulative_gex = np.cumsum(net_gex)
    
    # ─── Key Levels ───────────────────────────────────────────────────
    # Call Wall = strike with highest positive net GEX
    positive_mask = net_gex > 0
    call_wall = float(strikes[positive_mask][np.argmax(net_gex[positive_mask])]) if positive_mask.any() else None
    call_wall_value = float(np.max(net_gex[positive_mask])) if positive_mask.any() else 0
    
    # Put Wall = strike with most negative net GEX (largest absolute value)
    negative_mask = net_gex < 0
    put_wall = float(strikes[negative_mask][np.argmin(net_gex[negative_mask])]) if negative_mask.any() else None
    put_wall_value = float(np.min(net_gex[negative_mask])) if negative_mask.any() else 0
    
    # Zero Gamma (Gamma Flip)
    zero_gamma = find_zero_gamma(strikes, cumulative_gex)
    
    # Max Pain
    call_oi_by_strike = df[df['type'] == 'call'].groupby('strike')['oi'].sum()
    put_oi_by_strike = df[df['type'] == 'put'].groupby('strike')['oi'].sum()
    
    common_strikes = sorted(set(call_oi_by_strike.index) & set(put_oi_by_strike.index))
    if common_strikes:
        cs = np.array(common_strikes)
        c_oi = np.array([call_oi_by_strike.get(s, 0) for s in cs])
        p_oi = np.array([put_oi_by_strike.get(s, 0) for s in cs])
        max_pain = compute_max_pain(cs, c_oi, p_oi)
    else:
        max_pain = None
    
    # Vol Trigger = strike with highest volume-weighted GEX
    vol_weighted = strike_agg['net_gex'].abs() * strike_agg['total_volume']
    vol_trigger_idx = vol_weighted.idxmax() if not vol_weighted.empty else None
    vol_trigger = float(strike_agg.loc[vol_trigger_idx, 'strike']) if vol_trigger_idx is not None else None
    
    # Net GEX (total)
    total_net_gex = float(np.sum(net_gex))
    
    # Regime
    regime = 'LONG_GAMMA' if total_net_gex > 0 else 'SHORT_GAMMA'
    
    # ─── Build heatmap data (per-expiry, per-strike GEX) ──────────────
    for exp_date in expirations:
        exp_df = df[df['expiration'] == exp_date]
        exp_strike_agg = exp_df.groupby('strike').agg(
            net_gex=('gex', 'sum'),
        ).reset_index()
        
        for _, row in exp_strike_agg.iterrows():
            heatmap_data.append({
                'strike': float(row['strike']),
                'expiration': exp_date,
                'gex': float(row['net_gex']),
            })
    
    # ─── Build per-strike response ────────────────────────────────────
    gex_by_strike = []
    for _, row in strike_agg.iterrows():
        gex_by_strike.append({
            'strike': float(row['strike']),
            'call_gex': float(row['call_gex']),
            'put_gex': float(row['put_gex']),
            'net_gex': float(row['net_gex']),
            'total_oi': int(row['total_oi']),
            'total_volume': int(row['total_volume']),
            'avg_iv': round(float(row['avg_iv']) * 100, 2),
        })
    
    # ─── DEX (Delta Exposure) ─────────────────────────────────────────
    call_dex = df[df['type'] == 'call'].apply(
        lambda r: r['delta'] * r['oi'] * 100 * spot / 1_000_000_000, axis=1
    ).sum()
    put_dex = df[df['type'] == 'put'].apply(
        lambda r: r['delta'] * r['oi'] * 100 * spot / 1_000_000_000, axis=1
    ).sum()
    net_dex = float(call_dex + put_dex)
    
    # ─── DEX by Strike ────────────────────────────────────────────────
    df['dex'] = df.apply(
        lambda r: r['delta'] * r['oi'] * 100 * spot / 1_000_000_000, axis=1
    )
    dex_by_strike_agg = df.groupby('strike').agg(
        call_dex=('dex', lambda x: x[df.loc[x.index, 'type'] == 'call'].sum()),
        put_dex=('dex', lambda x: x[df.loc[x.index, 'type'] == 'put'].sum()),
    ).reset_index()
    dex_by_strike_agg['net_dex'] = dex_by_strike_agg['call_dex'] + dex_by_strike_agg['put_dex']
    dex_by_strike_agg = dex_by_strike_agg.sort_values('strike').reset_index(drop=True)
    
    dex_by_strike = []
    for _, row in dex_by_strike_agg.iterrows():
        dex_by_strike.append({
            'strike': float(row['strike']),
            'call_dex': float(row['call_dex']),
            'put_dex': float(row['put_dex']),
            'net_dex': float(row['net_dex']),
        })
    
    # ─── GEX by Expiration ────────────────────────────────────────────
    gex_by_exp = df.groupby('expiration')['gex'].sum().reset_index()
    gex_by_exp.columns = ['expiration', 'total_gex']
    gex_by_exp = gex_by_exp.sort_values('expiration')
    gex_by_expiration = [
        {'expiration': row['expiration'], 'total_gex': round(float(row['total_gex']), 4)}
        for _, row in gex_by_exp.iterrows()
    ]
    
    # ─── IV Skew ──────────────────────────────────────────────────────
    call_iv = df[df['type'] == 'call'].groupby('strike')['iv'].mean().reset_index()
    call_iv.columns = ['strike', 'call_iv']
    put_iv = df[df['type'] == 'put'].groupby('strike')['iv'].mean().reset_index()
    put_iv.columns = ['strike', 'put_iv']
    iv_skew_df = pd.merge(call_iv, put_iv, on='strike', how='outer').sort_values('strike')
    iv_skew = []
    for _, row in iv_skew_df.iterrows():
        iv_skew.append({
            'strike': float(row['strike']),
            'call_iv': round(float(row.get('call_iv', 0) or 0) * 100, 2),
            'put_iv': round(float(row.get('put_iv', 0) or 0) * 100, 2),
        })
    
    # ─── Put/Call OI Ratio by Strike ──────────────────────────────────
    call_oi_agg = df[df['type'] == 'call'].groupby('strike')['oi'].sum().reset_index()
    call_oi_agg.columns = ['strike', 'call_oi']
    put_oi_agg = df[df['type'] == 'put'].groupby('strike')['oi'].sum().reset_index()
    put_oi_agg.columns = ['strike', 'put_oi']
    pc_df = pd.merge(call_oi_agg, put_oi_agg, on='strike', how='outer').fillna(0).sort_values('strike')
    pc_ratio = []
    for _, row in pc_df.iterrows():
        c = int(row['call_oi'])
        p = int(row['put_oi'])
        ratio = round(p / c, 2) if c > 0 else 0.0
        pc_ratio.append({
            'strike': float(row['strike']),
            'call_oi': c,
            'put_oi': p,
            'pc_ratio': ratio,
        })
    
    # ─── Vanna Exposure by Strike ─────────────────────────────────────
    df['vex'] = df.apply(
        lambda r: r['vanna'] * r['oi'] * 100 * spot / 1_000_000_000
                  * (1.0 if r['type'] == 'call' else -1.0),
        axis=1
    )
    vex_agg = df.groupby('strike')['vex'].sum().reset_index()
    vex_agg = vex_agg.sort_values('strike')
    vanna_by_strike = [
        {'strike': float(row['strike']), 'vanna_exposure': round(float(row['vex']), 6)}
        for _, row in vex_agg.iterrows()
    ]
    
    return {
        'spot': round(spot, 2),
        'gex_by_strike': gex_by_strike,
        'key_levels': {
            'call_wall': round(call_wall, 2) if call_wall else None,
            'call_wall_gex': round(call_wall_value, 4),
            'put_wall': round(put_wall, 2) if put_wall else None,
            'put_wall_gex': round(put_wall_value, 4),
            'zero_gamma': round(zero_gamma, 2) if zero_gamma else None,
            'max_pain': round(max_pain, 2) if max_pain else None,
            'vol_trigger': round(vol_trigger, 2) if vol_trigger else None,
        },
        'expirations': expirations,
        'net_gex': round(total_net_gex, 4),
        'net_dex': round(net_dex, 4),
        'regime': regime,
        'heatmap_data': heatmap_data,
        'dex_by_strike': dex_by_strike,
        'gex_by_expiration': gex_by_expiration,
        'iv_skew': iv_skew,
        'pc_ratio': pc_ratio,
        'vanna_by_strike': vanna_by_strike,
    }
