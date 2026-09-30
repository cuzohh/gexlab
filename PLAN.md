# GEXLab V3 — NQ Macro Regime & Options-Structure Plan

## Current-scope addendum (2026-09-29)

This document records the original macro and options build. The current repository also contains an experimental Equity Desk under `/stocks` for company, options, ownership, estimates, and catalyst research. That addition does not turn the app into an execution system or establish predictive performance. References below to stock selection being outside the macro regime's scope apply to that shared regime overlay; the Equity Desk is a separate research workspace. Current source and release limits are in [README.md](README.md), [data-sources.md](docs/data-sources.md), and [production-readiness.md](docs/production-readiness.md).

## 1. Purpose

Build V3 as an end-of-day decision-support application for trading NQ futures.

V3 combines three distinct layers:

1. **Options structure** — NDX and NDXP gamma, zero gamma, call/put walls, expiry concentration, and 0DTE context. This answers **where price may react**.
2. **Macro regime** — growth, inflation, policy/rates, liquidity, credit stress, volatility, positioning, and event risk. This answers **what environment price is trading in**.
3. **Market transmission** — real yields, dollar, credit, breadth, leadership, flows, and cross-asset divergences. This answers **whether the macro regime is reaching NQ**.

The product should not output a trade command. It should make the current environment legible: which inputs are driving risk, whether major options levels are more likely to contain or fail, how fresh the data is, and what could invalidate the read.

## 2. Scope and operating constraints

### 2.1 Primary use case

- NQ futures trader.
- End-of-day data for major levels, walls, macro regime, and next-session preparation.
- Optional refreshes after scheduled economic releases and after the cash close.
- No mandatory user account, API key, paid market-data subscription, or `yfinance` dependency.

### 2.2 Data philosophy

Use direct official/public sources for every core regime input. Use no-account website endpoints only for non-critical market-price enrichments. Persist every response locally so a historical backtest never depends on a website still behaving the same way later.

### 2.3 Explicit non-goals for the initial build

- Live tick-by-tick NQ, OPRA, or full real-time futures data.
- A guaranteed real-time macro surprise feed or consensus forecast feed.
- A claim that any indicator is causal or predictive by itself.
- Fully automated execution.
- A black-box regime model as the only displayed explanation.

## 3. Product principles

1. **Layered, not monolithic.** A single risk-on/risk-off score hides important conflicts. Display the macro quadrant, policy/liquidity overlay, stress state, volatility state, positioning, and options structure separately.
2. **Source provenance everywhere.** Every card must expose source, observation date, release timestamp, retrieval time, transformation, and freshness.
3. **Release-aware data.** Economic data becomes known on its release date/time, not on its reference-period date.
4. **No silent fallback.** A stale or failed source must be visible. Never substitute a different source without marking it.
5. **Transparent first.** Rule-based scores and readable formulas ship before hidden-state models.
6. **Backtest before assigning confidence.** Regime-to-NQ implications and wall-confidence multipliers are hypotheses until validated with walk-forward testing.
7. **Options are location; macro is condition.** Neither replaces the other.

## 3.1 Minimal interface and information-architecture contract

### Design objective

V3 must feel like a calm daily briefing, not a traditional trading terminal. The interface should prioritize orientation and decision context over information density. A trader should understand the current NQ/ES and equity-dip environment in roughly 15 seconds without reading a grid of 50 metrics.

The visual direction is **quiet, editorial, and deliberately sparse**:

- No wall of tiny tiles.
- No permanent data tables on the default screen.
- No equal-weight card grid where every metric looks equally important.
- No decorative mini-charts that do not change a decision.
- No red/green “buy/sell” treatment; colors describe condition and urgency only.
- Numbers are subordinate to the conclusion unless the user asks to inspect them.

### Aesthetic direction — effortless market cartography

The product should look cool because it is unusually clear, proportioned, and precise—not because it is decorated. The visual identity is **effortless market cartography**: a refined editorial briefing whose maps, tracks, zones, and annotations feel like a purpose-built market instrument.

The memorable signature is the data itself:

- Regime appears as a point and trail moving through an economic landscape.
- Options structure appears as carefully drawn terrain around price.
- Events appear as a quiet runway through time.
- Uncertainty appears as real visual space, not a hidden disclaimer.

Everything surrounding those visuals should recede. The interface should feel composed even when the data is complicated.

#### Typography

- Use one characterful, highly legible sans serif for interface copy and one restrained editorial serif only for selected page questions or interpretive statements.
- Use monospace only for timestamps, exact market values, source identifiers, and tabular alignment—not as a generic “trading terminal” costume.
- Avoid default-looking product fonts such as Inter, Roboto, Open Sans, or Arial.
- Favor confident scale contrast: a concise page question, calm body copy, small metadata, and precise numeric labels.
- Keep headings left-aligned, line lengths controlled, and line-height generous.
- Large type must carry meaning; do not turn every score or market price into a billboard number.

#### Palette

Use warm, lightly tinted neutrals as the dominant field:

- Canvas: warm bone / paper rather than pure white.
- Primary ink: soft charcoal rather than pure black.
- Dividers and inactive data: cool stone with very low contrast.
- Constructive: desaturated blue-green.
- Caution: muted ochre.
- Stress: muted vermilion.
- Informational/map accent: restrained slate blue.

Color is scarce and semantic. Large saturated panels, neon accents, cyan-on-black terminal styling, purple/blue gradients, glowing edges, and gradient text are prohibited. Dark mode, if added, must be designed as an equally quiet ink-and-charcoal theme—not the default “hacker terminal” treatment.

#### Researched theme selection: Warm Ledger

The recommended default theme is **Warm Ledger**: warm editorial paper, green-black ink, slate-blue map marks, and three muted condition colors. It combines the calm credibility of financial print with the precision of a modern data instrument. It should feel distinctive in daylight, remain comfortable during long sessions, and avoid the generic black/neon trading-terminal look.

Research basis:

- WCAG 2.2 requires at least 4.5:1 contrast for normal text and 3:1 for meaningful graphics and controls.
- IBM Carbon recommends rich neutrals with deliberate hits of color, sequential color for ordered magnitude, and categorical color only for genuinely separate categories.
- IBM technical-diagram guidance reinforces color with labels, shapes, patterns, or line styles.
- USWDS organizes color by semantic role rather than tying components to literal color names.
- CSS Color 4 describes OKLCH as more perceptually uniform than legacy sRGB/HSL workflows, making it appropriate for generating controlled light/dark scales.

Use role-based tokens in application code. The hex values below are canonical sRGB fallbacks; OKLCH values are the authoring values for controlled variants.

##### Default light theme

| Token | Hex | OKLCH | Use |
|---|---:|---:|---|
| `canvas` | `#F4F1EA` | `oklch(95.9% 0.010 87)` | Primary warm-paper background |
| `surface` | `#FAF8F3` | `oklch(97.9% 0.007 89)` | Inspection rails and selected regions |
| `ink` | `#18211F` | `oklch(23.8% 0.013 180)` | Main text and strongest data marks |
| `ink-secondary` | `#47514E` | `oklch(42.5% 0.014 176)` | Supporting explanations |
| `ink-muted` | `#646D69` | `oklch(52.6% 0.013 167)` | Metadata; tested at 4.73:1 on canvas |
| `rule` | `#D9D5CC` | `oklch(87.4% 0.013 87)` | Decorative hairlines and quiet separators |
| `focus / map` | `#315F78` | `oklch(46.4% 0.065 234)` | Current selection, primary series, focus ring |
| `constructive` | `#2F6B5F` | `oklch(48.4% 0.066 178)` | Supportive condition; 5.49:1 on canvas |
| `caution` | `#8A641F` | `oklch(53.0% 0.097 78)` | Mixed condition/event risk; 4.75:1 |
| `stress` | `#A0443B` | `oklch(50.7% 0.124 28)` | Defensive/stale-critical condition; 5.50:1 |
| `comparison` | `#6F6378` | approximately `oklch(50% 0.04 315)` | Secondary index/source comparison |

Supporting washes are `#DFEBE5` constructive, `#F3E8CE` caution, `#F3DEDA` stress, and `#DEE8EE` informational. Washes are backgrounds only; their paired dark semantic text token must be used for labels.

##### Optional dark theme

Dark mode is **Ink Ledger**, a quiet charcoal translation rather than a neon terminal:

| Token | Hex | Use |
|---|---:|---|
| `canvas` | `#151917` | Main charcoal background |
| `surface` | `#1B201D` | Section distinction |
| `surface-raised` | `#222824` | Selected/inspection state only |
| `ink` | `#E9E7E0` | Main text; 14.34:1 on canvas |
| `ink-secondary` | `#B9BDB7` | Supporting text; 9.32:1 |
| `ink-muted` | `#909992` | Metadata; 6.05:1 |
| `rule` | `#343B37` | Decorative hairlines only |
| `meaningful-axis` | `#606B65` | Required chart/control boundary; 3.20:1 |
| `focus / map` | `#88B4C8` | Primary data and focus |
| `constructive` | `#78B7A7` | Supportive condition |
| `caution` | `#D0A95D` | Mixed condition/event risk |
| `stress` | `#D88176` | Defensive/critical condition |
| `comparison` | `#B5A4C1` | Secondary index/source comparison |

