from copy import deepcopy
from datetime import date, datetime, timezone
import logging
from typing import Any

import numpy as np
import pandas as pd
from cachetools import TTLCache
from yahooquery import Ticker

from api.errors import InvalidTickerError, NoOptionsDataError, RateLimitError, UpstreamAPIError
from engine.gex_calculator import (
    black_scholes_delta,
    black_scholes_gamma,
    black_scholes_vanna,
    calculate_gex_vectorized,
    compute_max_pain,
    find_zero_gamma,
)

logger = logging.getLogger(__name__)

RISK_FREE_RATE = 0.043
cache = TTLCache(maxsize=100, ttl=300)


def _safe_int(val: Any) -> int:
    if pd.isna(val):
        return 0
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


def _safe_float(val: Any) -> float:
    if pd.isna(val):
        return 0.0
    try:
        fval = float(val)
        return 0.0 if pd.isna(fval) else fval
    except (ValueError, TypeError):
        return 0.0


def _years_to_expiry(expiry_str: str) -> float:
    exp_date = datetime.strptime(expiry_str, "%Y-%m-%d").date()
    today = date.today()
    days = (exp_date - today).days
    return max(days / 365.0, 1 / 365.0)


def _cache_key(symbol: str, max_expirations: int) -> tuple[str, int]:
    return (symbol, max_expirations)


def _with_cache_metadata(payload: dict[str, Any], generated_at: datetime, cache_hit: bool) -> dict[str, Any]:
    response = deepcopy(payload)
    response["meta"] = {
        "source": "yahooquery",
        "generated_at": generated_at.isoformat(),
        "cache_hit": cache_hit,
        "cache_age_seconds": round((datetime.now(timezone.utc) - generated_at).total_seconds(), 3),
    }
    return response


def _build_empty_payload(spot: float, expirations: list[str]) -> dict[str, Any]:
    return {
        "spot": round(spot, 2),
        "gex_by_strike": [],
        "key_levels": {},
        "expirations": expirations,
        "net_gex": 0,
        "net_dex": 0,
        "regime": "UNKNOWN",
        "heatmap_data": [],
        "dex_by_strike": [],
        "gex_by_expiration": [],
        "iv_skew": [],
        "pc_ratio": [],
        "vanna_by_strike": [],
    }


