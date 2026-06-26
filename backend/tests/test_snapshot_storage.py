import unittest
from pathlib import Path
import shutil
import pandas as pd

from services.storage import SnapshotStorageService


class SnapshotStorageTests(unittest.TestCase):
    def test_save_list_and_load_snapshot(self) -> None:
        tmp_dir = Path(__file__).resolve().parent / "_tmp_snapshots"
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir)

        try:
            service = SnapshotStorageService(base_dir=tmp_dir)
            service.save_snapshot(
                ticker="SPY",
                raw_data={
                    "timestamp": "2026-04-12T16:00:00",
                    "data": [
                        {
                            "strike": 500.0,
                            "lastTradeDate": pd.Timestamp("2026-04-12T15:59:59"),
                        }
                    ],
                },
                basis_data={"basis": 12.5, "future_price": 5123.0, "etf_price": 511.0},
                analytics_data={"summary": {"spotPrice": 511.0}, "strikes": [], "surface": {"expiries": [], "strikes": [], "matrix": []}, "raw": []},
                snapshot_date="2026-04-12",
            )

            dates = service.list_snapshot_dates("SPY")
            self.assertEqual(dates, ["2026-04-12"])

            loaded = service.load_snapshot("SPY", "2026-04-12")
            assert loaded is not None
            self.assertEqual(loaded["ticker"], "SPY")
            self.assertEqual(loaded["date"], "2026-04-12")
            self.assertIn("analytics", loaded)
            self.assertEqual(loaded["raw"]["data"][0]["lastTradeDate"], "2026-04-12T15:59:59")
        finally:
            if tmp_dir.exists():
                shutil.rmtree(tmp_dir)


if __name__ == "__main__":
    unittest.main()
