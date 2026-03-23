import math
import pathlib
import sys
import unittest

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from engine.gex_calculator import calculate_gex, calculate_gex_vectorized, compute_max_pain, find_zero_gamma


class GexCalculatorTests(unittest.TestCase):
    def test_vectorized_matches_scalar_formula(self):
        gammas = np.array([0.01, 0.015, 0.02])
        open_interests = np.array([100, 250, 400])
        spot = 500.0

        scalar = np.array([calculate_gex(float(gamma), int(oi), spot) for gamma, oi in zip(gammas, open_interests, strict=True)])
        vectorized = calculate_gex_vectorized(gammas, open_interests, spot)

        np.testing.assert_allclose(vectorized, scalar)

    def test_find_zero_gamma_interpolates_crossing(self):
        strikes = np.array([490.0, 500.0, 510.0])
        cumulative_gex = np.array([2.0, 1.0, -1.0])

        zero_gamma = find_zero_gamma(strikes, cumulative_gex)

        self.assertIsNotNone(zero_gamma)
        self.assertTrue(math.isclose(zero_gamma, 505.0, abs_tol=1e-6))

    def test_compute_max_pain_prefers_balanced_middle_strike(self):
        strikes = np.array([95.0, 100.0, 105.0])
        call_oi = np.array([10, 200, 10])
        put_oi = np.array([10, 200, 10])

        max_pain = compute_max_pain(strikes, call_oi, put_oi)

        self.assertEqual(max_pain, 100.0)


if __name__ == '__main__':
    unittest.main()
