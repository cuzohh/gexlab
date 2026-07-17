import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, Any, List
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

class LevelIntelligenceService:
    @staticmethod
    def _calculate_flip_for_metric(agg_strikes: List[Dict[str, Any]], metric_key: str, spot_price: float = 0.0) -> float | None:
        df = pd.DataFrame(agg_strikes)
        if df.empty or metric_key not in df.columns:
            return None

        df = df.sort_values("strike").reset_index(drop=True)
        series = df[metric_key].fillna(0.0)
        if series.empty:
            return None

        signs = np.sign(series)
        non_zero_mask = signs != 0
        df_nz = df[non_zero_mask].reset_index(drop=True)
        series_nz = series[non_zero_mask].reset_index(drop=True)
        if df_nz.empty:
            return None
        sign_changes = np.sign(series_nz).diff().fillna(0)
        crossings = df_nz[sign_changes != 0]

        if crossings.empty:
            return None

        flip_prices = []
        for idx in crossings.index:
            if idx == 0:
                flip_prices.append(float(df_nz.iloc[0]["strike"]))
                continue
            left = df_nz.iloc[idx - 1]
            right = df_nz.iloc[idx]
            lv = left[metric_key]
            rv = right[metric_key]
            if rv == lv:
                flip_prices.append(float(right["strike"]))
            else:
                flip_prices.append(float(left["strike"] + (0 - lv) * (right["strike"] - left["strike"]) / (rv - lv)))

        if spot_price > 0:
            return min(flip_prices, key=lambda p: abs(p - spot_price))
        return flip_prices[0]

    @staticmethod
    def _identify_metric_walls(
        agg_strikes: List[Dict[str, Any]],
        metric_key: str,
        spot_price: float = 0.0,
    ) -> Dict[str, Any]:
        df = pd.DataFrame(agg_strikes)
        if df.empty or metric_key not in df.columns:
            return {"callWall": None, "putWall": None, "majorWalls": None}

        df = df.copy()
        df["strike"] = pd.to_numeric(df["strike"], errors="coerce")
        df[metric_key] = pd.to_numeric(df[metric_key], errors="coerce").fillna(0.0)
        df = df[df["strike"].notna()]
        if df.empty:
            return {"callWall": None, "putWall": None, "majorWalls": None}

        if spot_price > 0:
            upside = df[df["strike"] >= spot_price]
            downside = df[df["strike"] <= spot_price]
        else:
            upside = df
            downside = df

        if upside.empty:
            upside = df
        if downside.empty:
            downside = df

        upside_ranked = upside.assign(_abs=upside[metric_key].abs()).sort_values("_abs", ascending=False)
        downside_ranked = downside.assign(_abs=downside[metric_key].abs()).sort_values("_abs", ascending=False)
        call_wall = None if upside_ranked.empty else float(upside_ranked.iloc[0]["strike"])
        put_wall = None if downside_ranked.empty else float(downside_ranked.iloc[0]["strike"])

        return {
            "callWall": call_wall,
            "putWall": put_wall,
            "majorWalls": {
                "calls": upside_ranked.head(3)[["strike", metric_key]].rename(columns={metric_key: "gex"}).to_dict(orient="records"),
                "puts": downside_ranked.head(3)[["strike", metric_key]].rename(columns={metric_key: "gex"}).to_dict(orient="records"),
            },
        }

    @staticmethod
    def _derive_relevant_levels(agg_strikes: List[Dict[str, Any]], raw_list: List[Dict[str, Any]], spot_price: float = 0.0) -> Dict[str, Any]:
        df_agg = pd.DataFrame(agg_strikes)
        df_raw = pd.DataFrame(raw_list)

        derived: Dict[str, Any] = {
            "sessionFloor": None,
            "oiCallWall": None,
            "oiPutWall": None,
            "weakCallOIStrike": None,
            "weakPutOIStrike": None,
            "protectedGammaHigh": None,
            "protectedGammaLow": None,
            "aggressiveCallCeiling": None,
            "aggressivePutFloor": None,
            "skewRichStrike": None,
            "skewCheapStrike": None,
        }

        if not df_agg.empty:
            if spot_price:
                above_spot = df_agg["strike"] >= spot_price
                below_spot = df_agg["strike"] <= spot_price
                positive_gex = df_agg["gex"] > 0
                negative_gex = df_agg["gex"] < 0

                floor_candidates = df_agg.loc[below_spot & negative_gex]
                if not floor_candidates.empty and not floor_candidates["gex"].isna().all():
                    derived["sessionFloor"] = float(floor_candidates.loc[floor_candidates["gex"].idxmin(), "strike"])

                protected_high = df_agg.loc[above_spot & positive_gex]
                if not protected_high.empty and not protected_high["gex"].isna().all():
                    derived["protectedGammaHigh"] = float(protected_high.loc[protected_high["gex"].idxmax(), "strike"])

                protected_low = df_agg.loc[below_spot & positive_gex]
                if not protected_low.empty and not protected_low["gex"].isna().all():
                    derived["protectedGammaLow"] = float(protected_low.loc[protected_low["gex"].idxmax(), "strike"])

            if "iv" in df_agg.columns and not df_agg["iv"].isna().all():
                derived["skewRichStrike"] = float(df_agg.loc[df_agg["iv"].idxmax(), "strike"])
                derived["skewCheapStrike"] = float(df_agg.loc[df_agg["iv"].idxmin(), "strike"])

        if not df_raw.empty:
            if "openInterest" in df_raw.columns:
                oi_by_type = (
                    df_raw.groupby(["type", "strike"], as_index=False)["openInterest"]
                    .sum()
                    .fillna(0)
                )

                call_oi = oi_by_type[oi_by_type["type"] == "call"]
                put_oi = oi_by_type[oi_by_type["type"] == "put"]

                if not call_oi.empty and not call_oi["openInterest"].isna().all():
                    derived["oiCallWall"] = float(call_oi.loc[call_oi["openInterest"].idxmax(), "strike"])
                    positive_call_oi = call_oi[call_oi["openInterest"] > 0]
                    if not positive_call_oi.empty:
                        if spot_price:
                            above_call = positive_call_oi[positive_call_oi["strike"] >= spot_price]
                            positive_call_oi = above_call if not above_call.empty else positive_call_oi
                        if not positive_call_oi.empty and not positive_call_oi["openInterest"].isna().all():
                            derived["weakCallOIStrike"] = float(positive_call_oi.loc[positive_call_oi["openInterest"].idxmin(), "strike"])

                if not put_oi.empty and not put_oi["openInterest"].isna().all():
                    derived["oiPutWall"] = float(put_oi.loc[put_oi["openInterest"].idxmax(), "strike"])
                    positive_put_oi = put_oi[put_oi["openInterest"] > 0]
                    if not positive_put_oi.empty:
                        if spot_price:
                            below_put = positive_put_oi[positive_put_oi["strike"] <= spot_price]
                            positive_put_oi = below_put if not below_put.empty else positive_put_oi
                        if not positive_put_oi.empty and not positive_put_oi["openInterest"].isna().all():
                            derived["weakPutOIStrike"] = float(positive_put_oi.loc[positive_put_oi["openInterest"].idxmin(), "strike"])

            if "volume" in df_raw.columns:
                volume_by_type = (
                    df_raw.groupby(["type", "strike"], as_index=False)["volume"]
                    .sum()
                    .fillna(0)
                )
                call_volume = volume_by_type[volume_by_type["type"] == "call"]
                put_volume = volume_by_type[volume_by_type["type"] == "put"]

                if not call_volume.empty and not call_volume["volume"].isna().all():
                    if spot_price:
                        call_volume_above = call_volume[call_volume["strike"] >= spot_price]
                        call_volume = call_volume_above if not call_volume_above.empty else call_volume
                    if not call_volume.empty and not call_volume["volume"].isna().all():
                        derived["aggressiveCallCeiling"] = float(call_volume.loc[call_volume["volume"].idxmax(), "strike"])

                if not put_volume.empty and not put_volume["volume"].isna().all():
                    if spot_price:
                        put_volume_below = put_volume[put_volume["strike"] <= spot_price]
                        put_volume = put_volume_below if not put_volume_below.empty else put_volume
                    if not put_volume.empty and not put_volume["volume"].isna().all():
                        derived["aggressivePutFloor"] = float(put_volume.loc[put_volume["volume"].idxmax(), "strike"])

        return derived

    @staticmethod
    def _calculate_lambda_bands(raw_list: List[Dict[str, Any]], spot_price: float = 0.0) -> Dict[str, Any]:
        if spot_price <= 0:
            return {
                "up1": None,
                "down1": None,
                "up2": None,
                "down2": None,
                "sigmaMove": None,
                "weightedIv": None,
                "weightedDte": None,
            }

        df = pd.DataFrame(raw_list)
        required = {"lex", "iv", "expiry"}
        if df.empty or not required.issubset(df.columns):
            return {
                "up1": None,
                "down1": None,
                "up2": None,
                "down2": None,
                "sigmaMove": None,
                "weightedIv": None,
                "weightedDte": None,
            }

        weights = pd.to_numeric(df["lex"], errors="coerce").abs().fillna(0.0)
        iv = pd.to_numeric(df["iv"], errors="coerce").clip(lower=0.01, upper=3.0)
        expiry = pd.to_datetime(df["expiry"], errors="coerce")
        reference = pd.Timestamp(datetime.now(_ET).date())
        dte = (expiry.dt.tz_localize(None).dt.normalize() - reference).dt.days.clip(lower=1, upper=30)
        valid = (weights > 0) & iv.notna() & dte.notna()
        if not valid.any():
            return {
                "up1": None,
                "down1": None,
                "up2": None,
                "down2": None,
                "sigmaMove": None,
                "weightedIv": None,
                "weightedDte": None,
            }

        w = weights.loc[valid]
        weighted_iv = float(np.average(iv.loc[valid], weights=w))
        weighted_dte = float(np.average(dte.loc[valid], weights=w))
        sigma_move = float(spot_price * weighted_iv * np.sqrt(weighted_dte / 252.0))
        return {
            "up1": round(spot_price + sigma_move, 2),
            "down1": round(spot_price - sigma_move, 2),
            "up2": round(spot_price + (2.0 * sigma_move), 2),
            "down2": round(spot_price - (2.0 * sigma_move), 2),
            "sigmaMove": round(sigma_move, 2),
            "weightedIv": round(weighted_iv, 4),
            "weightedDte": round(weighted_dte, 2),
        }

    @staticmethod
    def _summarize_levels(agg_strikes: List[Dict[str, Any]], raw_list: List[Dict[str, Any]], spot_price: float = 0.0) -> Dict[str, Any]:
        if not agg_strikes:
            return {
                "gammaFlip": None,
                "callWall": None,
                "putWall": None,
                "sessionCeiling": None,
                "maxPain": 0.0,
                "vannaMagnet": 0.0,
                "majorWalls": None,
                "derived": LevelIntelligenceService._derive_relevant_levels([], [], spot_price),
            }

        flip = LevelIntelligenceService.calculate_gamma_flip(agg_strikes, spot_price)
        walls = LevelIntelligenceService.identify_walls(agg_strikes, spot_price)
        max_pain = LevelIntelligenceService.calculate_max_pain(raw_list)

        df_agg = pd.DataFrame(agg_strikes)

        def _greek_levels(metric: str) -> Dict[str, Any]:
            return {
                "flip": LevelIntelligenceService._calculate_flip_for_metric(agg_strikes, metric, spot_price),
                **LevelIntelligenceService._identify_metric_walls(agg_strikes, metric, spot_price),
            }

        dex_levels   = _greek_levels("dex")
        lambda_levels = _greek_levels("lex")
        vanna_levels = _greek_levels("vex")    # vex = vanna exposure
        charm_levels = _greek_levels("chex")   # chex = charm exposure
        speed_levels = _greek_levels("spex")   # spex = speed exposure
        zomma_levels = _greek_levels("zomex")  # zomex = zomma exposure
        vomma_levels = _greek_levels("vomex")  # vomex = vomma exposure

        if not df_agg.empty and 'vex' in df_agg.columns and not df_agg['vex'].isna().all():
            vanna_magnet = float(df_agg.loc[df_agg['vex'].abs().idxmax(), 'strike'])
        else:
            vanna_magnet = 0.0

        session_ceiling = walls.get("callWall")
        if not df_agg.empty and 'gex' in df_agg.columns and spot_price:
            ceiling_candidates = df_agg[df_agg['strike'] >= spot_price]
            if not ceiling_candidates.empty and not ceiling_candidates['gex'].isna().all():
                session_ceiling = float(ceiling_candidates.loc[ceiling_candidates['gex'].idxmax(), 'strike'])

        return {
            "gammaFlip": round(flip, 2) if flip is not None else None,
            "callWall": walls.get("callWall"),
            "putWall": walls.get("putWall"),
            "sessionCeiling": session_ceiling,
            "maxPain": max_pain,
            "vannaMagnet": vanna_magnet,
            "majorWalls": walls.get("majorWalls"),
            "dex": dex_levels,
            "lambda": {
                **lambda_levels,
                "bands": LevelIntelligenceService._calculate_lambda_bands(raw_list, spot_price),
            },
            "vanna": vanna_levels,
            "charm": charm_levels,
            "speed": speed_levels,
            "zomma": zomma_levels,
            "vomma": vomma_levels,
            "derived": LevelIntelligenceService._derive_relevant_levels(agg_strikes, raw_list, spot_price),
        }

    @staticmethod
    def _interpolate_crossing(df: pd.DataFrame, idx: int) -> float:
        if idx == 0:
            return float(df.iloc[0]['strike'])
        s1 = df.iloc[idx - 1]
        s2 = df.iloc[idx]
        if s2['gex'] == s1['gex']:
            return float(s2['strike'])
        return float(s1['strike'] + (0 - s1['gex']) * (s2['strike'] - s1['strike']) / (s2['gex'] - s1['gex']))

    @staticmethod
    def calculate_gamma_flip(agg_strikes: List[Dict[str, Any]], spot_price: float = 0.0) -> float | None:
        """
        Find the price where net GEX crosses zero, preferring the crossing nearest spot.
        """
        df = pd.DataFrame(agg_strikes).sort_values('strike').reset_index(drop=True)
        if df.empty:
            return None

        df['sign'] = np.sign(df['gex'])
        # Drop exact-zero rows before diff so 0 doesn't register as a crossing.
        non_zero = df[df['sign'] != 0].copy()
        if non_zero.empty:
            return None
        non_zero = non_zero.reset_index(drop=True)
        non_zero['sign_change'] = non_zero['sign'].diff().fillna(0)
        crossings = non_zero[non_zero['sign_change'] != 0]

        if crossings.empty:
            return None

        flip_prices = [
            LevelIntelligenceService._interpolate_crossing(non_zero, idx)
            for idx in crossings.index
        ]

        if spot_price > 0:
            return min(flip_prices, key=lambda p: abs(p - spot_price))

        return flip_prices[0]

    @staticmethod
    def identify_walls(agg_strikes: List[Dict[str, Any]], spot_price: float = 0.0) -> Dict[str, Any]:
        """
        Identify major GEX walls and secondary levels.
        """
        df = pd.DataFrame(agg_strikes)
        if df.empty or 'gex' not in df.columns or df['gex'].isna().all():
            return {}

        df = df.copy()
        df["strike"] = pd.to_numeric(df["strike"], errors="coerce")
        df["gex"] = pd.to_numeric(df["gex"], errors="coerce").fillna(0.0)
        df = df[df["strike"].notna()]
        if df.empty:
            return {}

        if spot_price > 0:
            upside = df[df["strike"] >= spot_price]
            downside = df[df["strike"] <= spot_price]
        else:
            upside = df
            downside = df

        if upside.empty:
            upside = df
        if downside.empty:
            downside = df

        positive_upside = upside[upside["gex"] > 0]
        negative_downside = downside[downside["gex"] < 0]

        if positive_upside.empty:
            top_calls = upside.assign(_abs=upside["gex"].abs()).sort_values("_abs", ascending=False).head(3)
        else:
            top_calls = positive_upside.sort_values("gex", ascending=False).head(3)

        if negative_downside.empty:
            top_puts = downside.assign(_abs=downside["gex"].abs()).sort_values("_abs", ascending=False).head(3)
        else:
            top_puts = negative_downside.sort_values("gex", ascending=True).head(3)

        call_wall_strike = top_calls.iloc[0]["strike"] if not top_calls.empty else None
        call_wall_mag = top_calls.iloc[0]["gex"] if not top_calls.empty else None
        put_wall_strike = top_puts.iloc[0]["strike"] if not top_puts.empty else None
        put_wall_mag = top_puts.iloc[0]["gex"] if not top_puts.empty else None

        return {
            "callWall": float(call_wall_strike) if call_wall_strike is not None else None,
            "callWallMag": float(call_wall_mag) if call_wall_mag is not None else None,
            "putWall": float(put_wall_strike) if put_wall_strike is not None else None,
            "putWallMag": float(put_wall_mag) if put_wall_mag is not None else None,
            "majorWalls": {
                "calls": top_calls[['strike', 'gex']].to_dict(orient="records"),
                "puts": top_puts[['strike', 'gex']].to_dict(orient="records")
            }
        }

    @staticmethod
    def calculate_max_pain(raw_data: List[Dict[str, Any]]) -> float:
        """
        Calculate Max Pain level (strike where total intrinsic value is minimized).
        Vectorized: O(n*m) numpy broadcasting instead of O(n²) Python loop.
        """
        df = pd.DataFrame(raw_data)
        if df.empty:
            return 0.0

        df['openInterest'] = df['openInterest'].fillna(0)
        calls = df[df['type'] == 'call']
        puts = df[df['type'] == 'put']
        strikes = np.sort(df['strike'].unique())

        # Broadcast: strikes (m,) vs contract strikes (n,) → (m, n) matrices
        call_strikes = calls['strike'].values[np.newaxis, :]   # (1, n_calls)
        call_oi = calls['openInterest'].values[np.newaxis, :]
        put_strikes = puts['strike'].values[np.newaxis, :]     # (1, n_puts)
        put_oi = puts['openInterest'].values[np.newaxis, :]
        s = strikes[:, np.newaxis]                             # (m, 1)

        pain = (np.maximum(0, s - call_strikes) * call_oi).sum(axis=1) + \
               (np.maximum(0, put_strikes - s) * put_oi).sum(axis=1)

        return float(strikes[np.argmin(pain)])

    def get_market_levels(self, analytics_data: Dict[str, Any], raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Aggregate all institutional levels.
        """
        agg_strikes = analytics_data.get("strikes", [])
        analytics_raw = analytics_data.get("raw", [])
        raw_list = analytics_raw or raw_data.get("data", [])
        spot_price = float(raw_data.get("spotPrice") or analytics_data.get("summary", {}).get("spotPrice") or 0.0)

        levels = self._summarize_levels(agg_strikes, raw_list, spot_price)

        df_raw = pd.DataFrame(analytics_raw)
        if df_raw.empty:
            levels["byDte"] = []
            return levels

        df_raw["expiry_dt"] = pd.to_datetime(df_raw["expiry"], errors="coerce").dt.normalize()
        valid_expiry = df_raw["expiry_dt"].notna()
        if not valid_expiry.any():
            levels["byDte"] = []
            return levels

        reference_timestamp = pd.to_datetime(
            raw_data.get("timestamp") or analytics_data.get("summary", {}).get("timestamp"),
            errors="coerce",
            utc=True,
        )
        if pd.isna(reference_timestamp):
            reference_date = pd.Timestamp.now(tz="America/New_York").normalize().tz_localize(None)
        else:
            reference_date = reference_timestamp.tz_convert("America/New_York").normalize().tz_localize(None)

        df_raw = df_raw.loc[valid_expiry].copy()
        df_raw["dte"] = (df_raw["expiry_dt"] - reference_date).dt.days
        df_raw = df_raw[(df_raw["dte"] >= 0) & (df_raw["dte"] <= 5)]

        by_dte = []
        for dte, dte_df in df_raw.groupby("dte"):
            available = set(dte_df.columns)
            agg_spec = {
                "gex": "sum",
                "dex": "sum",
                "lex": "sum",
                "vex": "sum",
                "chex": "sum",
                "openInterest": "sum",
                "volume": "sum",
                "iv": "mean",
            }
            for col in ("spex", "zomex", "vomex"):
                if col in available:
                    agg_spec[col] = "sum"
            agg = (
                dte_df.groupby("strike")
                .agg(agg_spec)
                .reset_index()
            )
            expiry_value = dte_df["expiry"].min()
            dte_levels = self._summarize_levels(agg.to_dict(orient="records"), dte_df.to_dict(orient="records"), spot_price)
            dte_levels["dte"] = int(dte)
            dte_levels["expiry"] = str(expiry_value)
            by_dte.append(dte_levels)

        levels["byDte"] = sorted(by_dte, key=lambda item: item["dte"])
        return levels
