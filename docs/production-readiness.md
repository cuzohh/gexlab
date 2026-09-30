# Production-readiness checklist

**Status: not production-ready as a public hosted service.** GEXLab is suitable to present as an active research software project after the release changes are reviewed and validated. A portfolio repository and a dependable public trading-data service have different operational requirements.

This checklist records the state observed on 2026-09-29. Update it after release checks and deployment work.

## Release gates

| Area | State | Required before public use |
| --- | --- | --- |
| Repo hygiene | README, MIT license, contribution/security guidance, and local-data ignore rules are in place. The recent Equity Desk work is included but not code-reviewed or validated as a production release. | Review the complete release diff and run the checks before treating the repository as a production release. |
| Build and automated checks | Check commands exist. They were not run during this update. | Run `npm run check` on the exact release candidate and fix all failures. |
| Container | A single-instance Docker Compose configuration with a named SQLite volume is included. It has not been built or smoke-checked here. | Build and exercise it on the intended host; verify persistence across container replacement and a backup/restore. |
| Runtime support | Docker uses the Node 24 image; local development supports Node 22.13 or later. Node's SQLite API remains pre-stable in Node 24. | Pin the Node runtime in deployment and validate runtime upgrades against the database and production build. |
| SQLite topology | The app uses Node's built-in SQLite with WAL mode and a local file. | Use one app instance on persistent local storage. Multiple replicas, shared network filesystems, and automatic failover are not supported. |
| SEC requests | SEC integrations now read the operator contact from `GEXLAB_SEC_CONTACT`. | Set a valid, monitored contact in each runtime environment and confirm the SEC routes work without exceeding provider limits. |
| Upstream data | The application reads a mix of official and third-party public endpoints. | Review provider terms for the exact hosting and redistribution use; add monitoring for failed or stale sources. |
| Collection schedule | Daily and intraday scripts each make one pass and exit. Intraday collection is not scheduled by the app. | Decide whether a collector is needed, schedule it outside the app process, and monitor missed runs. No intraday strategy claim should depend on data that was not collected. |
| TradingView indicator | Pine source checks are code-level assertions only. | Paste into TradingView and compile/inspect it in the real Pine environment. |
| Model claims | The saved daily direction model has not passed its recorded out-of-sample baseline check. A local backtest value is not evidence of a durable edge. | Do not market a Sharpe or win rate without the sample, costs, baseline, and independent walk-forward evidence. |
| Public operations | The app has no built-in account system, distributed rate limiter, uptime monitor, or restore workflow. | Put a TLS reverse proxy and operator-managed access/abuse controls in front of it; configure logs, alerts, backups, and a tested restore process. |

## Local release commands

```powershell
npm ci
npm run check
docker compose up --build
```

The Docker configuration binds to loopback by default. Do not expose port 3000 directly to the public internet. The named database volume persists across `docker compose down`; `docker compose down -v` deletes it.

## Portfolio release versus service launch

For a portfolio release, prioritize an accurate README, source attribution, a license, a reviewed code diff, and passing build/check commands. Do not describe GEXLab as production trading software or as a proven alpha strategy.

For a hosted instance, also complete the storage, contact, provider, security, backup, monitoring, and recovery gates above. Keep the SQLite database, credentials, and personal contact values out of the public repository.
