import type { AnalyticsResponse, BasisData, LevelsData, RawContract, SurfaceData } from '../types/analytics';

export type PriceMode = 'etf' | 'futures';

const MULTIPLIERS: Record<'SPY' | 'QQQ', number> = {
  SPY: 10,
  QQQ: 40,
};

const FUTURES_TICK_SIZE = 0.25;

function roundToTwoDecimals(value: number) {
  return Math.round(value * 100) / 100;
}

function roundToNearestFuturesTick(value: number) {
  return roundToTwoDecimals(Math.round(value / FUTURES_TICK_SIZE) * FUTURES_TICK_SIZE);
}

export function getMultiplier(ticker: 'SPY' | 'QQQ') {
  return MULTIPLIERS[ticker];
}

export function convertPrice(
  value: number | undefined | null,
  ticker: 'SPY' | 'QQQ',
  basis?: BasisData | null,
  mode: PriceMode = 'etf'
): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (mode === 'etf' || !basis) return roundToTwoDecimals(value);
  return roundToNearestFuturesTick(value * getMultiplier(ticker) + basis.basis);
}

function convertLevels(levels: LevelsData | undefined, ticker: 'SPY' | 'QQQ', basis?: BasisData | null, mode: PriceMode = 'etf'): LevelsData | undefined {
  if (!levels) return levels;

  return {
    ...levels,
    gammaFlip: convertPrice(levels.gammaFlip, ticker, basis, mode),
    callWall: convertPrice(levels.callWall, ticker, basis, mode),
    putWall: convertPrice(levels.putWall, ticker, basis, mode),
    sessionCeiling: convertPrice(levels.sessionCeiling, ticker, basis, mode),
    maxPain: convertPrice(levels.maxPain, ticker, basis, mode),
    vannaMagnet: convertPrice(levels.vannaMagnet, ticker, basis, mode),
    majorWalls: levels.majorWalls
      ? {
          calls: levels.majorWalls.calls.map((wall) => ({ ...wall, strike: convertPrice(wall.strike, ticker, basis, mode) ?? wall.strike })),
          puts: levels.majorWalls.puts.map((wall) => ({ ...wall, strike: convertPrice(wall.strike, ticker, basis, mode) ?? wall.strike })),
        }
      : undefined,
    dex: levels.dex
      ? {
          flip: convertPrice(levels.dex.flip, ticker, basis, mode),
          callWall: convertPrice(levels.dex.callWall, ticker, basis, mode),
          putWall: convertPrice(levels.dex.putWall, ticker, basis, mode),
          majorWalls: levels.dex.majorWalls
            ? {
                calls: levels.dex.majorWalls.calls.map((wall) => ({ ...wall, strike: convertPrice(wall.strike, ticker, basis, mode) ?? wall.strike })),
                puts: levels.dex.majorWalls.puts.map((wall) => ({ ...wall, strike: convertPrice(wall.strike, ticker, basis, mode) ?? wall.strike })),
              }
            : undefined,
        }
      : undefined,
    derived: levels.derived
      ? {
          sessionFloor: convertPrice(levels.derived.sessionFloor, ticker, basis, mode),
          oiCallWall: convertPrice(levels.derived.oiCallWall, ticker, basis, mode),
          oiPutWall: convertPrice(levels.derived.oiPutWall, ticker, basis, mode),
          weakCallOIStrike: convertPrice(levels.derived.weakCallOIStrike, ticker, basis, mode),
          weakPutOIStrike: convertPrice(levels.derived.weakPutOIStrike, ticker, basis, mode),
          protectedGammaHigh: convertPrice(levels.derived.protectedGammaHigh, ticker, basis, mode),
          protectedGammaLow: convertPrice(levels.derived.protectedGammaLow, ticker, basis, mode),
          aggressiveCallCeiling: convertPrice(levels.derived.aggressiveCallCeiling, ticker, basis, mode),
          aggressivePutFloor: convertPrice(levels.derived.aggressivePutFloor, ticker, basis, mode),
          skewRichStrike: convertPrice(levels.derived.skewRichStrike, ticker, basis, mode),
          skewCheapStrike: convertPrice(levels.derived.skewCheapStrike, ticker, basis, mode),
        }
      : undefined,
    byDte: levels.byDte?.map((entry) => ({
      ...entry,
      gammaFlip: convertPrice(entry.gammaFlip, ticker, basis, mode),
      callWall: convertPrice(entry.callWall, ticker, basis, mode),
      putWall: convertPrice(entry.putWall, ticker, basis, mode),
      sessionCeiling: convertPrice(entry.sessionCeiling, ticker, basis, mode),
      maxPain: convertPrice(entry.maxPain, ticker, basis, mode),
      vannaMagnet: convertPrice(entry.vannaMagnet, ticker, basis, mode),
      majorWalls: entry.majorWalls
        ? {
            calls: entry.majorWalls.calls.map((wall) => ({ ...wall, strike: convertPrice(wall.strike, ticker, basis, mode) ?? wall.strike })),
            puts: entry.majorWalls.puts.map((wall) => ({ ...wall, strike: convertPrice(wall.strike, ticker, basis, mode) ?? wall.strike })),
          }
        : undefined,
      dex: entry.dex
        ? {
            flip: convertPrice(entry.dex.flip, ticker, basis, mode),
            callWall: convertPrice(entry.dex.callWall, ticker, basis, mode),
            putWall: convertPrice(entry.dex.putWall, ticker, basis, mode),
            majorWalls: entry.dex.majorWalls
              ? {
                  calls: entry.dex.majorWalls.calls.map((wall) => ({ ...wall, strike: convertPrice(wall.strike, ticker, basis, mode) ?? wall.strike })),
                  puts: entry.dex.majorWalls.puts.map((wall) => ({ ...wall, strike: convertPrice(wall.strike, ticker, basis, mode) ?? wall.strike })),
                }
              : undefined,
          }
        : undefined,
      derived: entry.derived
        ? {
            sessionFloor: convertPrice(entry.derived.sessionFloor, ticker, basis, mode),
            oiCallWall: convertPrice(entry.derived.oiCallWall, ticker, basis, mode),
            oiPutWall: convertPrice(entry.derived.oiPutWall, ticker, basis, mode),
            weakCallOIStrike: convertPrice(entry.derived.weakCallOIStrike, ticker, basis, mode),
            weakPutOIStrike: convertPrice(entry.derived.weakPutOIStrike, ticker, basis, mode),
            protectedGammaHigh: convertPrice(entry.derived.protectedGammaHigh, ticker, basis, mode),
            protectedGammaLow: convertPrice(entry.derived.protectedGammaLow, ticker, basis, mode),
            aggressiveCallCeiling: convertPrice(entry.derived.aggressiveCallCeiling, ticker, basis, mode),
            aggressivePutFloor: convertPrice(entry.derived.aggressivePutFloor, ticker, basis, mode),
            skewRichStrike: convertPrice(entry.derived.skewRichStrike, ticker, basis, mode),
            skewCheapStrike: convertPrice(entry.derived.skewCheapStrike, ticker, basis, mode),
          }
        : undefined,
    })),
  };
}