Light mode ships first and remains the visual reference. Dark mode ships only after every visualization has been separately contrast-tested; it must not be produced by mechanically inverting the light palette.

##### Semantic color rules

- `Constructive`, `caution`, and `stress` describe the assessed condition—not automatically price up/down.
- Positive and negative gamma use behavior labels plus solid/dashed or marker differences; they are not simplified into green versus red.
- Current price and the selected data series use `focus / map`, keeping condition colors free for interpretation.
- NDXP versus QQQ and SPXW versus SPY comparisons use primary-versus-comparison styling, not two competing saturated colors.
- Observed values are solid, mapped values are dashed, estimates use a dotted or hatched treatment, and stale data carries an explicit label.
- Sequential magnitude uses lightness steps within one hue. Diverging color is used only around a meaningful neutral midpoint.
- No chart uses more than one focus color plus the condition colors visible for a specific reason.

##### Alternatives considered

| Direction | Decision | Reason |
|---|---|---|
| Pure black + neon green/cyan | Reject | Feels like a generic trading terminal, increases glare, and makes every mark compete for attention. |
| Cool white + corporate blue | Reject as primary | Clean but too generic and sterile for the editorial identity. |
| Pure monochrome | Reject as complete system | Beautiful in static layouts but too slow for scanning regime, caution, and stress states. |
| Warm paper + saturated red/green | Reject | Familiar market convention, but visually loud and too dependent on red/green discrimination. |
| **Warm Ledger** | **Select** | Distinctive, calm, beginner-friendly, and well suited to annotated market maps and long viewing sessions. |

#### Layout and whitespace

- Use an asymmetric editorial grid with one clear reading path.
- Let important visuals breathe; empty space is structural, not unfinished.
- Group tightly within an idea and separate generously between ideas.
- Avoid identical card grids, nested cards, and a rounded rectangle around every block.
- Prefer rules, alignment, whitespace, and subtle surface shifts to container chrome.
- Keep content width deliberately constrained even on wide monitors; optional detail can use an adjacent inspection rail.
- Corners remain crisp or gently rounded, generally 4–12 px. Large pill-shaped containers are prohibited.

#### Surfaces and detail

- Default surfaces are flat with hairline dividers.
- Shadows are absent or extremely diffuse and low opacity; never use floating-dashboard shadows.
- No glassmorphism, bevels, glossy highlights, ornamental grid backgrounds, faux scan lines, or decorative financial imagery.
- Use custom data marks and a small set of consistent, slightly substantial icons. Do not scatter generic thin-line icons beside every label.
- Status badges may be small pills; primary sections, controls, and cards may not.
- Decorative elements are allowed only when they reinforce the map metaphor, such as a restrained coordinate tick, contour line, or registration mark.

#### Chart styling

- Charts should resemble careful editorial diagrams, not default chart-library output.
- Use thin structural axes, strong direct labels, a single emphasized series, muted context series, and generous plot margins.
- Remove unnecessary borders, legends, grid lines, ticks, and controls.
- Important zones may use a very light wash or fine hatching; do not use loud translucent color blocks.
- Annotation placement, typography, and collision handling are part of the design—not an afterthought.
- All chart elements use the same spacing, stroke, radius, label, and semantic-color tokens as the rest of the interface.

#### Motion and interaction feel

- Motion should be almost invisible: a brief fade/translate on page entry and a smooth interpolation when a regime point, price, or selected expiry changes.
- Use motion to preserve spatial understanding when the data changes, never to make the page feel “alive.”
- No bouncing, elastic easing, looping chart animation, glowing pulses, animated backgrounds, or number-counting theatrics.
- Hover, focus, and pressed states should be subtle but unmistakable.
- Respect reduced-motion preferences and keep the interface equally polished without animation.

#### Effortless-quality test

Before accepting a page, remove every nonessential border, label, color, icon, animation, and container. Add back only what improves comprehension, hierarchy, or identity.

The page fails the aesthetic contract if:

- It resembles a generic crypto dashboard, Bloomberg imitation, admin template, or AI-generated bento landing page.
- The visual impact disappears when gradients, shadows, and animation are removed.
- More than one element competes to be the page’s focal point.
- Repeated cards make fundamentally different information look interchangeable.
- “Cool” elements delay comprehension or make a beginner feel the product is not for them.

### Default interaction model

Use progressive disclosure:

1. Start with the current conclusion and the few reasons that explain it.
2. Let the user open a section to see its drivers.
3. Let the user open a driver to see raw history, formula, source, and freshness.

The core navigation must stay limited to four user-facing pages. Source health, configuration, raw data, and calculation diagnostics belong behind utility controls, not in the primary navigation.

### Beginner-first explanation system

Beginner-friendly is the default presentation, not a separate simplified product mode. Each page begins with a compact educational hero that orients the user before showing analytics. This is an in-product explanation of the live situation, not a large marketing banner, onboarding wizard, or generic textbook paragraph.

Every page hero must answer five questions in this order:

1. **What is this page for?** One plain-language sentence.
2. **What is happening now?** The current conclusion in everyday language.
3. **Why does it matter?** The likely market behavior or decision context, stated conditionally.
4. **What is driving it?** The two or three strongest pieces of evidence.
5. **What could change the read?** The nearest invalidation, scheduled event, threshold, or missing confirmation.

The hero may include a small `Learn the terms` control, but it must never force the user into a tutorial before they can use the page. On a first visit, the complete explanation is open. A returning user may collapse the educational detail, and that preference may be remembered locally; the current conclusion, confidence, timestamp, and critical caveat must remain visible.

There is no permanent global `beginner/advanced` fork. The same interface serves both audiences through progressive disclosure:

- Plain-language meaning first.
- Supporting evidence second.
- Exact values, formulas, sources, history, and caveats one level deeper.
- Raw diagnostics only when explicitly requested.

#### Page-specific educational heroes

| Page | Hero question | Required explanation |
|---|---|---|
| **Today** | **What kind of market is this today?** | Define the current regime in one sentence; explain whether conditions favor trend, mean reversion, selective dip buying, or defense; identify the next event or condition that could change the read. |
| **Structure** | **Where could NQ or ES react?** | Explain walls, gamma state, mapped index-to-futures levels, source confluence, and expiry in context. State clearly that levels are reaction zones and probabilities, not guaranteed support or resistance. |
| **Regime** | **What is driving the market environment?** | Explain the current growth/inflation quadrant and the policy, liquidity, stress, volatility, and positioning overlays. Translate labels such as `Goldilocks` or `stagflation` immediately into plain language. |
| **History** | **How have similar setups behaved?** | Explain that the page shows conditional history, not a forecast. Always include sample size, time window, dispersion, and any reason the current setup may differ. |

Example Regime hero:

> **Disinflationary expansion — generally constructive, with a rates caveat.** Growth is holding up while inflation pressure is cooling, which has historically been a friendlier backdrop for risk assets. Real yields are rising, however, so long-duration technology may have less room for error. Confidence is moderate because credit and liquidity agree, while rates do not.

Example Structure hero:

> **NQ is between nearby support and resistance zones.** NDXP positioning maps to support near 23,100 and resistance near 23,350. Positive gamma can encourage mean reversion between those areas, but CPI tomorrow makes either wall less dependable than it would be on a quiet session.

#### Glossary and just-in-time definitions

Maintain one versioned glossary registry used by every page, tooltip, formula drawer, and explanation. On first occurrence, spell out an acronym and provide a short inline definition. Use an unobtrusive info affordance or dotted underline; do not cover the interface in help icons.

At minimum, define:

- Regime, growth/inflation quadrant, confidence, and divergence.
- Gamma, positive gamma, negative gamma, zero gamma / gamma flip, call wall, put wall, and confluence.
- NDXP, NDX, QQQ, SPXW, SPX, SPY, NQ, and ES, including settlement and mapping differences where relevant.
- Real yield, yield curve, breakeven inflation, credit spread, liquidity proxy, breadth, and positioning.
- COT, VIX, VXN, VVIX, SKEW, MOVE, and event risk.

Each glossary entry contains:

- A one-sentence definition.
- Why it matters on this page.
- The most common beginner misinterpretation.
- An optional deeper explanation with formula/source links.

A searchable glossary drawer is globally accessible, keyboard accessible, and returns the user to the exact context where it was opened.

#### Plain-language copy contract

Every important explanation separates three layers:

1. **Observed fact:** `10y real yield rose 18 basis points over five sessions.`
2. **Interpretation:** `Financial conditions tightened through rates.`
3. **Possible implication:** `That can be a headwind for rate-sensitive growth stocks if the move persists.`

Never present the interpretation as if it were the observation. Always identify the comparison window and units. Translate terse terminal notation:

- Avoid: `HY OAS +18 bp`.
- Prefer: `High-yield credit spreads widened 18 basis points this week, a mild deterioration in credit conditions.`

