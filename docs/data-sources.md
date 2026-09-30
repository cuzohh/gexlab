# Data sources and reuse boundaries

GEXLab fetches data when a user opens or refreshes a view and saves selected observations in a local SQLite database. Source availability, timestamps, and usage terms are controlled by each provider, not by this project. The list below reflects the current adapters; it is not a claim that every provider is official or suitable for redistribution.

| Area | Sources used in the code | Notes |
| --- | --- | --- |
| Macro series and releases | FRED/ALFRED, BLS, BEA, Census, Chicago Fed, New York Fed | Release dates and historical revisions differ by series. Pre-capture history can be a revised-data reconstruction. |
| Futures and index context | CME daily bulletin, Yahoo Finance chart endpoints, FRED | The Yahoo chart adapters make automated requests. Yahoo's terms require express prior permission for automated data collection. Do not operate this adapter without permission or an authorized replacement. |
| Options | Cboe and Nasdaq public endpoints | The current adapters automatically request public delayed quote endpoints. Cboe prohibits automated extraction from its delayed quote pages; Nasdaq's current legal terms prohibit data capture from its services. Obtain written endpoint-specific rights or replace these adapters before automated use. |
| Futures positioning | CFTC public reporting | Reports are periodic and lag the market. |
| Equity fundamentals and filings | SEC EDGAR and SEC company-facts/13F datasets | SEC requests require a descriptive User-Agent with a real operator contact configured through `GEXLAB_SEC_CONTACT`. Respect SEC fair-access guidance. |
| Equity short data | FINRA public files | Publication frequency and coverage vary by dataset. |
| Estimates and company profiles | StockAnalysis pages | These adapters parse web pages. StockAnalysis says it does not offer programmatic access and its data-provider licenses do not permit programmatic redistribution. Do not operate these adapters; replace them with an authorized data source. |
| Issuer events | Company investor-relations pages and SEC filings | Schedules and filing descriptions are source-derived and can be incomplete. |
| News and geopolitical context | GDELT; Caldara-Iacoviello Geopolitical Risk dataset | These are context indicators, not direct measures of market impact. The academic dataset has its own attribution and use terms. |
| Trade and policy events | USTR, OFAC, BIS, Federal Reserve, BLS, BEA, and Census public pages/feeds | Parsers depend on upstream HTML, feeds, and calendars remaining compatible. |

## What the MIT license covers

The repository's MIT license covers GEXLab-authored code and documentation. It does not grant a license to provider data, third-party websites, exchange content, company filings, logos, or provider APIs. The application does not bundle a market-data archive in Git; locally captured SQLite history is excluded. Operators are responsible for checking each provider's terms before operating a hosted instance or redistributing output.

No API key is required for the configured public endpoints. SEC-backed pages need a real email address in `GEXLAB_SEC_CONTACT`; that value belongs in a local ignored environment file or deployment secret, never in source control.

## Programmatic-access review (2026-09-30)

Open-source publication of GEXLab code does not grant rights to query, store, display, or redistribute third-party data. The repository currently contains automated adapters for Yahoo Finance, Cboe, Nasdaq, and StockAnalysis. Their current public terms raise specific restrictions on automated access or programmatic use:

- [Yahoo Terms of Service](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) require express prior permission for automated data collection.
- [Cboe's delayed-quotes page](https://www.cboe.com/delayed_quotes/res/quote_table) prohibits automated extraction of delayed quote tables. [Cboe's content policy](https://www.cboe.com/use-of-content/) requires prior approval and a signed license to use Cboe website content. Confirm whether the exact option-chain and history endpoints in this code have separate terms.
- [Nasdaq's legal terms](https://www.nasdaq.com/legal) restrict automated or manual data capture from its services. Confirm that the exact options endpoint is authorized for the intended use.
- [StockAnalysis' API guidance](https://stockanalysis.com/help/faq/api-access/) says programmatic access is not offered and its source-data licenses do not permit programmatic redistribution.

Until the operator has written permission or swaps each affected adapter for an authorized source, do not operate these integrations. A public repository can describe the integrations, but must not claim the resulting live data is licensed for redistribution. Review the current terms again before use because provider terms can change.

For SEC data, use a descriptive User-Agent and comply with the [SEC developer guidance](https://www.sec.gov/developer) and [EDGAR API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces). The SEC's published automated-access cap is 10 requests per second across the requesting IP; a public deployment also needs controls that prevent user traffic from exceeding provider limits.

## Provenance and missing data

Prefer the source and observation/retrieval timestamps shown in the interface. A failed source can leave a stale saved value or an unavailable state. Do not infer that a stale or missing series is current, and do not treat a historical observation date as its publication date.