function convertRaw(raw: RawContract[], ticker: 'SPY' | 'QQQ', basis?: BasisData | null, mode: PriceMode = 'etf'): RawContract[] {
  return raw.map((row) => ({
    ...row,
    strike: convertPrice(row.strike, ticker, basis, mode) ?? row.strike,
  }));
}

function convertSurface(surface: SurfaceData, ticker: 'SPY' | 'QQQ', basis?: BasisData | null, mode: PriceMode = 'etf'): SurfaceData {
  return {
    ...surface,
    strikes: surface.strikes.map((strike) => convertPrice(strike, ticker, basis, mode) ?? strike),
  };
}

export function convertAnalyticsForDisplay(
  analytics: AnalyticsResponse | null,
  ticker: 'SPY' | 'QQQ',
  basis?: BasisData | null,
  mode: PriceMode = 'etf'
): AnalyticsResponse | null {
  if (!analytics?.summary) return null;

  return {
    ...analytics,
    summary: {
      ...analytics.summary,
      spotPrice: convertPrice(analytics.summary.spotPrice, ticker, basis, mode) ?? analytics.summary.spotPrice,
    },
    strikes: analytics.strikes.map((row) => ({
      ...row,
      strike: convertPrice(row.strike, ticker, basis, mode) ?? row.strike,
    })),
    levels: convertLevels(analytics.levels, ticker, basis, mode),
    raw: convertRaw(analytics.raw, ticker, basis, mode),
    surface: convertSurface(analytics.surface, ticker, basis, mode),
  };
}

export function convertBridgePayload(payload: string, ticker: 'SPY' | 'QQQ', basis?: BasisData | null, mode: PriceMode = 'etf') {
  if (mode === 'etf' || !basis || !payload) return payload;

  try {
    const parsed = JSON.parse(payload) as Record<string, number | null>;
    const remapped = { ...parsed } as Record<string, number | null>;

    for (const dte of [0, 1]) {
      for (const suffix of ['cw', 'pw', 'vt']) {
        const key = `d${dte}${suffix}`;
        remapped[key] = convertPrice(parsed[key] ?? undefined, ticker, basis, mode) ?? parsed[key];
      }
    }

    return JSON.stringify(remapped);
  } catch {
    return payload;
  }
}