Avoid unexplained jargon, unexplained acronyms, and absolute language such as `guaranteed support`, `will bounce`, or a standalone `bullish/bearish`. Prefer calibrated phrases such as `historically supportive`, `raises the chance`, `weakens the level`, or `confidence is reduced because...`.

Confidence must be explained, not merely scored:

> **Moderate confidence** — 92% of required inputs are fresh and credit agrees with liquidity, but rising real yields conflict with the otherwise constructive regime.

Educational empty and error states must also explain what happened:

- `No new COT report yet — the CFTC normally publishes Tuesday positions on Friday. The prior reading remains visible and is marked stale.`
- `QQQ confirmation is unavailable. NDXP structure is still shown, but cross-market confluence cannot be assessed.`
- `A release was revised. Today's regime uses the value that was available at the snapshot time; open History to compare revisions.`

### Visual explanation system

V3 should communicate through visuals whenever shape, distance, direction, sequence, agreement, or uncertainty is easier to understand visually than in prose. Text explains the conclusion; the visual lets the user see why it is true.

The interface must not become a wall of charts. Every visual needs a documented question and a clear reading order:

1. A plain-language title phrased as the question it answers.
2. The visual conclusion, annotated directly on the chart where possible.
3. One short `How to read this` sentence for beginners.
4. A source, as-of time, and confidence/freshness state.
5. Deeper values, methodology, and controls only on interaction.

Avoid decorative sparklines, generic gauge collections, unlabeled heatmaps, 3D charts, dual axes unless unavoidable, and repeated mini-charts that encode no decision-relevant information. Prefer direct labels over legends and annotations over forcing users to match colors.

#### Shared visual grammar

- **Position** communicates market level, distance, or ranking.
- **Length** communicates magnitude.
- **Direction** communicates improvement/deterioration or acceleration/deceleration.
- **Opacity** communicates confidence or data completeness, never importance alone.
- **Texture or line style** distinguishes observed values, mapped values, estimates, and stale values.
- **Color** communicates condition consistently across the entire app, but is always paired with a label, icon, line style, or pattern.
- **Motion** only shows a meaningful change, transition, or relationship; it is not ambient decoration.

Use a restrained, color-vision-safe palette:

- Constructive/supportive: muted blue-green.
- Caution/mixed: warm ochre.
- Defensive/stressed: muted vermilion.
- Neutral/reference: ink and cool stone.
- Estimated or mapped: dashed line.
- Stale: lowered contrast plus an explicit `stale` label.

Positive gamma does not automatically share the same color as bullish price action, and negative gamma does not automatically mean bearish. The labels describe expected market behavior, not direction.

All charts must support keyboard focus, a textual summary, high-contrast mode, reduced motion, and a non-color encoding. Hover-only information is prohibited; touch and keyboard users receive the same detail.

#### Today page visuals

The Today page uses no more than three primary visuals at once:

1. **Market environment map**
   - A compact growth × inflation quadrant with the current regime visibly located.
   - Policy, liquidity, and stress appear as small directional overlays around the point rather than separate gauges.
   - A short annotation translates the position: `Growth holding up + inflation cooling`.

2. **NQ / ES structure strips**
   - Horizontal price maps showing current futures price, mapped gamma flip, nearest call/put walls, confluence, and distance in points/percent.
   - Zones have width when uncertainty exists; never imply false precision with a hairline.
   - NDXP/QQQ and SPXW/SPY contributions can be inspected, but the default view shows one coherent mapped structure.

3. **Event runway**
   - A calm horizontal timeline for the next several sessions with only market-relevant releases, expiries, auctions, and known risk windows.
   - Proximity and expected impact are visible without a dense calendar.

If one visual has no meaningful information that day, remove it and let the remaining composition breathe. Do not backfill the space.

#### Structure page visuals

The dominant visual is an annotated **price landscape**, not a conventional options-chain table:

- Current NQ or ES price is the visual anchor.
- Put wall, call wall, gamma flip, secondary concentrations, and mapped confluence appear as labeled reaction zones.
- A compact profile behind the price axis shows relative gamma concentration by level without overwhelming the map.
- Expiry is encoded by a selectable ribbon or layering control: `0DTE`, `1–5D`, `monthly`, `all`.
- Observed index levels and futures-mapped levels are visually distinct.
- Distance, strength, freshness, event risk, and historical hold rate are available when selecting a level.

Secondary visual modes:

- **Exposure profile:** signed gamma exposure by strike with zero and spot clearly marked.
- **Expiry composition:** how much relevant exposure comes from 0DTE, near-term, and monthly expirations.
- **Confluence view:** where NDXP/NDX/QQQ or SPXW/SPX/SPY independently cluster after mapping.
- **Level history:** movement and persistence of a selected wall through recent snapshots.

Only one mode is dominant at a time. Switching modes changes the central visual instead of stacking four charts vertically.

#### Regime page visuals

The Regime page uses a visual narrative from cause to market transmission:

1. **Growth × inflation map:** current point, recent trail, quadrant boundaries, and uncertainty radius.
2. **Driver flow:** policy, liquidity, credit, volatility, breadth, and positioning flow toward the overall regime conclusion. Line emphasis shows which drivers actually matter now.
3. **Pillar change tracks:** short, shared-axis histories for the few active drivers, annotated at releases or regime transitions.
4. **Agreement/divergence view:** shows which signals confirm the regime and which conflict with it.

Do not reduce macro conditions to six speedometer gauges. A beginner should be able to trace `data changed → pillar changed → regime interpretation changed`.

#### History page visuals

History should make uncertainty and conditional evidence visible:

- **Regime timeline:** colored periods with transitions, major events, and snapshot/revision markers.
- **Similar-setup distribution:** outcome distribution or range rather than only an average return.
- **Wall outcome path:** normalized paths showing hold, break, reclaim, and failure behavior around comparable levels.
- **Transition matrix:** the historical frequency of moving from one regime to another, shown only when the sample supports it.
- **Sample-quality panel:** sample count, date coverage, dispersion, missingness, and important differences from today.

Never show a backtest equity curve without assumptions, drawdowns, sample periods, and out-of-sample separation nearby.

#### Beginner interactions for visuals

- The first view shows two or three annotations, not every data label.
- Selecting any visual element opens an anchored explanation: `what it is`, `why it matters`, `current reading`, and `common mistake`.
- `Show me` walkthroughs may highlight the visual in three short steps, but remain optional and replayable.
- A `Read as text` action provides the same conclusion and critical numbers in plain language.
- Zoom, pan, date-range, and advanced overlays appear only when the visual genuinely needs them.
- Transitions between snapshots may animate briefly to show what moved; reduced-motion users receive an immediate state change.

### Page map

| Page | Single job | Default content | Explicitly does **not** show |
|---|---|---|---|
| **Today** | Answer “what environment am I trading today?” | Regime sentence, confidence, event countdown, equity dip regime, NQ/ES structure snapshots, 3–5 active risks/supports | Full macro tables, every ticker, raw source data |
| **Structure** | Answer “where are the important NQ/ES levels?” | NQ and ES switcher; mapped NDXP/NDX/QQQ or SPXW/SPX/SPY levels; gamma state; expiry lens; concise wall context | Macro-card grid, long economic histories |
| **Regime** | Answer “why is the environment classified this way?” | Growth/inflation quadrant; policy, liquidity, stress, volatility, positioning drivers; transmission/divergence flags | Options-chain detail, unrelated technical indicators |
| **History** | Answer “has this setup mattered before?” | Regime transitions, archived daily snapshots, wall outcomes by regime, source/revision timeline | Live-day clutter, every raw observation |

### Today page — the required daily briefing

The Today page is the product. All other pages are supporting evidence.

It should contain only the following, in order:

1. **One-sentence read**

   Example:

   > Selective dip-buying environment: credit is calm and liquidity is stable, but real yields are rising and a CPI release is tomorrow.

2. **Three-state summary**

   - NQ structure: supportive / mixed / fragile.
   - ES structure: supportive / mixed / fragile.
   - Equity dip regime: constructive / selective / defensive.

3. **Immediate event risk**

   A single compact line, only if relevant: `CPI in 18h · high event risk`.

4. **The 3–5 things that matter now**

   Plain-language observations, ranked by impact. For example:

   - `NDXP remains positive gamma below 23,100; QQQ put-wall confluence is nearby.`
   - `10y real yield has risen 18 bp in five sessions.`
   - `HY spreads are still calm; stress confirmation is absent.`

5. **Minimal NQ and ES level strips**

   A horizontal price context for each instrument showing only current price, gamma flip, nearest call wall, nearest put wall, and their distance. Selecting one opens Structure.

6. **One expandable “What changed?” section**

   Show only changes since the prior snapshot: regime change, wall movement, fresh macro release, new divergence, or a source becoming stale.

If nothing changed, say so. Do not fill the space with redundant analytics.

### Structure page

This is a focused level-analysis page, not a full options terminal.

#### Persistent controls

- Instrument switch: `NQ` / `ES`.
- Expiry lens: `0DTE`, `1–5D`, `monthly`, `all`.
- View mode: `Levels` by default; `Exposure` and `History` are secondary.

#### NQ source hierarchy shown in the UI

