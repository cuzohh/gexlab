export type FuturesBar = {
  timestamp: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

export type OvernightInstrument = {
  symbol: "NQ" | "ES";
  overnightOpen: number | null;
  last: number | null;
  priorRthClose: number | null;
  gapPoints: number | null;
  gapPercent: number | null;
  overnightHigh: number | null;
  overnightLow: number | null;
  overnightRangePoints: number | null;
  overnightRangePercent: number | null;
  rangePositionPercent: number | null;
  netMoveToRange: number | null;
  inventoryScore: number | null;
  inventoryLabel: "Long" | "Short" | "Balanced" | "Unavailable";
  overnightVolume: number | null;
  bars: number;
  observedThrough: string | null;
};

export type ConfidenceLevel = "High" | "Medium" | "Low" | "Unavailable";

export type OvernightContext = {
  sessionDate: string;
  status: "available" | "partial" | "unavailable";
  regime: "Directional long" | "Directional short" | "Extended long" | "Extended short" | "Inventory conflict" | "NQ/ES divergence" | "Mixed / balanced" | "Unavailable";
  playbook: "Continuation watch" | "Inventory correction watch" | "No structural edge" | "Unavailable";
  regimeBasis: string;
  confidence: {
    structuralScore: number | null;
    structuralLevel: ConfidenceLevel;
    directionalScore: number | null;
    directionalLevel: ConfidenceLevel;
    reasons: string[];
  };
  source: "Yahoo Finance public chart";
  sourceDelayMinutes: 10;
  observedThrough: string | null;
  nq: OvernightInstrument;
  es: OvernightInstrument;
  note: string | null;
  history?: {
    sessions: number;
    required: number;
    firstDate: string | null;
    lastDate: string | null;
  };
};

type ChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    } | null>;
  };
};

export function parseYahooChartPayload(payload: unknown): FuturesBar[] {
  const result = (payload as ChartPayload)?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote || !timestamps.length) return [];

  return timestamps.flatMap((timestamp, index) => {
    if (!Number.isFinite(timestamp)) return [];
    const values = {
      open: quote.open?.[index] ?? null,
      high: quote.high?.[index] ?? null,
      low: quote.low?.[index] ?? null,
      close: quote.close?.[index] ?? null,
      volume: quote.volume?.[index] ?? null,
    };
    if (![values.open, values.high, values.low, values.close].some((value) => Number.isFinite(value))) {
      return [];
    }
    return [{
      timestamp: new Date(timestamp * 1000).toISOString(),
      ...values,
    }];
  });
}

