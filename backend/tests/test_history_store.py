import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.history_store import build_history_sample


class HistoryStoreTests(unittest.TestCase):
    def test_build_history_sample_summarises_payload(self):
        payload = {
            'spot': 500.0,
            'net_gex': 1.25,
            'net_dex': 0.5,
            'gex_by_strike': [
                {'total_volume': 1000, 'total_oi': 2000, 'avg_iv': 20.0},
                {'total_volume': 500, 'total_oi': 1000, 'avg_iv': 30.0},
            ],
            'key_levels': {
                'call_wall': 505.0,
                'call_wall_gex': 2.0,
                'put_wall': 495.0,
                'put_wall_gex': -1.5,
                'zero_gamma': 498.0,
                'max_pain': 500.0,
                'vol_trigger': 502.0,
            },
            'meta': {'generated_at': '2026-03-22T14:31:00+00:00'},
        }

        sample = build_history_sample('spy', payload)

        self.assertEqual(sample['symbol'], 'SPY')
        self.assertEqual(sample['timestamp'], '2026-03-22T14:31:00+00:00')
        self.assertEqual(sample['total_volume'], 1500)
        self.assertEqual(sample['total_oi'], 3000)
        self.assertEqual(sample['avg_iv'], 25.0)
        self.assertAlmostEqual(sample['wall_range_pct'], 2.0)
        self.assertAlmostEqual(sample['zero_gamma_distance_pct'], -0.4)


if __name__ == '__main__':
    unittest.main()