- NDXP: primary PM/daily and 0DTE structure.
- NDX: AM-settled structural positioning.
- QQQ: separate ETF-flow confirmation.

#### ES source hierarchy shown in the UI

- SPXW: primary PM/daily and 0DTE structure.
- SPX: AM-settled structural positioning.
- SPY: separate ETF-flow confirmation.

#### Layout rules

- One dominant price map, not several competing charts.
- Plot no more than the six most relevant mapped levels by default.
- Confluence appears as a single label, e.g. `NDXP + QQQ support confluence`, rather than duplicated lines.
- Raw gamma-by-strike is an expandable analytical view.
- Every level must have a nearby plain-language context line: `Positive gamma, calm credit, no event today: mean reversion conditions are comparatively favorable.`

### Regime page

This page explains the current conclusion in a causal order:

1. Growth and inflation quadrant.
2. Policy, real yields, and liquidity.
3. Credit, volatility, and stress.
4. Positioning and cross-asset transmission.
5. Current divergences and upcoming invalidation events.

Display each pillar as one sentence, one directional meter, and up to three supporting drivers. A user opens the pillar only when they need the component table.

Example:

> **Liquidity: mildly supportive** — Fed net-liquidity impulse is positive, but Treasury supply increases next week.

Do not use six equal-size tiles. The active drivers should receive more space; quiet/unchanged pillars collapse to one line.

### History page

History exists to establish trust, not to imitate a charting platform.

Default modules:

- Regime timeline with clearly labelled changes.
- “What happened after similar conditions?” summary with sample size.
- Wall hold/break/reclaim outcomes by regime and event state.
- Snapshot/revision timeline.

All deeper research, raw time series, and downloaded-data inspection remain one click deeper.

### Equity dip regime

This is a shared market backdrop, not a stock scanner or recommendation engine. The separate Equity Desk is exploratory company research, not a recommendation engine.

It answers only:

> Is this generally a constructive, selective, or defensive environment for buying dips in quality stocks?

Inputs are grouped into five ideas:

- Risk appetite / fear and greed.
- Trend and breadth.
- Credit and liquidity.
- Volatility and hedging.
- Macro and event risk.

Display only the final state and the two or three reasons driving it. Individual stock selection remains outside the macro overlay's scope.

### Fear-and-greed presentation

Build a transparent `GEXLab Risk Appetite` score rather than reproducing a third-party branded score or scraping its number.

- Scale: 0–100.
- Labels: `Extreme fear`, `Fear`, `Neutral`, `Greed`, `Extreme greed`.
- Show the component count and confidence beside the score.
- Treat it as a contrarian/contextual input, never as a standalone buy signal.

On the Today page, this appears as a short phrase, such as:

> Risk appetite: **Fear (28/100)** — volatility and put demand are elevated, while credit remains stable.

The component breakdown belongs on Regime, not Today.

### Responsive behavior

- Desktop: Today is a vertical briefing with a right-side, non-sticky context rail only for event risk and freshness.
- Tablet: stack the context rail below the briefing.
- Mobile: one-column sequence; Structure uses a horizontally scrollable price map with a selected-level detail sheet.
- Never hide the current regime, event risk, or nearest major level on smaller screens.

### Acceptance criteria for the UX

- A first-time user can identify the current regime, NQ/ES structure state, equity dip regime, and next high-impact event in under 20 seconds.
- After reading a page hero, a first-time user can explain in their own words what the page measures, why the current state matters, and what could change it.
- Every page answers `what is it?`, `what is happening?`, `why does it matter?`, and `what could invalidate it?` before exposing raw detail.
- No acronym or specialist term appears without an accessible definition on first occurrence.
- Collapsing educational detail never hides the current conclusion, confidence, material event risk, freshness warning, or non-guarantee caveat.
- Every primary conclusion that depends on distance, trend, distribution, sequence, or agreement has a purposeful visual representation.
- A first-time user can correctly describe how to read each primary visual without opening methodology documentation.
- No page displays more than one dominant visual at a time, and Today displays no more than three primary visuals.
- Every chart has direct labels, an as-of time, freshness/confidence context, a plain-language reading aid, and an equivalent text summary.
- No insight requires color perception, hover, animation, or precise pointer control.
- Each page has one unmistakable focal point and passes the effortless-quality test with motion and shadows disabled.
- The interface remains visually distinctive using only typography, spacing, composition, semantic color, and the market-cartography visuals.
- Generic dashboard treatments—identical card grids, neon-on-dark styling, glass panels, heavy shadows, and decorative sparklines—do not ship.
- The Today page contains no dense data table and no more than five primary observations.
- Each page can be described with one sentence and does not duplicate another page’s job.
- A metric’s raw value, formula, source, and caveat are available within two interactions.
- Optional/stale data never creates a confusing empty card; it collapses into a concise status note.
- Every added dashboard element must answer a documented question. If it cannot, it belongs in History, diagnostics, or not at all.

## 4. Target V3 dashboard

### 4.1 Header

- As-of timestamp in ET.
- Market date / prior session date.
- NQ reference price, NDX reference price, and NQ–NDX basis if available.
- Data health: `Healthy`, `Degraded`, or `Stale`.
- Upcoming high-impact event countdown.
- Regime confidence: 0–100.

### 4.2 Regime summary strip

Show eight independently scored pillars:

| Pillar | Labels | Meaning |
|---|---|---|
| Growth | Accelerating / neutral / slowing | Economic activity impulse |
| Inflation | Cooling / stable / re-accelerating | Underlying price-pressure impulse, including sticky-price CPI and trimmed-mean PCE |
| Policy & rates | Easing / neutral / tightening | Real-rate and curve pressure |
| Liquidity | Expanding / neutral / contracting | System-liquidity impulse |
| Labor breadth | Firming / mixed / loosening | Temp help, quits, hours, and openings per unemployed — the margins that turn before payrolls |
| Credit channel | Open / mixed / rationed | Lending standards and credit quantity, as distinct from the price of credit in spreads |
| Financial stress | Calm / elevated / stressed | Credit, funding, and volatility conditions |
| Positioning | Underowned / neutral / crowded | Futures and options crowding |

Any pillar whose inputs are unavailable is excluded from pillar agreement rather than scored at a default.

The primary regime name comes from the growth × inflation quadrant:

| Growth | Inflation | Regime label |
|---|---|---|
| Rising | Falling | Disinflationary expansion / Goldilocks |
| Rising | Rising | Reflation / overheating |
| Falling | Rising | Stagflation |
| Falling | Falling | Disinflationary slowdown |
| Mixed or weak confidence | Mixed | Transitional |

Never display the quadrant without the policy, liquidity, and stress overlays.

### 4.3 Options-structure panel

- NDX and NDXP shown separately; never merge AM-settled NDX and PM-settled NDXP expirations without a label.
- Zero-gamma price from a full scenario calculation.
- Major call wall, put wall, gamma flip, and concentrations by expiry bucket.
- 0DTE / 1–5D / monthly / longer-dated segmentation.
- NQ-mapped levels with basis and mapping timestamp.
- Current gamma state: positive / transition / negative.
- “Wall context” explanation driven by regime and event-risk overlays.

### 4.4 Macro and transmission panels

- TF-01 US Macroeconomics.
- TF-02 Yield Rates.
- TF-03 COT Positioning.
- TF-04 Transmission Check.
- TF-05 Geopolitics / uncertainty.
- TF-06 Volatility.
- News tone & attention.
- Treasury supply / primary dealer panel.
- Market breadth / leadership panel.
- Event calendar.

### 4.5 Explainability drawer

For any score/card, show:

- Raw value and units.
- Previous value.
- Change over relevant lookback.
- Percentile and robust z-score.
- Exact formula.
- Direction convention.
- Observation date and release timestamp.
- Source URL / source name.
- Whether data is preliminary, revised, stale, or substituted.

## 5. Data-source architecture

### 5.1 Source tiers

#### Tier A — direct official/public source; required for core regime

- Federal Reserve Board: H.4.1, H.8, H.15, Z.1, G.17, releases and calendars.
- Federal Reserve Bank of New York Markets API: EFFR, SOFR, repo reference rates, operations, primary-dealer statistics.
- U.S. Treasury Fiscal Data API: TGA, debt, auctions, issuance.
- Treasury yield-curve CSV/XML.
- Bureau of Labor Statistics: public flat files and API v1.
- Bureau of Economic Analysis: bulk CSV/XLS/ZIP tables and releases.
- CFTC: Commitment of Traders reports.
- Cboe: published historical volatility-index CSVs.
- Chicago Fed: NFCI, ANFCI, CFNAI downloads.
- Philadelphia Fed: ADS index, historical real-time vintages.
- Cleveland Fed: median CPI, trimmed CPI, yield-curve data.
- Dallas Fed: trimmed-mean PCE.
- PolicyUncertainty.com: EPU/GEPU/EMV data files.

#### Tier B — accessible but not a formal anonymous API; cache and monitor

- FRED graph CSV export for difficult-to-source series such as ICE BofA OAS and selected aggregates.
- Nasdaq website data endpoint for EOD index/ETF closes and ratio calculations.
- Static official web downloads where no supported REST API exists.

