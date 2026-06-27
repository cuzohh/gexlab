import unittest

from services.analytics.levels import LevelIntelligenceService
from services.analytics.service import GexAnalyticsService


class StubAnalyticsService(GexAnalyticsService):
    def get_risk_free_rate(self) -> float:
        return 0.045


class AnalyticsPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = StubAnalyticsService()
        self.levels = LevelIntelligenceService()
        self.raw_data = {
            "symbol": "SPY",
            "spotPrice": 500.0,
            "timestamp": "2026-04-12T10:00:00",
            "data": [
                {
                    "expiry": "2026-04-13",
                    "type": "call",
                    "strike": 490.0,
                    "openInterest": 1500,
                    "volume": 220,
                    "impliedVolatility": 0.18,
                },
                {
                    "expiry": "2026-04-13",
                    "type": "put",
                    "strike": 490.0,
                    "openInterest": 900,
                    "volume": 180,
                    "impliedVolatility": 0.19,
                },
                {
                    "expiry": "2026-04-14",
                    "type": "call",
                    "strike": 500.0,
                    "openInterest": 2000,
                    "volume": 320,
                    "impliedVolatility": 0.16,
                },
                {
                    "expiry": "2026-04-14",
                    "type": "put",
                    "strike": 500.0,
                    "openInterest": 2500,
                    "volume": 340,
                    "impliedVolatility": 0.17,
                },
                {
                    "expiry": "2026-04-15",
                    "type": "call",
                    "strike": 510.0,
                    "openInterest": 1100,
                    "volume": 140,
                    "impliedVolatility": 0.15,
                },
                {
                    "expiry": "2026-04-15",
                    "type": "put",
                    "strike": 510.0,
                    "openInterest": 2800,
                    "volume": 360,
                    "impliedVolatility": 0.21,
                },
            ],
        }

    def test_process_chain_returns_expected_sections(self) -> None:
        analytics = self.service.process_chain(self.raw_data)

        self.assertIn("summary", analytics)
        self.assertIn("strikes", analytics)
        self.assertIn("surface", analytics)
        self.assertIn("raw", analytics)
        self.assertEqual(len(analytics["strikes"]), 3)
        self.assertEqual(len(analytics["raw"]), 6)
        self.assertEqual(analytics["summary"]["spotPrice"], 500.0)
        self.assertAlmostEqual(analytics["summary"]["riskFreeRate"], 0.045)

        first_row = analytics["raw"][0]
        for key in (
            "delta", "gamma", "vega", "theta",
            "vanna", "charm", "speed", "zomma", "vomma", "lambda",
            "gex", "dex", "lex", "vex", "chex", "spex", "zomex", "vomex", "iv",
        ):
            self.assertIn(key, first_row)

    def test_market_levels_can_be_derived_from_analytics(self) -> None:
        analytics = self.service.process_chain(self.raw_data)
        levels = self.levels.get_market_levels(analytics, self.raw_data)

        self.assertIn("gammaFlip", levels)
        self.assertIn("callWall", levels)
        self.assertIn("putWall", levels)
        self.assertIn("dex", levels)
        self.assertIn("lambda", levels)
        self.assertIn("maxPain", levels)
        self.assertIn("vannaMagnet", levels)
        self.assertIn("derived", levels)
        self.assertIn("byDte", levels)
        self.assertTrue(levels["gammaFlip"] is None or isinstance(levels["gammaFlip"], float))
        self.assertGreater(levels["maxPain"], 0.0)
        self.assertIn("flip", levels["dex"])
        self.assertIn("callWall", levels["dex"])
        self.assertIn("putWall", levels["dex"])
        self.assertIn("bands", levels["lambda"])
        self.assertIn("up1", levels["lambda"]["bands"])
        self.assertIn("oiCallWall", levels["derived"])
        self.assertIn("sessionFloor", levels["derived"])
        self.assertEqual(len(levels["byDte"]), 3)
        self.assertEqual(levels["byDte"][0]["dte"], 1)
        self.assertIn("callWall", levels["byDte"][0])
        self.assertIn("dex", levels["byDte"][0])
        self.assertIn("derived", levels["byDte"][0])

    def test_gamma_walls_are_directional_around_spot(self) -> None:
        walls = self.levels.identify_walls(
            [
                {"strike": 480.0, "gex": 5000.0},
                {"strike": 490.0, "gex": -8000.0},
                {"strike": 510.0, "gex": 1200.0},
                {"strike": 520.0, "gex": -9000.0},
            ],
            spot_price=500.0,
        )

        self.assertEqual(walls["callWall"], 510.0)
        self.assertEqual(walls["putWall"], 490.0)

    def test_greek_walls_are_directional_around_spot(self) -> None:
        walls = self.levels._identify_metric_walls(
            [
                {"strike": 480.0, "vex": 10000.0},
                {"strike": 490.0, "vex": -9000.0},
                {"strike": 510.0, "vex": 1200.0},
                {"strike": 520.0, "vex": -2000.0},
            ],
            "vex",
            spot_price=500.0,
        )

        self.assertEqual(walls["callWall"], 520.0)
        self.assertEqual(walls["putWall"], 480.0)


if __name__ == "__main__":
    unittest.main()
