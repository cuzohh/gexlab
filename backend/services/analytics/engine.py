import numpy as np
from scipy.stats import norm


class GreeksEngine:
    @staticmethod
    def calculate_basic_greeks(S, K, T, r, sigma, flags):
        """
        Calculate standard Black-Scholes Greeks analytically.
        Supports scalar or array-like inputs and call/put flags ('c'/'p').
        """
        S = np.asarray(S, dtype=float)
        K = np.asarray(K, dtype=float)
        T = np.asarray(T, dtype=float)
        sigma = np.asarray(sigma, dtype=float)
        flags = np.asarray(flags)

        # Guardrails for near-expiry and bad IV inputs.
        T = np.maximum(T, 1e-8)
        sigma = np.maximum(sigma, 1e-8)
        sqrt_t = np.sqrt(T)

        d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * sqrt_t)
        d2 = d1 - sigma * sqrt_t
        pdf_d1 = norm.pdf(d1)

        is_call = flags == 'c'
        delta = np.where(is_call, norm.cdf(d1), norm.cdf(d1) - 1.0)
        gamma = pdf_d1 / (S * sigma * sqrt_t)
        vega = S * pdf_d1 * sqrt_t
        theta_call = (
            -(S * pdf_d1 * sigma) / (2.0 * sqrt_t)
            - r * K * np.exp(-r * T) * norm.cdf(d2)
        )
        theta_put = (
            -(S * pdf_d1 * sigma) / (2.0 * sqrt_t)
            + r * K * np.exp(-r * T) * norm.cdf(-d2)
        )
        theta = np.where(is_call, theta_call, theta_put)

        return {
            "delta": delta,
            "gamma": gamma,
            "vega": vega,
            "theta": theta,
        }

    @staticmethod
    def calculate_higher_order_greeks(S, K, T, r, q, sigma):
        """
        Calculate higher-order Greeks (Vanna, Charm, Vomma) analytically.
        Inputs are numpy arrays.
        """
        T = np.maximum(T, 1e-8)
        sigma = np.maximum(sigma, 1e-8)
        
        # Calculate d1 and d2
        d1 = (np.log(S / K) + (r - q + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
        d2 = d1 - sigma * np.sqrt(T)
        
        # Probate density function N'(d1)
        pdf_d1 = norm.pdf(d1)
        
        # Vanna = dDelta / dVol
        # Vanna = -exp(-qT) * N'(d1) * d2 / sigma
        vanna = -np.exp(-q * T) * pdf_d1 * d2 / sigma
        
        # Charm = dDelta / dT
        # This is a simplified version, usually depends on Call/Put flag
        # For simplicity, we calculate the common core
        charm_core = (pdf_d1 * (d2 / (2 * T) - (r - q) / (sigma * np.sqrt(T))))
        
        # Vomma (Volga) = dVega / dVol
        # Vomma = Vega * d1 * d2 / sigma
        # Using analytical Vega = S * exp(-qT) * N'(d1) * sqrt(T)
        vega = S * np.exp(-q * T) * pdf_d1 * np.sqrt(T)
        vomma = vega * d1 * d2 / sigma
        
        return {
            "vanna": vanna,
            "charm": charm_core,
            "vomma": vomma,
            "vega_analytical": vega,
            "d1": d1,
            "d2": d2
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
    higher = engine.calculate_higher_order_greeks(S, K, T, r, q, sigma)
    
    print(f"Delta: {basic['delta']}")
    print(f"Vanna: {higher['vanna']}")
    print(f"Charm: {higher['charm']}")