#### Tier C — optional enrichments; never block the core regime

- GDELT legacy public endpoint for news tone and attention.
- FINRA public short-sale-volume files.
- Stooq or another no-account EOD fallback only if Nasdaq market-price data fails.

#### Excluded from the core no-account build

- Formal FRED API (requires registration/key).
- BEA API (requires registration/key); use bulk downloads instead.
- Real-time full OPRA, CME, or Nasdaq market data.
- Licensed consensus/surprise feeds.
- ICE MOVE feed.
- Scraped Yahoo Finance / `yfinance`.

### 5.2 Adapter contract

Every source adapter implements:

```ts
type SourceFetchResult<T> = {
  source: string;
  sourceUrl: string;
  retrievedAt: string;           // ISO-8601 UTC
  sourcePublishedAt?: string;    // ISO-8601 UTC when known
  status: 'fresh' | 'stale' | 'partial' | 'failed';
  values: T[];
  rawPayloadHash: string;
  warnings: string[];
};
```

Required behaviors:

- HTTP timeout, retry with exponential backoff, and explicit rate limiting.
- Conditional requests where supported (`ETag`, `Last-Modified`).
- Persist raw payload before parsing.
- Validate expected columns/schema before promoting a retrieval to `fresh`.
- Preserve last known-good value on source failure but mark it stale.
- Emit source-specific telemetry: latency, parse failures, schema drift, and staleness.

### 5.3 Canonical observation contract

```ts
type Observation = {
  seriesId: string;
  value: number | null;
  unit: string;
  frequency: 'intraday' | 'daily' | 'weekly' | 'monthly' | 'quarterly';
  observationDate: string;       // reference period, not necessarily availability
  releasedAt?: string;           // when public information became usable
  retrievedAt: string;
  vintageId?: string;
  source: string;
  sourceUrl: string;
  preliminary?: boolean;
  revisionFlag?: boolean;
  quality: 'fresh' | 'stale' | 'estimated' | 'partial';
};
```

## 6. Data inventory and calculations

All score directions below are defined so positive is more supportive for NQ unless explicitly labelled as a risk score.

### 6.1 TF-00 — News tone & attention

#### Instruments

- Aggregate market news.
- S&P 500.
- Nasdaq Composite / Nasdaq-100 / large-cap technology.
- WTI crude, gold, copper, DXY, HYG, TLT, silver, natural gas.

#### Source

GDELT legacy public DOC interface, with constrained query definitions stored in version control. Example query families must use aliases, exclusions, and English-language filters where applicable.

#### Features

- Mean article tone over 24h, 72h, and 7d.
- Article count / attention percentile.
- Tone change versus 20-day baseline.
- Positive/negative article share.
- Source diversity count.
- Confidence = function of article count, source diversity, and query quality.

#### Important limitations

- This is general language tone, not a finance-trained return forecast.
- Article tone is measured at the full-article level, not necessarily the asset mention.
- Do not map `+0.70` directly to “70% bullish.”
- Dashboard label must be **News Tone & Attention**, not definitive market sentiment.

### 6.2 TF-01 — US macroeconomics

| Card | Preferred source | Core calculation |
|---|---|---|
| H.4.1 Fed balance sheet | Fed Board H.4.1 | Total assets, 4w/13w changes |
| SOFR / EFFR / IORB | NY Fed Markets + Fed Board H.15 | Levels, SOFR-EFFR spread, rate impulse |
| HY OAS | FRED graph CSV, ICE BofA series | Level, 5d/20d change, percentile |
| IG OAS | FRED graph CSV, ICE BofA series | Level, 5d/20d change, percentile |
| CPI / core CPI | BLS CU flat files | YoY, 3m/6m annualized, inflation impulse |
| Core PCE | BEA bulk NIPA files | YoY, 3m/6m annualized |
| Unemployment | BLS LN files | 3m average, 3m/6m change, Sahm gap |
| Nonfarm payrolls | BLS CES files | 1m change, 3m avg, 6m avg, diffusion |
| Initial jobless claims | DOL/FRED export fallback | 4w average, YoY, percentile |
| Real GDP | BEA bulk NIPA | YoY, q/q annualized, revisions |
| M2 | Fed/FRED export fallback | YoY, 3m annualized |
| RRP | NY Fed Markets or Fed H.4.1 | Level and 4w/13w change |
| Net liquidity proxy | Derived | Fed assets − TGA − ON RRP |
| TGA | Treasury Fiscal Data API | Level and 5d/20d change |
| Reserve balances | Fed H.4.1 | Level and weekly change |
| Retail sales | Census release/FRED fallback | Nominal YoY and CPI-deflated momentum |
| Housing starts | Census/HUD release | YoY, 3m moving average |
| Industrial production | Fed G.17 | YoY, 3m annualized |
| Consumer sentiment | UMich via FRED CSV | Level, 3m change; show licensed/delayed status |

#### Required formulas

Monthly annualized rate for an index/level:

```text
annualized_change(k months) = 100 * ((x_t / x_(t-k)) ^ (12 / k) - 1)
```

Inflation impulse:

```text
inflation_impulse = 3m_annualized_core_inflation - 12m_core_inflation
```

Sahm gap:

```text
sahm_gap = avg(unemployment, 3 months)
           - min(avg(unemployment, 3 months) over previous 12 months)
```

Net liquidity proxy, normalized to billions:

```text
net_liquidity = fed_total_assets - treasury_general_account - overnight_reverse_repo
```

The UI must describe this as a **market-liquidity proxy**, not literal cash available to buy equities.

### 6.3 TF-02 — yield rates and policy transmission

| Card | Source | Calculation |
|---|---|---|
| 2y / 10y / 30y nominal yields | Treasury daily curve | Level and 5d/20d/60d bp change |
| 10y−2y and 10y−3m spread | Derived | Difference in percentage points, slope impulse |
| 5y/10y breakevens | Treasury/FRED fallback | Level and change |
| 5y5y forward inflation | Derived from breakevens / FRED fallback | Level and change |
| 10y real yield | Treasury real curve / TIPS | Level and momentum |
| Real policy rate | Derived | EFFR − core PCE YoY |
| Term premium | NY Fed ACM dataset | Level and 20d/60d change |
| Treasury futures COT | CFTC TFF reports | Trader-group net as % open interest |

5y5y forward approximation:

```text
five_year_five_year_forward = ((1 + BE10)^10 / (1 + BE5)^5)^(1/5) - 1
```

where `BE10` and `BE5` are decimal ten-year and five-year breakevens. Label it as an approximation if inputs differ from the provider’s official convention.

### 6.4 TF-03 — COT positioning

#### Contracts

- S&P 500 futures (ES).
- Nasdaq-100 mini futures (NQ; CFTC code 209742).
- 2y, 5y, and 10y Treasury futures.
- Gold, crude oil, copper, silver, natural gas.
- U.S. Dollar Index futures.
- VIX futures.

#### Required outputs per contract

- Dealer/intermediary net.
- Asset-manager/institutional net.
- Leveraged-fund net.
- Other-reportables net.
- Net position as % of open interest.
- Weekly delta.
- 52-week, 156-week, and full-history percentile.
- Crowding flag only when level and weekly change agree.

#### Rules

- Use the CFTC report format appropriate to the contract: Traders in Financial Futures for financial contracts, disaggregated/legacy formats only where necessary.
- Record Tuesday `observationDate` and Friday `releasedAt` separately.
- Never call COT current-day positioning.
- Do not combine Mini NQ and Micro NQ without notional normalization and a visible methodology note.

### 6.5 TF-04 — transmission check

| Card | Source / dependency | Calculation |
|---|---|---|
| NFCI / ANFCI | Chicago Fed | Level, 4w change, percentile |
| 10y real yield | Treasury real curve | Level and impulse |
| Broad dollar | Fed/FRED fallback | Level and 5d/20d/60d change |
| Copper/gold ratio | Commodity price adapter | Copper close / gold close |
| Gold/silver ratio | Commodity price adapter | Gold close / silver close |
| Crude/natural-gas ratio | Commodity price adapter | WTI close / natgas close |
| HYG/LQD ratio | Nasdaq EOD adapter | HYG close / LQD close |
| RSP/SPY ratio | Nasdaq EOD adapter | RSP close / SPY close |
| SMH/SPY ratio | Nasdaq EOD adapter | SMH close / SPY close |
| Defense/market ratio | Nasdaq EOD adapter | ITA or XAR close / SPY close |

For every ratio, calculate:

```text
ratio_return_20d = ratio_t / ratio_(t-20) - 1
ratio_return_60d = ratio_t / ratio_(t-60) - 1
ratio_percentile = percentile(ratio_t, 252 trailing observations)
```

#### Divergence engine

Create explicit flags rather than forcing these series into the core regime score:

- NQ/NDX rising while HY OAS widens materially.
- NQ/NDX rising while 10y real yield rises materially.
- Equity volatility falling while VVIX rises.
- Positive gamma while financial conditions and liquidity deteriorate.
- Gold and DXY both rising.
- Oil rising while copper/gold falls.
- Cap-weight NQ rising while equal-weight/breadth deteriorates.

