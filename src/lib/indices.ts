/**
 * Index membership, shared by the parts of the workstation that need to know
 * which companies are widely held.
 *
 * Two callers, and they must not disagree: the benchmark picker measures a
 * Nasdaq-100 name against QQQ rather than the broad market, and the ticker
 * search puts the same names near the top of a suggestion list, because someone
 * typing three letters almost always means the household name rather than the
 * micro-cap that shares the prefix.
 */

/**
 * The Nasdaq-100, which is the index most of this watchlist actually trades with.
 *
 * Membership is reviewed annually and changes a handful of names each December,
 * so this list is a snapshot rather than a live constituent feed. A name that
 * has left the index is measured against a slightly wrong yardstick until the
 * list is edited; a name that has joined falls back to the broad market, which
 * is the safer of the two errors.
 */
export const NASDAQ_100 = new Set([
  "AAPL", "ABNB", "ADBE", "ADI", "ADP", "ADSK", "AEP", "AMAT", "AMD", "AMGN", "AMZN", "ANSS", "APP", "ARM", "ASML",
  "AVGO", "AXON", "AZN", "BIIB", "BKNG", "BKR", "CCEP", "CDNS", "CDW", "CEG", "CHTR", "CMCSA", "COST", "CPRT",
  "CRWD", "CSCO", "CSGP", "CSX", "CTAS", "CTSH", "DASH", "DDOG", "DXCM", "EA", "EXC", "FANG", "FAST", "FTNT",
  "GEHC", "GFS", "GILD", "GOOG", "GOOGL", "HON", "IDXX", "INTC", "INTU", "ISRG", "KDP", "KHC", "KLAC", "LIN",
  "LRCX", "LULU", "MAR", "MCHP", "MDB", "MDLZ", "MELI", "META", "MNST", "MRVL", "MSFT", "MSTR", "MU", "NFLX",
  "NVDA", "NXPI", "ODFL", "ON", "ORLY", "PANW", "PAYX", "PCAR", "PDD", "PEP", "PLTR", "PYPL", "QCOM", "REGN",
  "ROP", "ROST", "SBUX", "SNPS", "TEAM", "TMUS", "TSLA", "TTD", "TTWO", "TXN", "VRSK", "VRTX", "WBD", "WDAY",
  "XEL", "ZS",
]);
