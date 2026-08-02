export type CftcPositioningRow = {
  date: string;
  symbol: "ES" | "NQ";
  leveragedNet: number;
  assetManagerNet: number;
};

export type CftcApiRow = {
  report_date_as_yyyy_mm_dd?: string;
  contract_market_name?: string;
  asset_mgr_positions_long?: string;
  asset_mgr_positions_short?: string;
  lev_money_positions_long?: string;
  lev_money_positions_short?: string;
};

const CONTRACTS = { "NASDAQ MINI": "NQ", "E-MINI S&P 500": "ES" } as const;

function net(long: unknown, short: unknown) {
  const left = Number(long);
  const right = Number(short);
  return Number.isFinite(left) && Number.isFinite(right) ? left - right : null;
}

export function parseCftcApiRows(rows: CftcApiRow[]): CftcPositioningRow[] {
  return rows
    .flatMap((row) => {
      const symbol = CONTRACTS[String(row.contract_market_name ?? "").trim() as keyof typeof CONTRACTS];
      const date = String(row.report_date_as_yyyy_mm_dd ?? "").slice(0, 10);
      const leveragedNet = net(row.lev_money_positions_long, row.lev_money_positions_short);
      const assetManagerNet = net(row.asset_mgr_positions_long, row.asset_mgr_positions_short);
      if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date) || leveragedNet === null || assetManagerNet === null) return [];
      return [{ date, symbol, leveragedNet, assetManagerNet }];
    })
    .sort((left, right) => left.symbol.localeCompare(right.symbol) || right.date.localeCompare(left.date));
}