Each flag shows the two inputs, lookback, threshold, and historical frequency.

### 6.6 TF-05 — uncertainty and geopolitical risk

| Card | Source | Notes |
|---|---|---|
| US Economic Policy Uncertainty | PolicyUncertainty daily CSV | Level, percentile, 20d change |
| Global Economic Policy Uncertainty | PolicyUncertainty data file | Level and percentile |
| Equity Market Uncertainty | PolicyUncertainty data file | Level and percentile |
| Defense / market ratio | Nasdaq EOD adapter | Optional; not a direct geopolitical measure |
| News tone & attention | GDELT | Contextual only |

Avoid assigning a simplistic “bullish/bearish” sign to geopolitical uncertainty. It is a volatility and distributional-risk overlay. Its relationship to NQ direction is conditional on energy, dollar, rates, and policy response.

### 6.7 TF-06 — volatility

| Card | Source | Calculation |
|---|---|---|
| VIX | Cboe CSV | Level, percentile, change |
| VXN | Cboe CSV | Nasdaq implied-vol level and percentile |
| VIX term structure | Cboe VIX9D/VIX/VIX3M | VIX9D/VIX and VIX/VIX3M |
| VVIX | Cboe CSV | Vol-of-vol level and percentile |
| SKEW | Cboe source/FRED fallback | Tail-risk pricing percentile |
| OVX | Cboe CSV | Oil-volatility context |
| GVZ | Cboe CSV | Gold-volatility context |
| Treasury vol proxy | Treasury yield curve | See formula below |
| NDX realized vol | NDX EOD price adapter | 5d/20d/60d annualized realized vol |
| Volatility risk premium | Derived | VXN − NDX 20d realized vol |

Treasury volatility proxy:

```text
for each tenor in {2y, 5y, 10y, 30y}:
  tenor_vol_20d = stdev(daily_change_in_yield_bp, 20 days) * sqrt(252)

treasury_vol_proxy = weighted_mean(tenor_vol_20d)
```

This is intentionally not named MOVE. MOVE is proprietary; the proxy is transparent and independently reproducible.

### 6.8 Treasury supply and market-functioning panel

#### Inputs

- Treasury auction schedule and announced sizes.
- Auction results: bid-to-cover, indirect bidder share, high yield.
- Treasury buyback schedule/results.
- Daily TGA change.
- Primary-dealer positions, transactions, financing, and settlement fails.
- Quarterly refunding announcement.

#### Features

- Net coupon issuance in next 5, 10, and 20 trading days.
- Auction-day and settlement-day event flags.
- Auction bid-to-cover percentile by tenor.
- Dealer net Treasury inventory percentile.
- Treasury financing stress / repo activity trend.
- Settlement-fails percentile.
- Supply-absorption risk overlay.

Do not calculate an auction “tail” without a reliable when-issued benchmark. If a when-issued source is unavailable, show bid-to-cover and indirect participation only.

### 6.9 Market breadth and leadership panel

Depends on the Nasdaq EOD price adapter and an internally stored NDX constituent universe.

#### Outputs

- NDX constituents above 20d, 50d, and 200d moving averages.
- Advance/decline breadth for NDX constituents.
- New 20d/52w highs and lows.
- Equal-weight versus cap-weight performance.
- Top-10 contribution / concentration proxy.
- Semiconductor vs software vs broad-Nasdaq relative performance.
- Leadership persistence: count of names responsible for positive index return.

Use this as transmission confirmation. A cap-weight NDX rally with weak breadth should reduce confidence in a broad risk-on label.

### 6.10 FINRA short-volume context

#### Instruments

- QQQ and SPY.
- NDX mega-cap names.
- Semiconductor leaders.

#### Features

- Off-exchange short volume / total reported volume.
- 5d and 20d moving average.
- Percentile and abnormal-volume flag.

#### Required disclaimer

FINRA daily short-sale volume is off-exchange reported trading volume. It is not consolidated exchange volume, is not a short-interest position, and includes market-making mechanics. It can provide flow context; it cannot establish directional short conviction by itself.

## 7. Feature engineering and normalization

### 7.1 Alignment

Raw data remains at its native frequency. Build a daily end-of-day feature frame by carrying a value forward only after its known `releasedAt` time.

Example: June CPI is a June reference-period observation, but it cannot influence a July 1 feature frame if the release occurred July 15.

### 7.2 Standard transformations

- Level.
- 1d / 5d / 20d / 60d / 13w change where frequency allows.
- YoY.
- Annualized 3m/6m changes for monthly series.
- Percentile over 1y/3y/5y / expanding history as appropriate.
- Robust z-score.
- Directional score.

Robust z-score:

```text
robust_z = (x - rolling_median(x)) / (1.4826 * rolling_MAD(x))
```

Winsorize extreme inputs only in the scoring layer; preserve raw data untouched.

### 7.3 Score function

```text
component_score = clamp(tanh(robust_z / scale), -1, +1)
```

`scale` is configured by series and documented in the UI. Direction is inverted for negative-risk inputs, e.g. widening credit spreads, rising real yields, or rising stress.

### 7.4 Pillar score construction

Use a weighted median or trimmed mean of component scores, not a raw sum. This prevents one bad/revised series from dominating a pillar.

Every pillar additionally outputs:

- Coverage: share of expected components available and fresh.
- Agreement: share of components with the same directional sign.
- Freshness: weighted age relative to release schedule.
- Confidence: coverage × agreement × freshness × boundary distance.

## 8. Regime engine

### 8.1 Growth score

Candidate components:

- ADS.
- CFNAI / CFNAI-MA3.
- Payroll 3m average change.
- Unemployment-rate change / Sahm gap.
- Jobless-claims trend.
- Industrial-production momentum.
- Real retail-sales momentum.
- Hours worked / payroll diffusion.

### 8.2 Inflation score

Candidate components:

- Core CPI 3m/6m annualized.
- Core PCE 3m/6m annualized.
- Median CPI.
- Trimmed-mean CPI and PCE.
- Wage growth.
- 5y/10y breakeven momentum.
- Commodity inflation impulse (lower weight).

### 8.3 Policy and rates score

Candidate components:

- Real policy rate.
- 2y yield momentum.
- 10y real-yield momentum.
- Curve slope and slope impulse.
- Term-premium change.
- Policy-rate / SOFR stress spreads.

### 8.4 Liquidity score

Candidate components:

- 4w/13w net-liquidity-proxy change.
- TGA change (inverted).
- ON RRP change (inverted, but dynamically downweighted near zero).
- Reserve-balance growth.
- Bank-credit growth.
- Treasury supply/buyback overlay.

### 8.5 Financial-stress score

Candidate components:

- NFCI and ANFCI.
- HY OAS and IG OAS levels/impulses.
- SOFR–EFFR spread.
- VIX/VXN percentile.
- VVIX percentile.
- VIX term-structure inversion.
- Treasury-volatility proxy.
- Primary-dealer fails / funding indicators.

Higher stress is a negative NQ environment by convention, but the UI must distinguish “high volatility with liquidity response” from “high volatility with tightening credit.”

### 8.6 Positioning score

Candidate components:

- NQ leveraged-fund net and weekly delta.
- NQ asset-manager net and weekly delta.
- Treasury futures positioning.
- VIX futures positioning.
- NDX/NDXP gamma sign, concentration, and wall distance.
- Put/call-volume context where available.

### 8.7 Classification logic

Initial rule-based output:

```text
if growth > +threshold and inflation < -threshold:
  macro_quadrant = 'disinflationary expansion'
elif growth > +threshold and inflation > +threshold:
  macro_quadrant = 'reflation / overheating'
elif growth < -threshold and inflation > +threshold:
  macro_quadrant = 'stagflation'
elif growth < -threshold and inflation < -threshold:
  macro_quadrant = 'disinflationary slowdown'
else:
  macro_quadrant = 'transitional'
```

Then append overlays:

```text
{macro_quadrant}
· {liquidity_state}
· {policy_state}
· {stress_state}
· {volatility_state}
· {positioning_state}
```

Example:

```text
Disinflationary expansion · liquidity contracting · real yields rising
· credit calm · negative NDXP gamma · high event risk
```

### 8.8 Optional statistical model — later phase

After sufficient stored data and a release-aware backtest framework exist:

- Hidden Markov model with 4–6 states.
- Change-point detection on standardized macro/market features.
- Walk-forward multinomial/logistic calibration of regime probabilities.
- Cluster stability and transition analysis.

Requirements before showing an ML-derived state:

- No look-ahead leakage.
- Expanding or walk-forward training only.
- State descriptions remain interpretable.
- Rule-based model remains visible as the primary explanation.

## 9. NQ and options-structure integration

### 9.1 Goal

Estimate conditional behavior around walls; do not make deterministic claims that a level will hold or break.

### 9.2 Wall context model

For every NDX/NDXP level, calculate a context record:

