# Data sources and reuse boundaries

GEXLab fetches data when a user opens or refreshes a view and saves selected observations in a local SQLite database. Source availability, timestamps, and usage terms are controlled by each provider, not by this project. The list below reflects the current adapters; it is not a claim that every provider is official or suitable for redistribution.

| Area | Sources used in the code | Notes |
| --- | --- | --- |
| Macro series and releases | FRED/ALFRED, BLS, BEA, Census, Chicago Fed, New York Fed | Release dates and historical revisions differ by series. Pre-capture history can be a revised-data reconstruction. |
| Futures and index context | CME daily bulletin, Yahoo Finance chart endpoints, FRED | Yahoo endpoints are unofficial and may be delayed or change without notice. |
| Options | Cboe and Nasdaq public endpoints | Quotes and chains are not represented as a licensed real-time consolidated feed. Check provider terms before public redistribution. |
| Futures positioning | CFTC public reporting | Reports are periodic and lag the market. |
| Equity fundamentals and filings | SEC EDGAR and SEC company-facts/13F datasets | SEC requests require a descriptive User-Agent with a real operator contact configured through `GEXLAB_SEC_CONTACT`. Respect SEC fair-access guidance. |
| Equity short data | FINRA public files | Publication frequency and coverage vary by dataset. |
| Estimates and company profiles | StockAnalysis pages | Parsed third-party pages can change structure; verify terms and accuracy before relying on or redistributing results. |
| Issuer events | Company investor-relations pages and SEC filings | Schedules and filing descriptions are source-derived and can be incomplete. |
| News and geopolitical context | GDELT; Caldara-Iacoviello Geopolitical Risk dataset | These are context indicators, not direct measures of market impact. The academic dataset has its own attribution and use terms. |
| Trade and policy events | USTR, OFAC, BIS, Federal Reserve, BLS, BEA, and Census public pages/feeds | Parsers depend on upstream HTML, feeds, and calendars remaining compatible. |

## What the MIT license covers

The repository's MIT license covers GEXLab-authored code and documentation. It does not grant a license to provider data, third-party websites, exchange content, company filings, logos, or provider APIs. The application does not bundle a market-data archive in Git; locally captured SQLite history is excluded. Operators are responsible for checking each provider's terms before operating a hosted instance or redistributing output.

No API key is required for the configured public endpoints. SEC-backed pages need a real email address in `GEXLAB_SEC_CONTACT`; that value belongs in a local ignored environment file or deployment secret, never in source control.

## Provenance and missing data

Prefer the source and observation/retrieval timestamps shown in the interface. A failed source can leave a stale saved value or an unavailable state. Do not infer that a stale or missing series is current, and do not treat a historical observation date as its publication date.
