import httpx
import logging

logger = logging.getLogger(__name__)

class ThetaClient:
    def __init__(self, base_url: str = "http://127.0.0.1:25510/v2/"):
        self.base_url = base_url
    
    async def check_connection(self) -> bool:
        """
        Hit a lightweight endpoint on the local ThetaTerminal to verify it's running.
        Using /v2/hist/stock/quote or /v2/hist/stock/price as a health check.
        """
        async with httpx.AsyncClient() as client:
            try:
                # We expect a 'missing params' or similar JSON response if alive, 
                # but a ConnectionError if the terminal is fully down.
                response = await client.get(
                    f"{self.base_url}hist/stock/quote?root=SPY&start_date=20230101&end_date=20230101",
                    timeout=2.0
                )
                # Even if it returns 400 or 403, it means the terminal server is listening.
                # If it's listening, it's connected.
                return True
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                logger.warning(f"Failed to connect to ThetaTerminal: {e}")
                return False
