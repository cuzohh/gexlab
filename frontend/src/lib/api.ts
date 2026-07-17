import type {
  AnalyticsResponse,
  BridgePayloadResponse,
  HealthResponse,
  HistoricalSnapshotResponse,
  MacroEventsResponse,
  RawMetricsResponse,
  SnapshotDatesResponse,
} from '../types/analytics';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallback = `Request failed with status ${response.status}`;
    let message = fallback;
    try {
      const body = (await response.json()) as { detail?: string; error?: string };
      message = body.detail ?? body.error ?? fallback;
    } catch {
      message = fallback;
    }
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/health`, { cache: 'no-store' });
  return parseJson<HealthResponse>(response);
}

export async function fetchAnalytics(ticker: 'SPY' | 'QQQ'): Promise<AnalyticsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/metrics/analytics/${ticker}`, { cache: 'no-store' });
  return parseJson<AnalyticsResponse>(response);
}

export async function fetchBridgePayload(ticker: 'SPY' | 'QQQ'): Promise<BridgePayloadResponse> {
  const response = await fetch(`${API_BASE_URL}/api/metrics/bridge/${ticker}`, { cache: 'no-store' });
  return parseJson<BridgePayloadResponse>(response);
}

export interface CombinedBridgeResponse {
  spy: string;
  qqq: string;
  spy_greeks: string;
  qqq_greeks: string;
  es: string;
  nq: string;
  mnq: string;
  pine: string;
  timestamp: string | null;
}

export async function fetchCombinedBridge(): Promise<CombinedBridgeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/metrics/bridge`, { cache: 'no-store' });
  return parseJson<CombinedBridgeResponse>(response);
}

export async function fetchRawMetrics(): Promise<RawMetricsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/metrics/raw`, { cache: 'no-store' });
  return parseJson<RawMetricsResponse>(response);
}

export async function fetchBasisMetrics(): Promise<Pick<RawMetricsResponse, 'basis'>> {
  const response = await fetch(`${API_BASE_URL}/api/metrics/basis`, { cache: 'no-store' });
  return parseJson<Pick<RawMetricsResponse, 'basis'>>(response);
}

export async function fetchSnapshotDates(ticker: 'SPY' | 'QQQ'): Promise<SnapshotDatesResponse> {
  const response = await fetch(`${API_BASE_URL}/api/history/${ticker}/dates`, { cache: 'no-store' });
  return parseJson<SnapshotDatesResponse>(response);
}

export async function fetchHistoricalSnapshot(ticker: 'SPY' | 'QQQ', snapshotDate: string): Promise<HistoricalSnapshotResponse> {
  const response = await fetch(`${API_BASE_URL}/api/history/${ticker}/${snapshotDate}`, { cache: 'no-store' });
  return parseJson<HistoricalSnapshotResponse>(response);
}

export async function fetchMacroEvents(): Promise<MacroEventsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/events/macro`, { cache: 'no-store' });
  return parseJson<MacroEventsResponse>(response);
}
