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

    def test_gex_endpoint_maps_rate_limit_to_429(self):
        with patch('main._build_gex_response', side_effect=RateLimitError('Too many upstream requests')):
            response = self.client.get('/api/gex/SPY')

        self.assertEqual(response.status_code, 429)
        payload = response.json()
        self.assertEqual(payload['error'], 'rate_limited')
        self.assertIn('retry_after_seconds', payload)


if __name__ == '__main__':
    unittest.main()