```ts
type WallContext = {
  level: number;
  levelType: 'call_wall' | 'put_wall' | 'zero_gamma' | 'gamma_flip';
  expiryBucket: '0dte' | '1_5d' | 'monthly' | 'longer';
  gammaState: 'positive' | 'transition' | 'negative';
  macroRegime: string;
  liquidityState: string;
  stressState: string;
  volState: string;
  eventRisk: 'none' | 'medium' | 'high';
  historicalHoldProbability?: number;
  historicalBreakProbability?: number;
  confidence: number;
};
```

### 9.3 Hypotheses to test

- Positive gamma + low stress + no major event increases mean-reversion / containment probability.
- Negative gamma + rising VXN/VVIX + credit-spread widening increases continuation / break probability.
- Large call wall + rising real yields + crowded NQ positioning increases rejection probability.
- Large put wall + expanding liquidity + falling real yields increases support-confluence probability.
- High-impact macro release within 24h reduces confidence in all static EOD walls.

Do not hard-code these as trading rules before testing.

### 9.4 Required outcome labels for research

For each session and each mapped NQ level:

- Was level touched?
- Was it rejected by at least X points?
- Was it crossed by at least X points?
- Was it reclaimed by close?
- Maximum excursion after touch.
- Time to touch / break / reclaim.
- NQ realized volatility and range.
- Event-window status.

## 10. Event-risk system

### 10.1 Event categories

- FOMC decision, minutes, speeches where scheduled.
- CPI, core CPI, PPI.
- NFP, unemployment rate, wage growth.
- Jobless claims.
- Retail sales.
- PCE and GDP.
- JOLTS, ISM/PMI only if a permitted source is available.
- Treasury auctions, refunding, buybacks.
- Fed H.4.1 release.
- Major options expirations / NDX AM and NDXP PM settlements.

### 10.2 Output

- Countdown in ET.
- Impact grade: high / medium / low.
- Last release value, previous, and revision where known.
- No consensus/surprise figure unless a properly licensed source is added later.
- Event risk overlay: `none`, `medium`, `high`.

### 10.3 Operating rules

- High risk from T−24h to event close / first post-event EOD evaluation.
- Do not infer a “surprise” from price action.
- Mark macro data fresh only after the official release is confirmed ingested.

## 11. Persistence and point-in-time backtesting

### 11.1 Required storage layers

1. `raw_source_payloads` — exact response body/file, hash, retrieval timestamp.
2. `observations` — normalized individual observations and vintages.
3. `release_events` — known publication timestamps and release metadata.
4. `feature_snapshots` — all calculated values as of a timestamp.
5. `regime_snapshots` — pillar scores, labels, confidence, explanations.
6. `options_snapshots` — NDX/NDXP chain-derived calculations and walls.
7. `market_price_snapshots` — NDX/NQ/ETF/commodity daily closes and source status.
8. `wall_outcomes` — realized next-session / intraday outcome labels for evaluation.

### 11.2 Point-in-time rule

A backtest for time `T` can only use observations whose `releasedAt <= T`. Revisions released after `T` cannot replace values in that historical feature snapshot.

### 11.3 Revision handling

- Store old and new values as separate vintages.
- Display most recent value in current dashboard.
- Use historical vintage available at the time for backtests.
- Record source-reported preliminary/revised flags.
- Detect unexpected changes and emit a revision event.

## 12. Data quality and operational monitoring

### 12.1 Freshness SLA table

| Frequency | Expected freshness | Status becomes stale after |
|---|---|---|
| Daily market / rates | Same or next business day | 2 business days |
| Weekly Fed/COT/NFCI | Scheduled release window | 10 calendar days |
| Monthly macro | Scheduled release window | Next release + 5 business days |
| Quarterly macro / Z.1 | Scheduled release window | Next release + 10 business days |

### 12.2 Data-health calculation

```text
health = weighted_share_of_required_inputs_that_are_fresh

Healthy:  >= 0.90
Degraded: 0.70–0.89
Stale:    < 0.70
```

Display source failures separately from economic signals.

### 12.3 Schema-drift checks

- Expected headers/JSON paths.
- Numeric/unit validation.
- Date monotonicity.
- Plausibility bounds.
- Sudden 10×/1000× unit changes.
- Duplicate releases / conflicting values.

### 12.4 Manual override policy

Manual corrections are allowed only as a separate override record containing:

- User/reason.
- Timestamp.
- Original value.
- Replacement value.
- Expiration or review date.

Never overwrite raw source data.

## 13. UI specification

### 13.1 Card anatomy

Each card includes:

- Label.
- Current value + unit.
- Directional score in `[-1, +1]` or a percentile.
- Delta / impulse period.
- Freshness dot.
- Source badge.
- Tooltip/drawer explanation.

### 13.2 Color rules

- Green is supportive only in context; avoid calling it “bullish” universally.
- Amber indicates mixed, transitional, stale, or event-sensitive.
- Red indicates stress / deterioration, not a trade direction.
- Gray indicates unavailable / optional / stale.
- Use labels and icons in addition to color.

### 13.3 Required warnings

- `0DTE data is EOD and may not represent intraday positioning changes.`
- `COT positions are Tuesday data released Friday.`
- `News tone is not a finance-trained forecast.`
- `FINRA short volume is not short interest.`
- `Net liquidity is a proxy, not measured equity-buying cash.`
- `MOVE replacement is a calculated Treasury volatility proxy.`
- `ETF ratio source is an unofficial/no-SLA market-price adapter` when applicable.

## 14. Implementation milestones

### Phase 0 — V3 foundation

Deliverables:

- New V3 application skeleton and environment configuration.
- Source-adapter interface.
- Storage schema/migrations.
- Raw-payload archival.
- Scheduler/refresh runner.
- Source health dashboard.
- No UI decisions tied to data yet.

Acceptance criteria:

- Every adapter result can be saved, replayed, and inspected.
- A failed source does not delete prior data.
- All timestamps are normalized to UTC and displayed in ET.

### Phase 1 — NDX/NDXP options core

Deliverables:

- Carry forward V2’s verified NDX/NDXP separation.
- Scenario-based zero-gamma calculation.
- Expiry-bucket walls.
- NQ mapping/basis layer.
- Options snapshot history.

Acceptance criteria:

- NDX AM and NDXP PM settlement types are never silently mixed.
- Levels and gamma state are reproducible from archived source inputs.

### Phase 2 — Tier A macro ingestion

Deliverables:

- NY Fed, Treasury, BLS, BEA, CFTC, Cboe, Fed Board, Chicago/Philadelphia/Cleveland/Dallas adapters.
- Canonical observation table.
- Release calendar ingestion.
- Freshness rules.

Acceptance criteria:

- Every TF-01, TF-02, TF-03, and TF-06 core card has a documented source.
- Data refreshes are idempotent.
- Raw source and parsed observation reconcile.

### Phase 3 — Features and transparent regime engine

Deliverables:

- Transformations, percentiles, robust z-scores.
- Growth/inflation/policy/liquidity/stress/positioning pillar scores.
- Quadrant classification.
- Confidence calculation.
- Explainability drawer.
- Reusable page-orientation hero with live conclusion, plain-language meaning, drivers, and invalidation.
- Versioned glossary registry shared by inline definitions, drawers, formulas, and page copy.
- Fact / interpretation / implication explanation templates.
- Locally remembered hero expansion preference with critical context always visible.
- Shared accessible chart primitives for level zones, timelines, quadrants, distributions, uncertainty, direct annotations, and source/freshness states.
- Versioned design tokens for typography, spacing, color, stroke, radius, surface, motion, and chart annotation.
- Responsive high-fidelity compositions for Today, Structure, Regime, and History before feature implementation is considered visually complete.
- Today environment map, NQ/ES structure strips, and event runway.
- Structure price landscape with exposure, expiry, confluence, and level-history modes.
- Regime growth/inflation map, driver flow, change tracks, and divergence view.
- History regime timeline, similar-setup distributions, wall paths, and sample-quality view.

Acceptance criteria:

- Same raw data yields same feature snapshot deterministically.
- Every displayed score traces to inputs/formulas.
- Missing inputs reduce confidence rather than inventing a signal.
- Every regime label and confidence score produces a deterministic beginner-readable explanation.
- Explanation copy identifies conflicting evidence and never converts probability into certainty.
- Every primary visual is generated from the same versioned snapshot as its accompanying textual conclusion.
- Visual uncertainty, estimates, stale inputs, and mapped levels are distinguishable without relying on color.
- All pages use the same market-cartography grammar while retaining a distinct focal composition.

### Phase 4 — Transmission, supply, breadth, and uncertainty

Deliverables:

- Nasdaq EOD adapter with caching, health checks, and last-known-good behavior.
- ETF/commodity ratios.
- Treasury supply and primary-dealer panel.
- EPU and GDELT tone/attention.
- FINRA short-volume context.
- NDX breadth/leadership.

Acceptance criteria:

- Tier B/C failures cannot break Tier A regime output.
- Optional cards visibly report stale/unavailable data.

### Phase 5 — Options × macro context

Deliverables:

- Wall-context records.
- Event-risk overlay.
- Conditional historical outcome labels.
- Regime-aware options explanation copy.

Acceptance criteria:

- No deterministic claims about wall behavior.
- UI makes clear what is observed versus statistically estimated.

### Phase 6 — Backtesting and calibration

Deliverables:

