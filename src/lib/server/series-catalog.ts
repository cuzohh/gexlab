/**
 * The one list of series the application ingests.
 *
 * Batches are cached under a key derived from the exact set of identifiers in
 * each request, so every workspace has to ask for the same list in the same
 * order to share those snapshots. Keeping the catalogue here is what lets the
 * forecast engine run without adding a single outbound request: it reads the
 * copies the macro workspace already fetched.
 */
export const MACRO_SERIES_IDS = [
  "CPIAUCSL", "CPILFESL", "PCEPILFE", "UNRATE", "PAYEMS", "INDPRO", "RSAFS", "UMCSENT", "M2SL",
  "ICSA", "WALCL", "WTREGEN", "WRESBAL", "NFCI", "GDPC1",
  "DGS2", "DGS10", "DGS30", "T10Y2Y", "T10Y3M", "DFII10", "T5YIE", "T10YIE", "T5YIFR",
  "SOFR", "EFFR", "IORB", "RRPONTSYD", "BAMLH0A0HYM2", "BAMLC0A0CM", "NASDAQ100", "SP500",
  "VIXCLS", "VXNCLS", "VXVCLS", "OVXCLS", "DTWEXBGS", "DCOILWTICO",
  "STLFSI4", "ANFCI", "SAHMREALTIME", "CFNAIMA3", "HOUST", "CCSA",
  "GDPNOW", "RECPROUSM156N", "THREEFYTP10",
  "CORESTICKM159SFRBATL", "PCETRIM12M159SFRBDAL",
  "TEMPHELPS", "JTSQUR", "JTSJOL", "AWHAETP", "CLF16OV",
  "DRTSCILM", "TOTBKCR", "BUSLOANS",
] as const;
