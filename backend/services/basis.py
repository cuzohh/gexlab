import yfinance as yf
import logging
from typing import Dict

logger = logging.getLogger("basis")

class BasisService:
    @staticmethod
    def get_futures_basis(etf_symbol: str = "SPY") -> Dict[str, float]:
        """
        Calculate the live basis between an ETF and its corresponding Future.
        S&P 500 (SPY vs ES=F)
        Nasdaq 100 (QQQ vs NQ=F)
        """
        mapping = {
            "SPY": "ES=F",
            "QQQ": "NQ=F"
        }
        
        future_ticker = mapping.get(etf_symbol)
        if not future_ticker:
            return {"etf_price": 0.0, "future_price": 0.0, "basis": 0.0}

        try:
            # Fetch ETF price
            etf = yf.Ticker(etf_symbol)
            etf_price = etf.fast_info.get('lastPrice') or etf.fast_info.get('last_price') or 0.0
            
            # Fetch Future price
            future = yf.Ticker(future_ticker)
            future_price = future.fast_info.get('lastPrice') or future.fast_info.get('last_price') or 0.0
            
            # Calculation
            # Note: For S&P, ES is usually 10x SPY + Basis. 
            # We return the raw prices and the delta for the user to see the offset.
            basis = future_price - (etf_price * 10) if etf_symbol == "SPY" else future_price - (etf_price * 40)
            # Actually, standard basis calculation is usually Future - ETF*Multiplier.
            # But the user specifically asked for "Future Price - ETF Price * 10" in the context of ES.
            # And NQ is usually 40x QQQ.
            
            return {
                "etf_price": etf_price,
                "future_price": future_price,
                "basis": basis,
                "futures_ticker": future_ticker
            }
        except Exception as e:
            logger.error(f"Error calculating basis for {etf_symbol}: {e}")
            return {"etf_price": 0.0, "future_price": 0.0, "basis": 0.0}

if __name__ == "__main__":
    result = BasisService.get_futures_basis("SPY")
    print(f"SPY Basis: {result}")
