from __future__ import annotations

import logging
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

import httpx

logger = logging.getLogger("macro_events")


class MacroEventsService:
    BLS_URL = "https://api.bls.gov/publicAPI/v1/timeseries/data/"
    FED_CALENDAR_TEMPLATE = "https://www.federalreserve.gov/newsevents/{year}-{month}.htm"
    CACHE_TTL = timedelta(hours=6)

    CPI_SERIES_ID = "CUUR0000SA0"
    PPI_SERIES_ID = "WPUFD4"
    UNEMPLOYMENT_SERIES_ID = "LNS14000000"

    def __init__(self) -> None:
        project_root = Path(__file__).resolve().parents[2]
        self.cache_dir = project_root / "data" / "macro_events"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_path = self.cache_dir / "latest.json"
        self._cache: Dict[str, Any] = self._load_cache()

    async def get_events(self) -> List[Dict[str, Any]]:
        now = datetime.now(timezone.utc)
        cached_at = self._cache["timestamp"]
        if cached_at and now - cached_at < self.CACHE_TTL:
            return self._cache["events"]

        try:
            events = await self._fetch_events()
            self._cache = {"timestamp": now, "events": events}
            self._save_cache()
            return events
        except Exception as exc:
            logger.warning("Falling back to cached macro events after fetch failure: %s", exc)
            if self._cache["events"]:
                return self._cache["events"]
            raise

    async def _fetch_events(self) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "GexLab/2.0"}) as client:
            bls_events = await self._fetch_bls_events(client)
            fed_events = await self._fetch_fed_events(client)

        merged = sorted(bls_events + fed_events, key=lambda event: event["date"])
        return merged[:20]

    async def _fetch_bls_events(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        current_year = datetime.now(timezone.utc).year
        payload = {"seriesid": [self.CPI_SERIES_ID, self.PPI_SERIES_ID, self.UNEMPLOYMENT_SERIES_ID], "startyear": str(current_year), "endyear": str(current_year)}
        response = await client.post(self.BLS_URL, json=payload)
        response.raise_for_status()
        body = response.json()

        series_map = {
            self.CPI_SERIES_ID: ("CPI", "Latest CPI release from BLS public API.", "high", "08:30 ET"),
            self.PPI_SERIES_ID: ("PPI", "Latest PPI release from BLS public API.", "medium", "08:30 ET"),
            self.UNEMPLOYMENT_SERIES_ID: ("Unemployment", "Latest unemployment rate release from BLS public API.", "high", "08:30 ET"),
        }

        events: List[Dict[str, Any]] = []
        for series in body.get("Results", {}).get("series", []):
            series_id = series.get("seriesID")
            label_info = series_map.get(series_id)
            if not label_info:
                continue

            latest = next(
                (
                    item
                    for item in series.get("data", [])
                    if item.get("periodName")
                    and item.get("year")
                    and item.get("period", "").startswith("M")
                ),
                None,
            )
            if not latest:
                continue

            event_date = self._estimate_bls_release_date(int(latest["year"]), latest["periodName"])
            if not event_date:
                continue

            previous = next(
                (
                    item
                    for item in series.get("data", [])[1:]
                    if item.get("periodName")
                    and item.get("year")
                    and item.get("period", "").startswith("M")
                ),
                None,
            )

            label, note, impact, release_time = label_info
            events.append(
                {
                    "date": event_date.isoformat(),
                    "label": label,
                    "source": "BLS",
                    "category": "macro",
                    "impact": impact,
                    "note": note,
                    "releaseTimeEt": release_time,
                    "expected": None,
                    "actual": latest.get("value"),
                    "previous": previous.get("value") if previous else None,
                }
            )

        return events

    async def _fetch_fed_events(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        today = date.today()
        month_paths = {(today.year, today.strftime("%B").lower())}
        next_month = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
        month_paths.add((next_month.year, next_month.strftime("%B").lower()))

        events: List[Dict[str, Any]] = []
        seen: set[str] = set()

        for year, month_name in month_paths:
            url = self.FED_CALENDAR_TEMPLATE.format(year=year, month=month_name)
            try:
                response = await client.get(url)
                response.raise_for_status()
            except Exception as exc:
                logger.warning("Unable to fetch Fed calendar page %s: %s", url, exc)
                continue

            html = response.text
            for start, end in re.findall(r"FOMC Meeting.*?([A-Z][a-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2})", html):
                key = f"{year}-{month_name}-{start}-{end}"
                if key in seen:
                    continue
                seen.add(key)
                try:
                    month_index = datetime.strptime(start, "%B").month
                except ValueError:
                    try:
                        month_index = datetime.strptime(month_name, "%B").month
                    except ValueError:
                        continue

                meeting_date = date(year, month_index, int(end))
                events.append(
                    {
                        "date": meeting_date.isoformat(),
                        "label": "FOMC Meeting",
                        "source": "Federal Reserve",
                        "category": "macro",
                        "impact": "high",
                        "note": "Official Federal Reserve calendar meeting window.",
                        "releaseTimeEt": "14:00 ET",
                        "expected": None,
                        "actual": None,
                        "previous": None,
                    }
                )

        return events

    @staticmethod
    def _estimate_bls_release_date(year: int, period_name: str) -> date | None:
        try:
            month = datetime.strptime(period_name, "%B").month
        except ValueError:
            return None

        next_month = month + 1
        next_year = year
        if next_month == 13:
            next_month = 1
            next_year += 1

        return date(next_year, next_month, 15)

    def _load_cache(self) -> Dict[str, Any]:
        if not self.cache_path.exists():
            return {"timestamp": None, "events": []}
        try:
            payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
            timestamp_value = payload.get("timestamp")
            timestamp = datetime.fromisoformat(timestamp_value) if timestamp_value else None
            if timestamp and timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            return {"timestamp": timestamp, "events": payload.get("events", [])}
        except Exception as exc:
            logger.warning("Unable to read macro event cache: %s", exc)
            return {"timestamp": None, "events": []}

    def _save_cache(self) -> None:
        payload = {
            "timestamp": self._cache["timestamp"].isoformat() if self._cache["timestamp"] else None,
            "events": self._cache["events"],
        }
        self.cache_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
