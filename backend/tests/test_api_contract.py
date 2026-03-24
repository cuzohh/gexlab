import pathlib
import sys
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.errors import RateLimitError
from main import app


class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_endpoint_returns_ok(self):
        response = self.client.get('/api/health')

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(payload['service'], 'gexlab-backend')

    def test_gex_endpoint_surfaces_contract_fields(self):
        fake_payload = {
            'spot': 500.12,
            'regime': 'LONG_GAMMA',
            'net_gex': 1.25,
            'net_dex': 0.5,
            'key_levels': {'call_wall': 505.0, 'call_wall_gex': 1.0, 'put_wall': 495.0, 'put_wall_gex': -0.8, 'zero_gamma': 500.0, 'max_pain': 500.0, 'vol_trigger': 502.5},
            'expirations': ['2026-03-27'],
            'gex_by_strike': [],
            'heatmap_data': [],
            'futures': None,
            'dex_by_strike': [],
            'gex_by_expiration': [],
            'iv_skew': [],
            'pc_ratio': [],
            'vanna_by_strike': [],
            'meta': {'source': 'yahooquery', 'generated_at': '2026-03-22T00:00:00+00:00', 'cache_hit': False, 'cache_age_seconds': 0.0},
        }

        with patch('main._build_gex_response', return_value=fake_payload):
            response = self.client.get('/api/gex/SPY?max_expirations=3')

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['spot'], fake_payload['spot'])
        self.assertIn('meta', payload)
        self.assertIn('key_levels', payload)
        self.assertIn('gex_by_strike', payload)

    def test_gex_endpoint_can_track_history(self):
        fake_payload = {
            'spot': 500.12,
            'regime': 'LONG_GAMMA',
            'net_gex': 1.25,
            'net_dex': 0.5,
            'key_levels': {'call_wall': 505.0, 'call_wall_gex': 1.0, 'put_wall': 495.0, 'put_wall_gex': -0.8, 'zero_gamma': 500.0, 'max_pain': 500.0, 'vol_trigger': 502.5},
            'expirations': ['2026-03-27'],
            'gex_by_strike': [],
            'heatmap_data': [],
            'futures': None,
            'dex_by_strike': [],
            'gex_by_expiration': [],
            'iv_skew': [],
            'pc_ratio': [],
            'vanna_by_strike': [],
            'meta': {'source': 'yahooquery', 'generated_at': '2026-03-22T00:00:00+00:00', 'cache_hit': False, 'cache_age_seconds': 0.0},
        }

        with patch('main._build_gex_response', return_value=fake_payload), patch('main.append_history_sample') as append_history:
            response = self.client.get('/api/gex/SPY?track_history=true&fresh=true')

        self.assertEqual(response.status_code, 200)
        append_history.assert_called_once_with('SPY', fake_payload)

    def test_gex_endpoint_maps_rate_limit_to_429(self):
        with patch('main._build_gex_response', side_effect=RateLimitError('Too many upstream requests')):
            response = self.client.get('/api/gex/SPY')

        self.assertEqual(response.status_code, 429)
        payload = response.json()
        self.assertEqual(payload['error'], 'rate_limited')
        self.assertIn('retry_after_seconds', payload)

    def test_gex_history_endpoint_returns_samples(self):
        fake_samples = [
            {'timestamp': '2026-03-22T14:30:00+00:00', 'spot': 500.0, 'net_gex': 1.1},
            {'timestamp': '2026-03-22T14:31:00+00:00', 'spot': 500.5, 'net_gex': 1.2},
        ]

        with patch('main.load_history', return_value=fake_samples):
            response = self.client.get('/api/gex/SPY/history?limit=100')

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['symbol'], 'SPY')
        self.assertEqual(payload['count'], 2)
        self.assertEqual(payload['samples'], fake_samples)


if __name__ == '__main__':
    unittest.main()