def fetch_options_chain(ticker_symbol: str, max_expirations: int = 3) -> dict[str, Any]:
    symbol = ticker_symbol.upper()
    key = _cache_key(symbol, max_expirations)
    cached_entry = cache.get(key)

    if cached_entry is not None:
        logger.info("options_chain cache_hit symbol=%s max_expirations=%s", symbol, max_expirations)
        return _with_cache_metadata(cached_entry["payload"], cached_entry["generated_at"], True)

    ticker = Ticker(symbol)

    try:
        price_data = ticker.price.get(symbol, {})
        if not price_data or isinstance(price_data, str):
            raise UpstreamAPIError(f"Yahoo Finance returned an invalid price response for {symbol}: {price_data}")

        spot = float(price_data.get("regularMarketPrice", 0))
        if spot <= 0:
            raise InvalidTickerError(f"Could not retrieve a valid spot price for {symbol}.")

        df_all = ticker.option_chain
        if isinstance(df_all, str):
            if "Too Many Requests" in df_all or "429" in df_all:
                raise RateLimitError("Yahoo Finance is currently rate limiting requests for this IP. Please retry in about a minute.")
            raise UpstreamAPIError(f"Yahoo Finance error for {symbol}: {df_all}")

        if df_all is None or df_all.empty:
            raise NoOptionsDataError(f"No options found for {symbol}.")
    except (RateLimitError, InvalidTickerError, NoOptionsDataError, UpstreamAPIError):
        raise
    except (AttributeError, KeyError, TypeError, ValueError) as exc:
        raise UpstreamAPIError(f"API error for {symbol}: {exc}") from exc

    all_exps = sorted(df_all.index.get_level_values("expiration").unique())
    selected_exps = all_exps[:max_expirations]
    expirations = [str(exp).split(" ")[0] for exp in selected_exps]

    try:
        df_filtered = df_all.xs(symbol, level="symbol").loc[selected_exps]
    except (KeyError, TypeError) as exc:
        raise NoOptionsDataError(f"Could not isolate options data for {symbol}.") from exc

    all_strikes_data: list[dict[str, Any]] = []
    heatmap_data: list[dict[str, float | str]] = []

    for (exp, otype), row in df_filtered.iterrows():
        opt_type = "call" if otype == "calls" else "put"
        strike = _safe_float(row["strike"])
        oi = _safe_int(row.get("openInterest", 0))
        volume = _safe_int(row.get("volume", 0))
        iv = _safe_float(row.get("impliedVolatility", 0))
        last_price = _safe_float(row.get("lastPrice", 0))

        if iv <= 0 or oi <= 0:
            continue

        expiry = str(exp).split(" ")[0]
        time_to_expiry = _years_to_expiry(expiry)
        gamma = black_scholes_gamma(spot, strike, time_to_expiry, RISK_FREE_RATE, iv)
        delta = black_scholes_delta(spot, strike, time_to_expiry, RISK_FREE_RATE, iv, opt_type)
        vanna = black_scholes_vanna(spot, strike, time_to_expiry, RISK_FREE_RATE, iv)

        all_strikes_data.append({
            "strike": strike,
            "expiration": expiry,
            "type": opt_type,
            "oi": oi,
            "volume": volume,
            "iv": iv,
            "gamma": gamma,
            "delta": delta,
            "vanna": vanna,
            "last_price": last_price,
            "T": time_to_expiry,
        })

    if not all_strikes_data:
        payload = _build_empty_payload(spot, expirations)
        generated_at = datetime.now(timezone.utc)
        cache[key] = {"payload": payload, "generated_at": generated_at}
        return _with_cache_metadata(payload, generated_at, False)

    df = pd.DataFrame(all_strikes_data)
    gex_raw = calculate_gex_vectorized(df["gamma"].values, df["oi"].values, spot)
    df["gex"] = gex_raw * np.where(df["type"] == "call", 1.0, -1.0)

    strike_agg = df.groupby("strike").agg(
        call_gex=("gex", lambda x: x[df.loc[x.index, "type"] == "call"].sum()),
        put_gex=("gex", lambda x: x[df.loc[x.index, "type"] == "put"].sum()),
        total_oi=("oi", "sum"),
        total_volume=("volume", "sum"),
        avg_iv=("iv", "mean"),
    ).reset_index()
    strike_agg["net_gex"] = strike_agg["call_gex"] + strike_agg["put_gex"]
    strike_agg = strike_agg.sort_values("strike").reset_index(drop=True)

    strikes = strike_agg["strike"].values
    net_gex = strike_agg["net_gex"].values
    cumulative_gex = np.cumsum(net_gex)

    positive_mask = net_gex > 0
    call_wall = float(strikes[positive_mask][np.argmax(net_gex[positive_mask])]) if positive_mask.any() else None
    call_wall_value = float(np.max(net_gex[positive_mask])) if positive_mask.any() else 0

    negative_mask = net_gex < 0
    put_wall = float(strikes[negative_mask][np.argmin(net_gex[negative_mask])]) if negative_mask.any() else None
    put_wall_value = float(np.min(net_gex[negative_mask])) if negative_mask.any() else 0

    zero_gamma = find_zero_gamma(strikes, cumulative_gex)

    call_oi_by_strike = df[df["type"] == "call"].groupby("strike")["oi"].sum()
    put_oi_by_strike = df[df["type"] == "put"].groupby("strike")["oi"].sum()
    common_strikes = sorted(set(call_oi_by_strike.index) & set(put_oi_by_strike.index))

    if common_strikes:
        common_strikes_np = np.array(common_strikes)
        call_oi = np.array([call_oi_by_strike.get(strike, 0) for strike in common_strikes_np])
        put_oi = np.array([put_oi_by_strike.get(strike, 0) for strike in common_strikes_np])
        max_pain = compute_max_pain(common_strikes_np, call_oi, put_oi)
    else:
        max_pain = None

    vol_weighted = strike_agg["net_gex"].abs() * strike_agg["total_volume"]
    vol_trigger_idx = vol_weighted.idxmax() if not vol_weighted.empty else None
    vol_trigger = float(strike_agg.loc[vol_trigger_idx, "strike"]) if vol_trigger_idx is not None else None

    total_net_gex = float(np.sum(net_gex))
    regime = "LONG_GAMMA" if total_net_gex > 0 else "SHORT_GAMMA"

    for exp_date in expirations:
        exp_df = df[df["expiration"] == exp_date]
        exp_strike_agg = exp_df.groupby("strike").agg(net_gex=("gex", "sum")).reset_index()
        for _, row in exp_strike_agg.iterrows():
            heatmap_data.append({
                "strike": float(row["strike"]),
                "expiration": exp_date,
                "gex": float(row["net_gex"]),
            })

    gex_by_strike = [
        {
            "strike": float(row["strike"]),
            "call_gex": float(row["call_gex"]),
            "put_gex": float(row["put_gex"]),
            "net_gex": float(row["net_gex"]),
            "total_oi": int(row["total_oi"]),
            "total_volume": int(row["total_volume"]),
            "avg_iv": round(float(row["avg_iv"]) * 100, 2),
        }
        for _, row in strike_agg.iterrows()
    ]

    call_dex = df[df["type"] == "call"].apply(
        lambda row: row["delta"] * row["oi"] * 100 * spot / 1_000_000_000,
        axis=1,
    ).sum()
    put_dex = df[df["type"] == "put"].apply(
        lambda row: row["delta"] * row["oi"] * 100 * spot / 1_000_000_000,
        axis=1,
    ).sum()
    net_dex = float(call_dex + put_dex)

    df["dex"] = df.apply(
        lambda row: row["delta"] * row["oi"] * 100 * spot / 1_000_000_000,
        axis=1,
    )
    dex_by_strike_agg = df.groupby("strike").agg(
        call_dex=("dex", lambda x: x[df.loc[x.index, "type"] == "call"].sum()),
        put_dex=("dex", lambda x: x[df.loc[x.index, "type"] == "put"].sum()),
    ).reset_index()
    dex_by_strike_agg["net_dex"] = dex_by_strike_agg["call_dex"] + dex_by_strike_agg["put_dex"]
    dex_by_strike_agg = dex_by_strike_agg.sort_values("strike").reset_index(drop=True)
    dex_by_strike = [
        {
            "strike": float(row["strike"]),
            "call_dex": float(row["call_dex"]),
            "put_dex": float(row["put_dex"]),
            "net_dex": float(row["net_dex"]),
        }
        for _, row in dex_by_strike_agg.iterrows()
    ]

    gex_by_exp = df.groupby("expiration")["gex"].sum().reset_index()
    gex_by_exp.columns = ["expiration", "total_gex"]
    gex_by_exp = gex_by_exp.sort_values("expiration")
    gex_by_expiration = [
        {"expiration": row["expiration"], "total_gex": round(float(row["total_gex"]), 4)}
        for _, row in gex_by_exp.iterrows()
    ]

    call_iv = df[df["type"] == "call"].groupby("strike")["iv"].mean().reset_index()
    call_iv.columns = ["strike", "call_iv"]
    put_iv = df[df["type"] == "put"].groupby("strike")["iv"].mean().reset_index()
    put_iv.columns = ["strike", "put_iv"]
    iv_skew_df = pd.merge(call_iv, put_iv, on="strike", how="outer").fillna(0).sort_values("strike")
    iv_skew = [
        {
            "strike": float(row["strike"]),
            "call_iv": round(float(row.get("call_iv", 0)) * 100, 2),
            "put_iv": round(float(row.get("put_iv", 0)) * 100, 2),
        }
        for _, row in iv_skew_df.iterrows()
    ]

    call_oi_agg = df[df["type"] == "call"].groupby("strike")["oi"].sum().reset_index()
    call_oi_agg.columns = ["strike", "call_oi"]
    put_oi_agg = df[df["type"] == "put"].groupby("strike")["oi"].sum().reset_index()
    put_oi_agg.columns = ["strike", "put_oi"]
    pc_df = pd.merge(call_oi_agg, put_oi_agg, on="strike", how="outer").fillna(0).sort_values("strike")
    pc_ratio = []
    for _, row in pc_df.iterrows():
        call_oi_value = int(row["call_oi"])
        put_oi_value = int(row["put_oi"])
        ratio = round(put_oi_value / call_oi_value, 2) if call_oi_value > 0 else 0.0
        pc_ratio.append({
            "strike": float(row["strike"]),
            "call_oi": call_oi_value,
            "put_oi": put_oi_value,
            "pc_ratio": ratio,
        })

    df["vex"] = df.apply(
        lambda row: row["vanna"] * row["oi"] * 100 * spot / 1_000_000_000 * (1.0 if row["type"] == "call" else -1.0),
        axis=1,
    )
    vex_agg = df.groupby("strike")["vex"].sum().reset_index().sort_values("strike")
    vanna_by_strike = [
        {"strike": float(row["strike"]), "vanna_exposure": round(float(row["vex"]), 6)}
        for _, row in vex_agg.iterrows()
    ]

    payload = {
        "spot": round(spot, 2),
        "gex_by_strike": gex_by_strike,
        "key_levels": {
            "call_wall": round(call_wall, 2) if call_wall is not None else None,
            "call_wall_gex": round(call_wall_value, 4),
            "put_wall": round(put_wall, 2) if put_wall is not None else None,
            "put_wall_gex": round(put_wall_value, 4),
            "zero_gamma": round(zero_gamma, 2) if zero_gamma is not None else None,
            "max_pain": round(max_pain, 2) if max_pain is not None else None,
            "vol_trigger": round(vol_trigger, 2) if vol_trigger is not None else None,
        },
        "expirations": expirations,
        "net_gex": round(total_net_gex, 4),
        "net_dex": round(net_dex, 4),
        "regime": regime,
        "heatmap_data": heatmap_data,
        "dex_by_strike": dex_by_strike,
        "gex_by_expiration": gex_by_expiration,
        "iv_skew": iv_skew,
        "pc_ratio": pc_ratio,
        "vanna_by_strike": vanna_by_strike,
    }

    generated_at = datetime.now(timezone.utc)
    cache[key] = {"payload": payload, "generated_at": generated_at}
    logger.info(
        "options_chain cache_miss symbol=%s max_expirations=%s strikes=%s expirations=%s",
        symbol,
        max_expirations,
        len(gex_by_strike),
        len(expirations),
    )
    return _with_cache_metadata(payload, generated_at, False)
