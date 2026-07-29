import "server-only";

import { dedupeRequest } from "@/lib/server/request-deduper";
import { getSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";

export type CftcPositioningRow = {
  date: string;
  symbol: "ES" | "NQ";
  leveragedNet: number;
  assetManagerNet: number;
};

export function parseCftcFinFutCsv(csvText: string): CftcPositioningRow[] {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.replace(/^["']|["']$/g, "").trim().toLowerCase());
  const dateIdx = headers.findIndex((h) => h.includes("date"));
  const nameIdx = headers.findIndex((h) => h.includes("market") || h.includes("name"));
  const levLongIdx = headers.findIndex((h) => h.includes("m_money_positions_long") || h.includes("lev_money_positions_long"));
  const levShortIdx = headers.findIndex((h) => h.includes("m_money_positions_short") || h.includes("lev_money_positions_short"));
  const mgrLongIdx = headers.findIndex((h) => h.includes("asset_mgr_positions_long"));
  const mgrShortIdx = headers.findIndex((h) => h.includes("asset_mgr_positions_short"));

  const results: CftcPositioningRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",").map((c) => c.replace(/^["']|["']$/g, "").trim());
    if (cols.length <= Math.max(dateIdx, nameIdx)) continue;

    const name = cols[nameIdx]?.toUpperCase() ?? "";
    let symbol: "ES" | "NQ" | null = null;
    if (name.includes("E-MINI S&P 500") || name.includes("S&P 500 STOCK INDEX")) symbol = "ES";
    else if (name.includes("NASDAQ-100") || name.includes("NASDAQ 100")) symbol = "NQ";

    if (!symbol) continue;

    const rawDate = cols[dateIdx];
    let date = "";
    if (/^\d{8}$/.test(rawDate)) {
      date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      date = rawDate;
    } else continue;

    const levLong = levLongIdx >= 0 ? Number(cols[levLongIdx]) || 0 : 0;
    const levShort = levShortIdx >= 0 ? Number(cols[levShortIdx]) || 0 : 0;
    const mgrLong = mgrLongIdx >= 0 ? Number(cols[mgrLongIdx]) || 0 : 0;
    const mgrShort = mgrShortIdx >= 0 ? Number(cols[mgrShortIdx]) || 0 : 0;

    results.push({
      date,
      symbol,
      leveragedNet: levLong - levShort,
      assetManagerNet: mgrLong - mgrShort,
    });
  }

  return results.sort((left, right) => left.date.localeCompare(right.date));
}

export async function loadCftcData(): Promise<CftcPositioningRow[]> {
  const stored = getSnapshot<CftcPositioningRow[]>("cftc-data", "financial-futures");
  if (stored && snapshotIsFresh(stored)) {
    return stored.payload;
  }

  const existingPayload: CftcPositioningRow[] = stored?.payload ?? [];

  return dedupeRequest("cftc:disagg", async () => {
    try {
      const year = new Date().getUTCFullYear();
      const res = await fetch(`https://www.cftc.gov/files/dea/history/fut_disagg_txt_${year}.zip`, {
        headers: { "User-Agent": "GEXLab-V3/1.0 (Research Engine; open-source)" },
      });
      if (!res.ok) throw new Error(`CFTC fetch status ${res.status}`);

      return existingPayload;
    } catch {
      return existingPayload;
    }
  });
}
