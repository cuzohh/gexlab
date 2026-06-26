'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { AnalyticsResponse } from '../../types/analytics';
import { formatCompactNumber, formatCurrency, formatDistanceFromSpot } from '../../lib/format';

type LevelsPayload = AnalyticsResponse['levels'];

interface LevelsBoardProps {
  levels: LevelsPayload;
  spot: number;
  statusLabel: string;
}

interface LevelRow {
  label: string;
  value: string;
  note: string;
}

export function LevelsBoard({ levels, spot, statusLabel }: LevelsBoardProps) {
  const reducedMotion = useReducedMotion();

  if (!levels) return null;

  const priorityLevels = buildPriorityStrip(levels, spot);
  const groups = buildGroups(levels, spot);
  const dteBuckets = buildDteBuckets(levels, spot);

  return (
    <div className="space-y-6">
      <motion.section
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-[2.3rem] border border-[#e6dfd3] bg-white/84 p-6 shadow-[0_18px_55px_rgba(45,33,17,0.05)] dark:border-white/10 dark:bg-white/6 dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)]"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.32em] text-[#8a7d68] dark:text-[#c8bbab]">Levels Atlas</p>
            <h2 className="mt-2 text-[clamp(1.8rem,3vw,2.8rem)] font-light tracking-[-0.04em] text-[#1D1D1F] dark:text-[#f5efe3]">
              Relevant institutional levels, grouped by intent
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">
              Use this page as the fast read: core positioning, open-interest structure, gamma protection, aggressive flow landmarks, and skew extremes for the current expiry scope.
            </p>
          </div>
          <div className="rounded-full border border-[#e7dfd2] bg-[#faf7f1] px-4 py-2 text-[10px] uppercase tracking-[0.22em] text-[#7d705e] dark:border-white/10 dark:bg-white/6 dark:text-[#c5baab]">
            {statusLabel}
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.32, delay: reducedMotion ? 0 : 0.04, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden rounded-[2rem] border border-[#e6dfd3] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,244,237,0.9))] shadow-[0_18px_55px_rgba(45,33,17,0.05)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(23,27,34,0.96),rgba(17,21,28,0.92))] dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)]"
      >
        <div className="border-b border-[#e8dfd2] px-5 py-4 dark:border-white/10">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#8a7d68] dark:text-[#c8bbab]">Fast Read</p>
          <p className="mt-1 text-sm text-[#6d6255] dark:text-[#a79b8b]">The shortest path to the current market map.</p>
        </div>
        <div className="grid gap-px bg-[#e8dfd2] dark:bg-white/10 md:grid-cols-3 xl:grid-cols-6">
          {priorityLevels.map((item, index) => (
            <motion.div
              key={item.label}
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: reducedMotion ? 0 : 0.06 + index * 0.025, ease: [0.22, 1, 0.36, 1] }}
              className="bg-[#fcf8f1] px-5 py-4 dark:bg-[#171b22]"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">{item.label}</p>
              <p className="mt-2 text-[1.35rem] font-light tracking-[-0.03em] text-[#1D1D1F] dark:text-[#f5efe3]">{item.value}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">{item.note}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {dteBuckets.length > 0 && (
        <motion.section
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: reducedMotion ? 0 : 0.06, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-[2rem] border border-[#e6dfd3] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,244,237,0.88))] p-6 shadow-[0_18px_55px_rgba(45,33,17,0.05)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(23,27,34,0.96),rgba(17,21,28,0.92))] dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)]"
        >
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#8a7d68] dark:text-[#c8bbab]">Expiry Packs</p>
              <h3 className="mt-2 text-2xl font-light tracking-[-0.03em] text-[#1D1D1F] dark:text-[#f5efe3]">0DTE through 5DTE map</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">
                These are the same near-expiry level packs exported to the TradingView bridge, surfaced here so the app and Pine view stay aligned.
              </p>
            </div>
            <span className="rounded-full border border-[#e7dfd2] bg-white/70 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-[#7d705e] dark:border-white/10 dark:bg-white/6 dark:text-[#c5baab]">
              TV Aligned
            </span>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {dteBuckets.map((bucket, index) => (
              <motion.div
                key={bucket.title}
                initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: reducedMotion ? 0 : 0.08 + index * 0.03, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-[1.6rem] border border-[#e7dfd2] bg-white/76 p-5 dark:border-white/8 dark:bg-white/5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">{bucket.title}</p>
                    <p className="mt-1 text-sm text-[#6d6255] dark:text-[#a79b8b]">{bucket.expiry}</p>
                  </div>
                  <span className="rounded-full border border-[#e7dfd2] bg-[#faf7f1] px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-[#7d705e] dark:border-white/10 dark:bg-white/6 dark:text-[#c5baab]">
                    {bucket.rows.length} levels
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {bucket.rows.map((row) => (
                    <div key={row.label} className="rounded-[1.2rem] border border-[#ece3d7] bg-[#fcf8f1] p-3 dark:border-white/8 dark:bg-[#171b22]">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#8a7d68] dark:text-[#c8bbab]">{row.label}</p>
                      <p className="mt-2 text-base font-light tracking-[-0.03em] text-[#1D1D1F] dark:text-[#f5efe3]">{row.value}</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">{row.note}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {groups.map((group, index) => (
          <motion.section
            key={group.title}
            initial={reducedMotion ? false : { opacity: 0, y: 16 }}
            animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.34, delay: reducedMotion ? 0 : index * 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-[2rem] border border-[#e6dfd3] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(249,245,238,0.88))] p-6 shadow-[0_18px_55px_rgba(45,33,17,0.05)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(26,30,38,0.95),rgba(19,23,30,0.92))] dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)]"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#8a7d68] dark:text-[#c8bbab]">{group.eyebrow}</p>
                <h3 className="mt-2 text-2xl font-light tracking-[-0.03em] text-[#1D1D1F] dark:text-[#f5efe3]">{group.title}</h3>
              </div>
              <span className="rounded-full border border-[#e7dfd2] bg-white/70 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-[#7d705e] dark:border-white/10 dark:bg-white/6 dark:text-[#c5baab]">
                {group.rows.length} levels
              </span>
            </div>
            <p className="mb-5 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">{group.description}</p>
            <div className="grid gap-3">
              {group.rows.map((row, rowIndex) => (
                <motion.div
                  key={row.label}
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: reducedMotion ? 0 : index * 0.04 + rowIndex * 0.025, ease: [0.22, 1, 0.36, 1] }}
                  className="grid gap-2 rounded-[1.4rem] border border-[#e7dfd2] bg-white/76 p-4 dark:border-white/8 dark:bg-white/5"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8a7d68] dark:text-[#c8bbab]">{row.label}</p>
                    <p className="text-lg font-light tracking-[-0.03em] text-[#1D1D1F] dark:text-[#f5efe3]">{row.value}</p>
                  </div>
                  <p className="text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">{row.note}</p>
                </motion.div>
              ))}
            </div>
          </motion.section>
        ))}
      </div>
    </div>
  );
}

function buildGroups(levels: LevelsPayload, spot: number) {
  const derived = levels?.derived;

  return [
    {
      eyebrow: 'Core Map',
      title: 'Primary Levels',
      description: 'The baseline map most users will care about first: where gamma flips, where the largest walls sit, and where payout pressure clusters.',
      rows: compactRows([
        ['Gamma Flip', levels?.gammaFlip, `Zero-gamma transition, ${formatDistanceFromSpot(levels?.gammaFlip, spot)} from spot.`],
        ['Call Wall', levels?.callWall, `Largest positive gamma wall, ${formatDistanceFromSpot(levels?.callWall, spot)} from spot.`],
        ['Put Wall', levels?.putWall, `Largest negative gamma wall, ${formatDistanceFromSpot(levels?.putWall, spot)} from spot.`],
        ['Max Pain', levels?.maxPain, 'Payout-minimizing strike for the selected expiry scope.'],
      ]),
    },
    {
      eyebrow: 'Gamma Protection',
      title: 'Protected Ranges',
      description: 'These levels show where positive gamma is most likely to cushion or pin movement before flow overwhelms it.',
      rows: compactRows([
        ['Protected Gamma High', derived?.protectedGammaHigh, 'Positive-gamma shelf above spot where resistance is most reinforced.'],
        ['Protected Gamma Low', derived?.protectedGammaLow, 'Positive-gamma support shelf below spot where dips may dampen.'],
        ['Vanna Magnet', levels?.vannaMagnet, 'Largest vanna sensitivity strike; often a volatility-gravity pocket.'],
      ]),
    },
    {
      eyebrow: 'Directional',
      title: 'DEX Structure',
      description: 'Directional exposure levels show where dealer delta sensitivity clusters and where directional pressure can pivot across strikes.',
      rows: compactRows([
        ['DEX Flip', levels?.dex?.flip, `Directional exposure transition, ${formatDistanceFromSpot(levels?.dex?.flip, spot)} from spot.`],
        ['DEX Call Wall', levels?.dex?.callWall, `Largest positive DEX wall, ${formatDistanceFromSpot(levels?.dex?.callWall, spot)} from spot.`],
        ['DEX Put Wall', levels?.dex?.putWall, `Largest negative DEX wall, ${formatDistanceFromSpot(levels?.dex?.putWall, spot)} from spot.`],
        ['DEX Call Wall 2', levels?.dex?.majorWalls?.calls?.[1]?.strike, levels?.dex?.majorWalls?.calls?.[1] ? `Secondary positive DEX wall with ${formatCompactNumber(levels.dex.majorWalls.calls[1].gex)} DEX.` : ''],
        ['DEX Put Wall 2', levels?.dex?.majorWalls?.puts?.[1]?.strike, levels?.dex?.majorWalls?.puts?.[1] ? `Secondary negative DEX wall with ${formatCompactNumber(levels.dex.majorWalls.puts[1].gex)} DEX.` : ''],
      ]),
    },
    {
      eyebrow: 'Open Interest',
      title: 'OI Structure',
      description: 'Open-interest walls help show where positioning is deepest and where thin zones may allow faster travel.',
      rows: compactRows([
        ['OI Call Wall', derived?.oiCallWall, 'Highest aggregated call open interest strike.'],
        ['OI Put Wall', derived?.oiPutWall, 'Highest aggregated put open interest strike.'],
        ['Weak Call OI', derived?.weakCallOIStrike, 'A thin call-interest zone that can open upside travel if breached.'],
        ['Weak Put OI', derived?.weakPutOIStrike, 'A thin put-interest zone that can open downside travel if lost.'],
      ]),
    },
    {
      eyebrow: 'Aggression',
      title: 'Flow Pressure',
      description: 'These strikes reflect where live participation is most aggressive, which can matter even when static positioning is elsewhere.',
      rows: compactRows([
        ['Aggressive Call Ceiling', derived?.aggressiveCallCeiling, 'Most active call-volume strike above spot.'],
        ['Aggressive Put Floor', derived?.aggressivePutFloor, 'Most active put-volume strike below spot.'],
        ['Top Call Wall 2', levels?.majorWalls?.calls?.[1]?.strike, levels?.majorWalls?.calls?.[1] ? `Secondary positive-gamma wall with ${formatCompactNumber(levels.majorWalls.calls[1].gex)} GEX.` : ''],
        ['Top Call Wall 3', levels?.majorWalls?.calls?.[2]?.strike, levels?.majorWalls?.calls?.[2] ? `Tertiary positive-gamma wall with ${formatCompactNumber(levels.majorWalls.calls[2].gex)} GEX.` : ''],
        ['Top Put Wall 2', levels?.majorWalls?.puts?.[1]?.strike, levels?.majorWalls?.puts?.[1] ? `Secondary negative-gamma wall with ${formatCompactNumber(levels.majorWalls.puts[1].gex)} GEX.` : ''],
        ['Top Put Wall 3', levels?.majorWalls?.puts?.[2]?.strike, levels?.majorWalls?.puts?.[2] ? `Tertiary negative-gamma wall with ${formatCompactNumber(levels.majorWalls.puts[2].gex)} GEX.` : ''],
      ]),
    },
    {
      eyebrow: 'Volatility',
      title: 'Skew Extremes',
      description: 'Skew landmarks tell you where the vol surface is richest or cheapest, which helps contextualize flow and wall interactions.',
      rows: compactRows([
        ['Skew Rich Strike', derived?.skewRichStrike, 'Highest average implied volatility strike in the current scope.'],
        ['Skew Cheap Strike', derived?.skewCheapStrike, 'Lowest average implied volatility strike in the current scope.'],
      ]),
    },
  ].filter((group) => group.rows.length > 0);
}

function compactRows(entries: Array<[string, number | undefined, string]>) {
  return entries
    .filter(([, value]) => typeof value === 'number' && !Number.isNaN(value))
    .map(([label, value, note]) => ({
      label,
      value: formatCurrency(value),
      note,
    })) satisfies LevelRow[];
}

function buildPriorityStrip(levels: LevelsPayload, spot: number) {
  return [
    { label: 'Gamma Flip', value: formatCurrency(levels?.gammaFlip), note: `${formatDistanceFromSpot(levels?.gammaFlip, spot)} from spot` },
    { label: 'Call Wall', value: formatCurrency(levels?.callWall), note: `${formatDistanceFromSpot(levels?.callWall, spot)} from spot` },
    { label: 'Put Wall', value: formatCurrency(levels?.putWall), note: `${formatDistanceFromSpot(levels?.putWall, spot)} from spot` },
    { label: 'DEX Flip', value: formatCurrency(levels?.dex?.flip), note: `${formatDistanceFromSpot(levels?.dex?.flip, spot)} from spot` },
    { label: 'Max Pain', value: formatCurrency(levels?.maxPain), note: 'Payout-minimizing strike' },
  ].filter((item) => item.value !== '--');
}

function buildDteBuckets(levels: LevelsPayload, spot: number) {
  return (levels?.byDte ?? [])
    .filter((entry) => entry.dte >= 0 && entry.dte <= 5)
    .map((entry) => ({
      title: `${entry.dte}DTE`,
      expiry: entry.expiry,
      rows: compactRows([
        ['Gamma Flip', entry.gammaFlip, `${formatDistanceFromSpot(entry.gammaFlip, spot)} from spot.`],
        ['Call Wall', entry.callWall, `${formatDistanceFromSpot(entry.callWall, spot)} from spot.`],
        ['Put Wall', entry.putWall, `${formatDistanceFromSpot(entry.putWall, spot)} from spot.`],
        ['Max Pain', entry.maxPain, 'Near-expiry payout-minimizing strike.'],
        ['DEX Flip', entry.dex?.flip, `${formatDistanceFromSpot(entry.dex?.flip, spot)} from spot.`],
        ['DEX Call Wall', entry.dex?.callWall, `${formatDistanceFromSpot(entry.dex?.callWall, spot)} from spot.`],
        ['DEX Put Wall', entry.dex?.putWall, `${formatDistanceFromSpot(entry.dex?.putWall, spot)} from spot.`],
      ]),
    }))
    .filter((bucket) => bucket.rows.length > 0);
}
