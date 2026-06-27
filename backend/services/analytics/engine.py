import numpy as np
from scipy.stats import norm


class GreeksEngine:
    @staticmethod
    def calculate_basic_greeks(S, K, T, r, sigma, flags, q=0.0):
        """
        Calculate standard Black-Scholes Greeks analytically (Merton continuous-dividend model).
        Supports scalar or array-like inputs and call/put flags ('c'/'p').
        Returns Greeks plus intermediate values (d1, d2, sqrt_t, pdf_d1) so
        the caller can pass them to calculate_higher_order_greeks without recomputing.
        """
        S = np.asarray(S, dtype=float)
        K = np.asarray(K, dtype=float)
        T = np.asarray(T, dtype=float)
        sigma = np.asarray(sigma, dtype=float)
        q = np.asarray(q, dtype=float)
        flags = np.asarray(flags)

        T = np.maximum(T, 1e-8)
        sigma = np.maximum(sigma, 1e-8)
        sqrt_t = np.sqrt(T)
        exp_qt = np.exp(-q * T)

        d1 = (np.log(S / K) + (r - q + 0.5 * sigma**2) * T) / (sigma * sqrt_t)
        d2 = d1 - sigma * sqrt_t
        pdf_d1 = norm.pdf(d1)

        is_call = flags == 'c'
        delta = np.where(is_call, exp_qt * norm.cdf(d1), exp_qt * (norm.cdf(d1) - 1.0))
        gamma = exp_qt * pdf_d1 / (S * sigma * sqrt_t)
        vega = S * exp_qt * pdf_d1 * sqrt_t
        theta_call = (
            -(S * exp_qt * pdf_d1 * sigma) / (2.0 * sqrt_t)
            - r * K * np.exp(-r * T) * norm.cdf(d2)
            + q * S * exp_qt * norm.cdf(d1)
        )
        theta_put = (
            -(S * exp_qt * pdf_d1 * sigma) / (2.0 * sqrt_t)
            + r * K * np.exp(-r * T) * norm.cdf(-d2)
            - q * S * exp_qt * norm.cdf(-d1)
        )
        theta = np.where(is_call, theta_call, theta_put)

        return {
            "delta": delta,
            "gamma": gamma,
            "vega": vega,
            "theta": theta,
            "_d1": d1,
            "_d2": d2,
            "_sqrt_t": sqrt_t,
            "_pdf_d1": pdf_d1,
            "_exp_qt": exp_qt,
        }

    @staticmethod
    def calculate_higher_order_greeks(S, K, T, r, q, sigma, flags=None, _precomputed=None):
        """
        Calculate higher-order Greeks (Vanna, Charm, Vomma, Speed, Zomma) analytically.
        Pass _precomputed=basic_greeks_result to reuse d1/d2/sqrt_t/pdf_d1
        already computed by calculate_basic_greeks (avoids ~30% duplicate work).
        """
        T = np.maximum(T, 1e-8)
        sigma = np.maximum(sigma, 1e-8)
        flags = np.asarray(flags) if flags is not None else None

        if _precomputed is not None:
            d1     = _precomputed["_d1"]
            d2     = _precomputed["_d2"]
            sqrt_t = _precomputed["_sqrt_t"]
            pdf_d1 = _precomputed["_pdf_d1"]
            exp_qt = _precomputed["_exp_qt"]
        else:
            sqrt_t = np.sqrt(T)
            exp_qt = np.exp(-q * T)
            d1 = (np.log(S / K) + (r - q + 0.5 * sigma**2) * T) / (sigma * sqrt_t)
            d2 = d1 - sigma * sqrt_t
            pdf_d1 = norm.pdf(d1)

        vanna      = -exp_qt * pdf_d1 * d2 / sigma
        charm_common = exp_qt * pdf_d1 * (d2 / (2 * T) - (r - q) / (sigma * sqrt_t))
        if flags is None:
            charm = charm_common
        else:
            is_call = flags == 'c'
            charm_call = q * exp_qt * norm.cdf(d1) + charm_common
            charm_put = -q * exp_qt * norm.cdf(-d1) + charm_common
            charm = np.where(is_call, charm_call, charm_put)
        vega       = S * exp_qt * pdf_d1 * sqrt_t
        vomma      = vega * d1 * d2 / sigma

        # Gamma (with dividend adjustment) — needed for Speed and Zomma
        gamma = exp_qt * pdf_d1 / (S * sigma * sqrt_t)

        # Speed: dΓ/dS — rate at which gamma changes as spot moves
        # Negative at ATM (gamma decreasing away from peak), changes sign OTM/ITM
        speed = -(gamma / S) * (d1 / (sigma * sqrt_t) + 1)

        # Zomma: dΓ/dσ — how gamma changes with vol; high zomma strikes activate on vol spikes
        zomma = gamma * (d1 * d2 - 1) / sigma

        return {
            "vanna": vanna,
            "charm": charm,
            "vomma": vomma,
            "speed": speed,
            "zomma": zomma,
            "vega_analytical": vega,
            "d1": d1,
            "d2": d2,
        }

if __name__ == "__main__":
    # Test case
    S = np.array([450.0])
    K = np.array([450.0])
    T = np.array([1/365]) # 0DTE
    r = np.array([0.045])
    q = np.array([0.015])
    sigma = np.array([0.15])
    
    engine = GreeksEngine()
    basic = engine.calculate_basic_greeks(S, K, T, r, sigma, "c")
    higher = engine.calculate_higher_order_greeks(S, K, T, r, q, sigma, "c")
    
    print(f"Delta: {basic['delta']}")
    print(f"Vanna: {higher['vanna']}")
    print(f"Charm: {higher['charm']}")
