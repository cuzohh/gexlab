import type { MacroData, StockData } from "@/components/stocks/types";

export type Assessment = {
  label: "Aligned" | "Leadership" | "Watch" | "Selective";
  tone: "up" | "neutral" | "warn" | "quiet";
  note: string;
};

/**
 * The research state shown beside a name.
 *
 * Two gates, deliberately kept separate: whether the macro regime is receptive,
 * and whether the stock is leading its own sector. Both open is the only state
 * described as aligned, and none of it is a recommendation — it says which
 * evidence is present, not what to do about it.
 */
export function assess(stock: Pick<StockData, "relativeStrength">, macro: MacroData | null): Assessment {
  const month = stock.relativeStrength.find((row) => row.periods === 20)?.versusSector ?? null;
  const macroReady = (macro?.regime?.riskAppetite ?? 0) >= 60;
  const leading = month !== null && month > 0;

  if (macroReady && leading) return { label: "Aligned", tone: "up", note: "macro and leadership agree" };
  if (leading) return { label: "Leadership", tone: "neutral", note: "macro gate pending" };
  if (macroReady) return { label: "Watch", tone: "warn", note: "leadership pending" };
  return { label: "Selective", tone: "quiet", note: "wait for confirmation" };
}
