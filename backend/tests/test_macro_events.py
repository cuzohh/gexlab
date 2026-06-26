import unittest
from pathlib import Path

from services.macro_events import MacroEventsService


class MacroEventsServiceTests(unittest.TestCase):
    def test_estimate_bls_release_date_uses_following_month(self) -> None:
        estimated = MacroEventsService._estimate_bls_release_date(2026, "March")
        self.assertEqual(estimated.isoformat(), "2026-04-15")

    def test_load_cache_reads_saved_events(self) -> None:
        cache_dir = Path(__file__).resolve().parent / "_tmp_macro_cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = cache_dir / "latest.json"

        try:
            service = MacroEventsService()
            service.cache_dir = cache_dir
            service.cache_path = cache_path
            service.cache_path.write_text(
                '{"timestamp":"2026-04-12T12:00:00+00:00","events":[{"date":"2026-04-15","label":"CPI","source":"BLS","category":"macro","impact":"high","note":"Test"}]}',
                encoding="utf-8",
            )

            cache = service._load_cache()
            self.assertEqual(cache["events"][0]["impact"], "high")
        finally:
            if cache_path.exists():
                cache_path.unlink()
            if cache_dir.exists():
                cache_dir.rmdir()


if __name__ == "__main__":
    unittest.main()
