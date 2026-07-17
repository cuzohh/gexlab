export type MarketEventType = 'macro' | 'earnings' | 'opex' | 'expiry' | 'positioning';

export interface CustomMarketEvent {
  date: string;
  label: string;
  type: MarketEventType;
  ticker?: 'SPY' | 'QQQ' | 'ALL';
}

// Add CPI / FOMC / earnings events here when you want them surfaced in the app.
export const CUSTOM_MARKET_EVENTS: CustomMarketEvent[] = [];
