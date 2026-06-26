import numpy as np
import pandas as pd
from typing import Dict, Any, List

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
        sign_changes = signs.diff().fillna(0)
        crossings = df[sign_changes != 0]

        if crossings.empty:
            return None

        flip_prices = []
        for idx in crossings.index:
            if idx == 0:
                flip_prices.append(float(df.iloc[0]["strike"]))
                continue
            left = df.iloc[idx - 1]
            right = df.iloc[idx]
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
    def _identify_metric_walls(agg_strikes: List[Dict[str, Any]], metric_key: str) -> Dict[str, Any]:
        df = pd.DataFrame(agg_strikes)
        if df.empty or metric_key not in df.columns:
            return {"callWall": None, "putWall": None, "majorWalls": None}

        positive = df.sort_values(metric_key, ascending=False).head(3)
        negative = df.sort_values(metric_key, ascending=True).head(3)
        call_wall = None if positive.empty else float(positive.iloc[0]["strike"])
        put_wall = None if negative.empty else float(negative.iloc[0]["strike"])

        return {
            "callWall": call_wall,
            "putWall": put_wall,
            "majorWalls": {
                "calls": positive[["strike", metric_key]].rename(columns={metric_key: "gex"}).to_dict(orient="records"),
                "puts": negative[["strike", metric_key]].rename(columns={metric_key: "gex"}).to_dict(orient="records"),
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
    def _summarize_levels(agg_strikes: List[Dict[str, Any]], raw_list: List[Dict[str, Any]], spot_price: float = 0.0) -> Dict[str, Any]:
        if not agg_strikes:
            return {
                "gammaFlip": 0.0,
                "callWall": None,
                "putWall": None,
                "sessionCeiling": None,
                "maxPain": 0.0,
                "vannaMagnet": 0.0,
                "majorWalls": None,
                "derived": LevelIntelligenceService._derive_relevant_levels([], [], spot_price),
            }

        flip = LevelIntelligenceService.calculate_gamma_flip(agg_strikes, spot_price)
        walls = LevelIntelligenceService.identify_walls(agg_strikes)
        dex_levels = {
            "flip": LevelIntelligenceService._calculate_flip_for_metric(agg_strikes, "dex", spot_price),
            **LevelIntelligenceService._identify_metric_walls(agg_strikes, "dex"),
        }
        max_pain = LevelIntelligenceService.calculate_max_pain(raw_list)

        df_agg = pd.DataFrame(agg_strikes)
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
        df['sign_change'] = df['sign'].diff().fillna(0)
        crossings = df[df['sign_change'] != 0]

        if crossings.empty:
            return None

        flip_prices = [
            LevelIntelligenceService._interpolate_crossing(df, idx)
            for idx in crossings.index
        ]

        if spot_price > 0:
            return min(flip_prices, key=lambda p: abs(p - spot_price))

        return flip_prices[0]

    @staticmethod
    def identify_walls(agg_strikes: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Identify major GEX walls and secondary levels.
        """
        df = pd.DataFrame(agg_strikes)
        if df.empty or 'gex' not in df.columns or df['gex'].isna().all():
            return {}

        # Use .loc because idxmax/idxmin return labels
        call_wall_strike = df.loc[df['gex'].idxmax(), 'strike']
        call_wall_mag = df.loc[df['gex'].idxmax(), 'gex']
        
        put_wall_strike = df.loc[df['gex'].idxmin(), 'strike']
        put_wall_mag = df.loc[df['gex'].idxmin(), 'gex']

        top_calls = df.sort_values('gex', ascending=False).head(3)
        top_puts = df.sort_values('gex', ascending=True).head(3)

        return {
            "callWall": float(call_wall_strike),
            "callWallMag": float(call_wall_mag),
            "putWall": float(put_wall_strike),
            "putWallMag": float(put_wall_mag),
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
            calls = df[df['type'] == 'call']
            puts = df[df['type'] == 'put']
            
            call_pain = (np.maximum(0, s - calls['strike'].values) * calls['openInterest'].fillna(0).values).sum()
            put_pain = (np.maximum(0, puts['strike'].values - s) * puts['openInterest'].fillna(0).values).sum()
            
            pain_values.append(call_pain + put_pain)

        max_pain_strike = strikes[np.argmin(pain_values)]
        return float(max_pain_strike)

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
            errors="coerce"
        )
        if pd.isna(reference_timestamp):
            reference_date = pd.Timestamp.utcnow().normalize()
        else:
            reference_date = reference_timestamp.normalize()

        df_raw = df_raw.loc[valid_expiry].copy()
        df_raw["dte"] = (df_raw["expiry_dt"] - reference_date).dt.days
        df_raw = df_raw[(df_raw["dte"] >= 0) & (df_raw["dte"] <= 5)]

        by_dte = []
        for dte, dte_df in df_raw.groupby("dte"):
            agg = (
                dte_df.groupby("strike")
                .agg({
                    "gex": "sum",
                    "dex": "sum",
                    "vex": "sum",
                    "chex": "sum",
                    "openInterest": "sum",
                    "volume": "sum",
                    "iv": "mean",
                })
                .reset_index()
            )
            expiry_value = dte_df["expiry"].iloc[0]
            dte_levels = self._summarize_levels(agg.to_dict(orient="records"), dte_df.to_dict(orient="records"), spot_price)
            dte_levels["dte"] = int(dte)
            dte_levels["expiry"] = str(expiry_value)
            by_dte.append(dte_levels)

        levels["byDte"] = sorted(by_dte, key=lambda item: item["dte"])
        return levels