- Point-in-time feature replay.
- NQ/wall outcome dataset.
- Walk-forward tests.
- Regime transition analysis.
- Performance dashboard by regime and event state.

Acceptance criteria:

- Backtest only uses data available at each historical timestamp.
- Regime labels and score weights are versioned.
- Results include uncertainty, sample counts, and out-of-sample evaluation.

### Phase 7 — Optional advanced models

Deliverables:

- HMM / change-point research implementation.
- Comparative validation against transparent rules.
- Feature stability reporting.

Acceptance criteria:

- Model cannot replace the transparent baseline unless it improves out-of-sample reliability and remains explainable.

## 15. Testing strategy

### 15.1 Adapter tests

- Fixture-based parser tests using archived real payloads.
- Header/schema drift tests.
- Unit conversion tests.
- Failure, timeout, malformed-content, and stale-data tests.
- Idempotency tests.

### 15.2 Calculation tests

- Annualization and YoY calculations.
- Net-liquidity unit consistency.
- Yield-spread and forward-inflation formulas.
- Robust-z behavior with outliers.
- Correct score direction per series.
- COT notional/group calculations.
- NDX/NDXP expiry separation.

### 15.3 Time-series integrity tests

- No observation available before `releasedAt`.
- Revision snapshot does not mutate historical feature snapshot.
- Weekly/monthly forward-fill begins only after release.
- Trading-day/calendar alignment.
- ET/UTC daylight-saving transitions.

### 15.4 UI tests

- Source/freshness labels displayed.
- Stale state visually distinct.
- Tooltips include formulas and caveats.
- Missing optional data does not hide core regime.
- Accessibility: color is never the only signal.
- Every page renders its orientation hero with purpose, current state, why it matters, drivers, and invalidation.
- First occurrences of acronyms and specialist terms expose glossary definitions by keyboard, pointer, and touch.
- Glossary search and return-to-context behavior are keyboard accessible.
- Hero collapsed/open preference persists without hiding confidence, event risk, freshness, or critical caveats.
- Fact, interpretation, and possible implication remain visually and semantically distinct.
- Plain-language rendering includes units and comparison periods and has no unexplained terminal shorthand.
- Error and empty states explain the missing source, expected update cadence when known, fallback behavior, and effect on confidence.
- Chart data and textual summaries reconcile exactly for the same snapshot.
- Primary visuals expose equivalent information by keyboard, touch, pointer, and screen reader.
- Color-blind simulation, high-contrast mode, reduced motion, 200% zoom, and narrow-screen layouts preserve meaning.
- Direct annotations avoid collisions and remain readable at supported viewport sizes.
- Estimated, mapped, observed, and stale visual states remain distinct in monochrome screenshots.
- Visual density limits are enforced: Today has at most three primary visuals and each page has one dominant visual.
- Screenshot review at desktop, tablet, and mobile confirms consistent typography, whitespace rhythm, alignment, annotation quality, and semantic color.
- Pages remain deliberate and visually appealing with animation disabled and shadows removed.
- No prohibited generic-dashboard pattern appears in the rendered UI.
- Automated token-pair checks enforce at least 4.5:1 for normal text and 3:1 for required controls and graphical objects.
- Deuteranopia, protanopia, tritanopia, and grayscale reviews preserve every chart distinction through labels, markers, patterns, or line styles.
- Components reference semantic tokens only; literal status colors and mechanical light-to-dark inversion do not enter feature code.

### 15.5 Research validation

- Regime transition frequency.
- Conditional NQ return/range/realized-vol distribution.
- Conditional wall hold/break/reclaim statistics.
- Event-window comparison.
- Out-of-sample tests by time period.
- Sensitivity to score thresholds and lookback choices.

## 16. Versioning and auditability

Version all of:

- Source mapping.
- Query definitions.
- Series identifiers.
- Formula definitions.
- Score weights/thresholds.
- Regime classifier version.
- Options-calculation version.

Every daily snapshot should retain a `calculationVersion` so historical results remain reproducible after improvements.

## 17. Recommended initial indicator set

Start with a high-signal, low-fragility set before adding every card.

### Core 25

1. NDXP zero gamma.
2. NDXP call wall / put wall.
3. NDXP 0DTE gamma state.
4. NQ–NDX basis.
5. SOFR / EFFR.
6. 2y yield.
7. 10y yield.
8. 10y real yield.
9. 10y−2y spread.
10. HY OAS.
11. NFCI.
12. Fed assets.
13. TGA.
14. ON RRP.
15. Net-liquidity proxy 13w impulse.
16. Core CPI 3m annualized.
17. Core PCE 3m annualized.
18. Payroll 3m average.
19. Unemployment/Sahm gap.
20. Initial claims 4w average.
21. ADS or CFNAI.
22. NQ leveraged-fund COT.
23. VXN.
24. VIX term structure.
25. Upcoming event-risk flag.

### Next additions

- Treasury supply/dealer positions.
- NDX breadth.
- HYG/LQD and SMH/SPY.
- VVIX/SKEW.
- EPU/GEPU/EMV.
- News tone/attention.
- FINRA QQQ/mega-cap short-volume context.

## 18. Known limitations and risk disclosures

- EOD option open interest is not real-time dealer positioning.
- Gamma estimates depend on assumptions about dealer positioning and IV/data quality.
- Macro releases are revised.
- Credit OAS through free FRED export has source/licensing limitations; validate allowed use before public redistribution.
- GDELT tone is not financial sentiment.
- FINRA short volume is not short interest.
- ETF ratios require a non-core market-price feed; their source can fail or change.
- Treasury-vol proxy is not ICE MOVE.
- COT is delayed and aggregates trader categories.
- Regime outputs are analytical context, not investment advice or execution instructions.

## 19. Implementation decisions and remaining choices

### Resolved for the V3 foundation

1. **Runtime and frontend:** isolate V3 as its own Next.js 16.2.12 / React 19 / TypeScript application while preserving compatibility with V2’s proven stack.
2. **Application boundary:** build the interface against a typed snapshot contract. Real adapters can replace illustrative data without redesigning page components.
3. **Initial rendering:** use statically rendered App Router pages with client code only for genuine interactions such as theme, instrument, and expiry selection.
4. **Typography:** self-host Instrument Sans, Newsreader, and IBM Plex Mono through `next/font`; no browser request is made to Google at runtime.
5. **Theme:** ship Warm Ledger light mode as the reference and Ink Ledger as a separately tokenized dark mode.
6. **Safety:** label all initial values `Preview data` until the canonical source and freshness metadata are connected.

### Still needed before live data and research

1. Storage choice: local SQLite/DuckDB first, or hosted Postgres from the start?
2. Historical scope: begin accumulating clean vintages now, or import a historical archive where permitted?
3. Market-price adapter policy: Nasdaq-only initially, or Nasdaq plus a fallback source?
4. Refresh cadence: once after close only, or scheduled release-time refreshes too?
5. Personal/local-only use versus future public distribution (affects data licensing and source choice).
6. Exact NQ outcome labels and trading-session window for wall research.

### Foundation implementation status — complete

- Responsive Today, Structure, Regime, and History page foundations.
- Beginner-oriented hero explanations and invalidation language.
- Warm Ledger / Ink Ledger design tokens and intentional font system.
- Custom accessible visuals for regime, structure, events, drivers, and historical distributions.
- Interactive NQ/ES, expiry, calculation-method, and exposure-view controls on Structure.
- Integrated exposure atlas with Gamma, Delta, Vanna, Charm, Vega, Speed, Zomma, and Vomma lenses.
- Click-to-inspect strike data plus levels, chain, volatility-skew, and term-structure studies.
- TradingView bridge, Pine v6 indicator export, and CSV export restored from V2.
- Progressive disclosure keeps advanced options data subordinate to one primary price-pressure map.
- Primary navigation is reduced to two workspaces: Macro and Options.
- Each workspace reveals its own category index; Options categories deep-link to the active central study.
- The desktop top navigation was replaced by a quiet side index so central visuals retain priority.
- Synthetic OI, volume, IV, exposure totals, bridge payloads, and CSV exports are suppressed until a verified adapter is connected.
- Options terminology distinguishes source products (NDX/NDXP and SPX/SPXW) from futures chart targets (NQ and ES).
- The Pine bridge accepts native SPX|NDX strikes and supports observed-ratio, additive-basis, manual-ratio,
  manual-basis, and already-converted modes with tick rounding and a conversion-status monitor.
- Light/dark theme persistence.
- Production build, TypeScript, ESLint, runtime hydration, and production dependency audit verified.

## 20. Definition of done for the first usable V3 release

V3 is ready for daily use when:

- NDX/NDXP levels are correct, separated by settlement type, and mapped to NQ.
- Core macro/rates/liquidity/credit/volatility/COT inputs refresh with no accounts.
- The app displays a transparent regime quadrant plus overlays and confidence.
- Every value has source/freshness/provenance.
- High-impact event risk is visible.
- Stale/failing optional sources cannot contaminate the core result.
- Daily snapshots are archived for future point-in-time backtesting.
- The dashboard explains the relationship between regime and options structure without making untested deterministic claims.
