from __future__ import annotations

from datetime import date, datetime
import json
import os
from pathlib import Path
from typing import Any


def _history_dir() -> Path:
    explicit_dir = os.getenv("GEXLAB_HISTORY_DIR")
    if explicit_dir:
        root = Path(explicit_dir)
    else:
        local_app_data = os.getenv("LOCALAPPDATA")
        if local_app_data:
            root = Path(local_app_data) / "GEXLAB" / "history"
        else:
            root = Path(__file__).resolve().parents[1] / "data" / "history"

    root.mkdir(parents=True, exist_ok=True)
    return root


def _history_file_path(symbol: str, session_date: date | None = None) -> Path:
    trading_day = session_date or datetime.now().astimezone().date()
    safe_symbol = "".join(ch for ch in symbol.upper() if ch.isalnum() or ch in {"-", "_"})
    return _history_dir() / f"{safe_symbol}-{trading_day.isoformat()}.jsonl"


def _safe_ratio(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return 0.0
    return numerator / denominator


def build_history_sample(symbol: str, payload: dict[str, Any]) -> dict[str, Any]:
    gex_rows = payload.get("gex_by_strike", [])
    total_volume = int(sum(int(row.get("total_volume", 0)) for row in gex_rows))
    total_oi = int(sum(int(row.get("total_oi", 0)) for row in gex_rows))
    avg_iv = round(
        sum(float(row.get("avg_iv", 0.0)) for row in gex_rows) / len(gex_rows),
        2,
    ) if gex_rows else 0.0

    spot = float(payload.get("spot", 0.0))
    key_levels = payload.get("key_levels", {})
    call_wall = key_levels.get("call_wall")
    put_wall = key_levels.get("put_wall")
    zero_gamma = key_levels.get("zero_gamma")
    max_pain = key_levels.get("max_pain")
    vol_trigger = key_levels.get("vol_trigger")
    call_wall_gex = float(key_levels.get("call_wall_gex", 0.0))
    put_wall_gex = float(key_levels.get("put_wall_gex", 0.0))
    net_gex = float(payload.get("net_gex", 0.0))
    net_dex = float(payload.get("net_dex", 0.0))

    wall_range_pct = 0.0
    if isinstance(call_wall, (int, float)) and isinstance(put_wall, (int, float)) and spot > 0:
        wall_range_pct = round(((float(call_wall) - float(put_wall)) / spot) * 100, 4)

    zero_gamma_distance_pct = 0.0
    if isinstance(zero_gamma, (int, float)) and spot > 0:
        zero_gamma_distance_pct = round(((float(zero_gamma) - spot) / spot) * 100, 4)

    dominant_wall_gex = max(abs(call_wall_gex), abs(put_wall_gex), 1e-9)

    return {
        "symbol": symbol.upper(),
        "timestamp": payload.get("meta", {}).get("generated_at") or datetime.now().astimezone().isoformat(),
        "spot": round(spot, 4),
        "call_wall": round(float(call_wall), 4) if isinstance(call_wall, (int, float)) else None,
        "put_wall": round(float(put_wall), 4) if isinstance(put_wall, (int, float)) else None,
        "zero_gamma": round(float(zero_gamma), 4) if isinstance(zero_gamma, (int, float)) else None,
        "max_pain": round(float(max_pain), 4) if isinstance(max_pain, (int, float)) else None,
        "vol_trigger": round(float(vol_trigger), 4) if isinstance(vol_trigger, (int, float)) else None,
        "net_gex": round(net_gex, 6),
        "net_dex": round(net_dex, 6),
        "total_volume": total_volume,
        "total_oi": total_oi,
        "avg_iv": avg_iv,
        "wall_range_pct": wall_range_pct,
        "zero_gamma_distance_pct": zero_gamma_distance_pct,
        "volume_oi_ratio": round(_safe_ratio(total_volume, total_oi), 6),
        "dex_to_gex_ratio": round(_safe_ratio(net_dex, dominant_wall_gex), 6),
    }


def append_history_sample(symbol: str, payload: dict[str, Any]) -> dict[str, Any]:
    sample = build_history_sample(symbol, payload)
    path = _history_file_path(symbol)

    if path.exists():
        last_line = ""
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    last_line = line
        if last_line:
            try:
                last_sample = json.loads(last_line)
                if last_sample.get("timestamp") == sample["timestamp"]:
                    return last_sample
            except json.JSONDecodeError:
                pass

    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(sample, separators=(",", ":")))
        handle.write("\n")

    return sample


def load_history(symbol: str, limit: int = 390, session_date: date | None = None) -> list[dict[str, Any]]:
    path = _history_file_path(symbol, session_date=session_date)
    if not path.exists():
        return []

    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if limit > 0:
        return rows[-limit:]
    return rows