function easternParts(timestamp: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function previousCalendarDate(date: string) {
  const cursor = new Date(`${date}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  return cursor.toISOString().slice(0, 10);
}

function valid(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function instrumentContext(
  symbol: "NQ" | "ES",
  bars: FuturesBar[],
  sessionDate: string,
  priorSessionDate: string,
): OvernightInstrument {
  const priorRthBars = bars.filter((bar) => {
    const local = easternParts(bar.timestamp);
    const minute = Number(local.hour) * 60 + Number(local.minute);
    return local.year + "-" + local.month + "-" + local.day === priorSessionDate && minute >= 9 * 60 + 30 && minute < marketCloseMinutes(priorSessionDate);
  });
  const priorRthClose = priorRthBars
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .at(-1)?.close ?? null;

  const startDate = previousCalendarDate(sessionDate);
  const overnightBars = bars.filter((bar) => {
    const local = easternParts(bar.timestamp);
    const date = local.year + "-" + local.month + "-" + local.day;
    const minute = Number(local.hour) * 60 + Number(local.minute);
    return (date === startDate && minute >= 18 * 60) || (date === sessionDate && minute < 9 * 60 + 30);
  });
  const closes = overnightBars.map((bar) => bar.close).filter(valid);
  const highs = overnightBars.map((bar) => bar.high).filter(valid);
  const lows = overnightBars.map((bar) => bar.low).filter(valid);
  const last = overnightBars
    .filter((bar) => valid(bar.close))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .at(-1)?.close ?? null;
  const overnightOpen = overnightBars
    .filter((bar) => valid(bar.open))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .at(0)?.open ?? null;
  const overnightHigh = highs.length ? Math.max(...highs) : null;
  const overnightLow = lows.length ? Math.min(...lows) : null;
  const overnightRangePoints = overnightHigh !== null && overnightLow !== null
    ? overnightHigh - overnightLow
    : null;
  const overnightVolume = overnightBars
    .map((bar) => bar.volume)
    .filter(valid)
    .reduce((sum, value) => sum + value, 0) || null;
  const volumeAbove = priorRthClose !== null
    ? overnightBars
      .filter((bar) => valid(bar.close) && valid(bar.volume) && bar.close > priorRthClose)
      .reduce((sum, bar) => sum + bar.volume!, 0)
    : 0;
  const volumeBelow = priorRthClose !== null
    ? overnightBars
      .filter((bar) => valid(bar.close) && valid(bar.volume) && bar.close < priorRthClose)
      .reduce((sum, bar) => sum + bar.volume!, 0)
    : 0;
  const inventoryDenominator = volumeAbove + volumeBelow;
  const inventoryScore = inventoryDenominator > 0
    ? (volumeAbove - volumeBelow) / inventoryDenominator
    : priorRthClose !== null && closes.length
      ? overnightBars.filter((bar) => valid(bar.close) && bar.close > priorRthClose).length / closes.length * 2 - 1
      : null;
  const rangePositionPercent = last !== null && overnightHigh !== null && overnightLow !== null && overnightHigh > overnightLow
    ? ((last - overnightLow) / (overnightHigh - overnightLow)) * 100
    : null;
  const netMoveToRange = overnightOpen !== null && last !== null && overnightRangePoints && overnightRangePoints > 0
    ? (last - overnightOpen) / overnightRangePoints
    : null;
  const inventoryLabel = inventoryScore === null
    ? "Unavailable" as const
    : inventoryScore >= 0.35
      ? "Long" as const
      : inventoryScore <= -0.35
        ? "Short" as const
        : "Balanced" as const;

  return {
    symbol,
    overnightOpen,
    last,
    priorRthClose,
    gapPoints: last !== null && priorRthClose !== null ? last - priorRthClose : null,
    gapPercent: last !== null && priorRthClose ? ((last / priorRthClose) - 1) * 100 : null,
    overnightHigh,
    overnightLow,
    overnightRangePoints,
    overnightRangePercent: overnightRangePoints !== null && priorRthClose
      ? (overnightRangePoints / priorRthClose) * 100
      : null,
    rangePositionPercent,
    netMoveToRange,
    inventoryScore,
    inventoryLabel,
    overnightVolume,
    bars: closes.length,
    observedThrough: overnightBars.length
      ? overnightBars.reduce((latest, bar) => Date.parse(bar.timestamp) > Date.parse(latest.timestamp) ? bar : latest).timestamp
      : null,
  };
}

export function emptyOvernightContext(sessionDate: string, note = "Overnight futures bars are unavailable."): OvernightContext {
  const empty = (symbol: "NQ" | "ES"): OvernightInstrument => ({
    symbol,
    overnightOpen: null,
    last: null,
    priorRthClose: null,
    gapPoints: null,
    gapPercent: null,
    overnightHigh: null,
    overnightLow: null,
    overnightRangePoints: null,
    overnightRangePercent: null,
    rangePositionPercent: null,
    netMoveToRange: null,
    inventoryScore: null,
    inventoryLabel: "Unavailable",
    overnightVolume: null,
    bars: 0,
    observedThrough: null,
  });
  return {
    sessionDate,
    status: "unavailable",
    regime: "Unavailable",
    playbook: "Unavailable",
    regimeBasis: note,
    confidence: {
      structuralScore: null,
      structuralLevel: "Unavailable",
      directionalScore: null,
      directionalLevel: "Unavailable",
      reasons: [note],
    },
    source: "Yahoo Finance public chart",
    sourceDelayMinutes: 10,
    observedThrough: null,
    nq: empty("NQ"),
    es: empty("ES"),
    note,
  };
}

export function buildOvernightContext(input: {
  sessionDate: string;
  priorSessionDate: string;
  nq: FuturesBar[];
  es: FuturesBar[];
  note?: string | null;
}): OvernightContext {
  const nq = instrumentContext("NQ", input.nq, input.sessionDate, input.priorSessionDate);
  const es = instrumentContext("ES", input.es, input.sessionDate, input.priorSessionDate);
  const observedTimes = [nq.observedThrough, es.observedThrough].filter((value): value is string => value !== null);
  const bars = nq.bars + es.bars;
  const sameInventory = nq.inventoryLabel !== "Unavailable" && nq.inventoryLabel === es.inventoryLabel;
  const nqDirectional = nq.inventoryLabel === "Long" || nq.inventoryLabel === "Short";
  const esDirectional = es.inventoryLabel === "Long" || es.inventoryLabel === "Short";
  const gapDirection = nq.gapPoints === null ? null : nq.gapPoints > 0 ? "Long" : nq.gapPoints < 0 ? "Short" : "Balanced";
  const conflict = gapDirection !== null && nqDirectional && gapDirection !== nq.inventoryLabel;
  const extended = nq.rangePositionPercent !== null && nq.inventoryLabel === "Long" && nq.rangePositionPercent >= 85
    ? "Extended long" as const
    : nq.rangePositionPercent !== null && nq.inventoryLabel === "Short" && nq.rangePositionPercent <= 15
      ? "Extended short" as const
      : null;
  const regime = bars === 0
    ? "Unavailable" as const
    : conflict
      ? "Inventory conflict" as const
      : sameInventory && extended
        ? extended
        : sameInventory && nqDirectional
          ? nq.inventoryLabel === "Long" ? "Directional long" as const : "Directional short" as const
          : nqDirectional && esDirectional && nq.inventoryLabel !== es.inventoryLabel
            ? "NQ/ES divergence" as const
            : "Mixed / balanced" as const;
  const dataComplete = nq.bars >= 50 && es.bars >= 50;
  const volumeComplete = nq.overnightVolume !== null && es.overnightVolume !== null;
  const averageInventoryStrength = nq.inventoryScore !== null && es.inventoryScore !== null
    ? (Math.abs(nq.inventoryScore) + Math.abs(es.inventoryScore)) / 2
    : nq.inventoryScore !== null
      ? Math.abs(nq.inventoryScore)
      : 0;
  const sameDirection = (nq.inventoryLabel === "Long" || nq.inventoryLabel === "Short") && nq.inventoryLabel === es.inventoryLabel;
  const pathConsistent = nq.inventoryLabel === "Long"
    ? (nq.rangePositionPercent ?? 50) >= 50 && (nq.netMoveToRange ?? 0) >= 0
    : nq.inventoryLabel === "Short"
      ? (nq.rangePositionPercent ?? 50) <= 50 && (nq.netMoveToRange ?? 0) <= 0
      : false;
  const structuralScore = bars === 0
    ? null
    : Math.min(
        100,
        (dataComplete ? 25 : 15) +
          (volumeComplete ? 15 : 5) +
          Math.round(averageInventoryStrength * 25) +
          (sameDirection ? 20 : nqDirectional && esDirectional ? 6 : 10) +
          (pathConsistent ? 15 : 5),
      );
  const structuralLevel: ConfidenceLevel = structuralScore === null
    ? "Unavailable"
    : structuralScore >= 75
      ? "High"
      : structuralScore >= 50
        ? "Medium"
        : "Low";
  const directionalScore = bars === 0
    ? null
    : regime === "Directional long" || regime === "Directional short"
      ? structuralScore
      : regime === "Extended long" || regime === "Extended short"
        ? Math.max(0, (structuralScore ?? 0) - 10)
        : regime === "Inventory conflict" || regime === "NQ/ES divergence"
          ? Math.min(45, structuralScore ?? 0)
          : Math.min(35, structuralScore ?? 0);
  const directionalLevel: ConfidenceLevel = directionalScore === null
    ? "Unavailable"
    : directionalScore >= 75
      ? "High"
      : directionalScore >= 50
        ? "Medium"
        : "Low";
  const reasons = [
    dataComplete ? "Both markets have a complete overnight window." : "One or both overnight windows are partial.",
    volumeComplete ? "Volume is available for the inventory proxy." : "Inventory falls back partly to price/time because volume is incomplete.",
    sameDirection ? "NQ and ES inventory agree." : "NQ and ES do not provide clean directional agreement.",
    pathConsistent ? "Price is closing in the direction of the inferred inventory." : "Price location does not fully confirm the inferred inventory.",
  ];
  return {
    sessionDate: input.sessionDate,
    status: bars === 0 ? "unavailable" : nq.bars > 0 && es.bars > 0 ? "available" : "partial",
    regime,
    confidence: {
      structuralScore,
      structuralLevel,
      directionalScore,
      directionalLevel,
      reasons,
    },
    playbook: bars === 0
      ? "Unavailable"
      : regime === "Directional long" || regime === "Directional short"
        ? "Continuation watch"
        : regime === "Extended long" || regime === "Extended short" || regime === "Inventory conflict"
          ? "Inventory correction watch"
          : "No structural edge",
    regimeBasis: bars === 0
      ? input.note ?? "No overnight bars available."
      : "Price/volume inventory proxy; not actual trader positioning. Treat as a hypothesis until the session log has enough outcomes.",
    source: "Yahoo Finance public chart",
    sourceDelayMinutes: 10,
    observedThrough: observedTimes.sort().at(-1) ?? null,
    nq,
    es,
    note: input.note ?? (bars === 0 ? "No pre-open bars are available for this session yet." : null),
  };
}
import { marketCloseMinutes } from "./market-time.ts";
