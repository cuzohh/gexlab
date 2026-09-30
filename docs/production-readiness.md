# Production-readiness checklist

**Status: portfolio-repository checks pass; GEXLab is not ready as a public hosted trading-data service.** This checklist was updated on 2026-09-30 after release checks on Node 24.14.0. Those checks do not validate external providers, Docker, TradingView, or live production operations. Provider rights are a release blocker for a hosted instance.

## Release gates

| Area | State | Required before public use |
| --- | --- | --- |
| Repo hygiene | The repository has a current README, MIT license, contribution/security guidance, data-source notes, and local-data ignore rules. | Review the final GitHub diff and confirm portfolio screenshots and claims describe the current build. |
| Automated checks | `npm run check` passed on Node 24.14.0: ESLint, 172 tests, and the optimized Next.js production build. | Keep these checks green for future releases. Perform visual review separately. |
| Dependency audit | `npm audit` reports zero vulnerabilities after updating Next.js and `sharp`. | Keep the lockfile current and rerun the audit for each release. |
| Local runtime smoke | A production server using an isolated temporary SQLite database returned `ok` from `/api/health` and HTTP 200 for the homepage. | Repeat on the intended host and exercise the key pages with representative data. |
| Container | A single-instance Docker Compose configuration and named SQLite volume are included. Docker was unavailable in the verification environment, so the image and Compose setup were not run. | Build and exercise the container on the intended host; verify volume persistence and a backup/restore. |
| Runtime support | Node 24.14.0 passed the local build and smoke check. Node's built-in SQLite API prints an experimental-feature warning. | Pin the deployment runtime and validate upgrades against the database and production build. |
| SQLite topology | The app uses Node's built-in SQLite with WAL mode and a local file. | Use one app instance on persistent local storage. Multiple replicas, shared network filesystems, and automatic failover are not supported. |
| SEC requests | SEC integrations read the operator contact from `GEXLAB_SEC_CONTACT`. No deployment contact was configured for this check. | Set a real monitored contact in each runtime environment and verify SEC routes under provider limits. |
| Upstream data rights | The current Yahoo, Cboe, Nasdaq, and StockAnalysis automated adapters have no permissions on file. Current public terms raise restrictions on automated access or programmatic use. | Obtain written authorization for the exact endpoints and use, or replace the adapters with licensed sources, before operating them. Review other provider terms too. Details are in [the source review](data-sources.md#programmatic-access-review-2026-09-30). |
| Collection schedule | Daily and intraday scripts each make one pass and exit. Intraday collection is not scheduled by the app. | Decide whether a collector is needed, schedule it outside the app process, and monitor missed runs. No strategy claim should depend on data that was not collected. |
| TradingView indicator | Pine source checks are code-level assertions only. | Paste into TradingView and compile/inspect it in the real Pine environment. |
| Model claims | The saved daily direction model has not passed its recorded out-of-sample baseline check. A local backtest value is not evidence of a durable edge. | Do not market a Sharpe or win rate without the sample, costs, baseline, and independent walk-forward evidence. |
| Public operations | The app has no built-in account system, distributed rate limiter, uptime monitor, or restore workflow. | Put a TLS reverse proxy and operator-managed access/abuse controls in front of it; configure logs, alerts, backups, and a tested restore process. |

## Local release commands

```powershell
npm ci
npm run check
npm audit
docker compose config
docker compose up --build
```

The Docker configuration binds to loopback by default. Do not expose port 3000 directly to the public internet. The named database volume persists across `docker compose down`; `docker compose down -v` deletes it. The health endpoint confirms the app can read its SQLite store; it does not confirm that market data is fresh.

## Portfolio release versus service launch

For a portfolio repository, prioritize an accurate README, source attribution, a license, a reviewed code diff, and passing build/check commands. Do not describe GEXLab as production trading software or as a proven alpha strategy. Publishing the code does not grant rights to the third-party data sources it calls.

For a hosted instance, also complete the storage, contact, provider, security, backup, monitoring, and recovery gates above. Keep the SQLite database, credentials, and personal contact values out of the public repository.
