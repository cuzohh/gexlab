import json
import unittest

from services.analytics.bridge import BridgeService


class BridgePayloadTests(unittest.TestCase):
    def test_generate_tv_payload_contains_extended_level_keys(self) -> None:
        analytics = {
            "levels": {
                "gammaFlip": 500.0,
                "callWall": 510.0,
                "putWall": 490.0,
                "sessionCeiling": 512.0,
                "maxPain": 500.0,
                "vannaMagnet": 505.0,
                "majorWalls": {
                    "calls": [
                        {"strike": 510.0, "gex": 100.0},
                        {"strike": 515.0, "gex": 90.0},
                        {"strike": 520.0, "gex": 80.0},
                    ],
                    "puts": [
                        {"strike": 490.0, "gex": -100.0},
                        {"strike": 485.0, "gex": -90.0},
                        {"strike": 480.0, "gex": -80.0},
                    ],
                },
                "dex": {
                    "flip": 501.0,
                    "callWall": 514.0,
                    "putWall": 487.0,
                },
                "byDte": [
                    {
                        "dte": 0,
                        "gammaFlip": 499.0,
                        "callWall": 509.0,
                        "putWall": 491.0,
                        "maxPain": 500.0,
                        "dex": {
                            "flip": 500.0,
                            "callWall": 508.0,
                            "putWall": 492.0,
                        },
                    },
                    {
                        "dte": 1,
                        "gammaFlip": 498.0,
                        "callWall": 512.0,
                        "putWall": 488.0,
                        "maxPain": 501.0,
                        "dex": {
                            "flip": 499.0,
                            "callWall": 511.0,
                            "putWall": 489.0,
                        },
                    },
                ],
                "derived": {
                    "sessionFloor": 488.0,
                    "oiCallWall": 511.0,
                    "oiPutWall": 489.0,
                    "weakCallOIStrike": 518.0,
                    "weakPutOIStrike": 482.0,
                    "protectedGammaHigh": 513.0,
                    "protectedGammaLow": 494.0,
                    "aggressiveCallCeiling": 516.0,
                    "aggressivePutFloor": 484.0,
                    "skewRichStrike": 478.0,
                    "skewCheapStrike": 522.0,
                },
            }
        }

        payload = json.loads(BridgeService.generate_tv_payload(analytics))

        for key in ("f", "cw", "pw", "cw2", "cw3", "pw2", "pw3", "sc", "sf", "mp", "vm", "ocw", "opw", "wcl", "wpl", "pgh", "pgl", "acc", "apf", "skr", "skc", "df", "dcw", "dpw", "d0f", "d0cw", "d0pw", "d0mp", "d0df", "d0dcw", "d0dpw", "d1f", "d1cw", "d1pw", "d1mp", "d1df", "d1dcw", "d1dpw"):
            self.assertIn(key, payload)


if __name__ == "__main__":
    unittest.main()
