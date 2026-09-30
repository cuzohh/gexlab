# Contributing

Thanks for helping improve GEXLab. Keep changes explainable, reproducible, and clear about the limits of the data.

## Set up

- Use Node.js 24 (Node.js 22.13 or later is required for the built-in SQLite runtime without an experimental flag).
- Install dependencies with `npm ci`.
- Run `npm run dev` to start the application.
- Run `npm run check` before proposing a change. It runs lint, the existing calculation tests, and the production build.

## Research and data changes

- Cite the source, observation time, release time, and transformation for new data.
- Keep unavailable observations unavailable. Do not fill gaps with zero or plausible-looking substitute values.
- Preserve point-in-time boundaries in historical evaluations. Do not use revised data as if it had been available at the time.
- Do not present a backtest statistic without its sample, costs, baseline, and out-of-sample method. A strong result from a parameter sweep is not an independent validation.
- Bump the relevant methodology/source version when a formula or output schema changes so stored results cannot be mistaken for the new calculation.
- Keep SQLite files, provider responses, credentials, and private contact details out of commits.
- SEC requests require a real operator contact in `GEXLAB_SEC_CONTACT`. Configure it locally or in the deployment environment; never commit the address.

## Pull requests

Describe the user-visible change, the data sources affected, and any change to formulas or stored output. Include the commands you ran and call out checks that require a real provider, TradingView, or MotiveWave environment. Keep unrelated local work out of the change.
