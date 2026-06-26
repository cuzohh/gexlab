'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type ExpiryBucket = {
  expiry: string;
  dte: number;
  gex: number;
  dex?: number;
  callDex?: number;
  putDex?: number;
  vega: number;
  charm: number;
  gammaFlip?: number | null;
  callWall?: number | null;
  putWall?: number | null;
  dexFlip?: number | null;
  dexCallWall?: number | null;
  dexPutWall?: number | null;
};

export function TermStructureCharts({ data, mode = 'gamma' }: { data: ExpiryBucket[]; mode?: 'gamma' | 'dex' }) {
  if (!data.length) return null;

  const chartData = data.slice(0, 8).map((bucket) => ({
    label: `${bucket.dte}D`,
    expiry: bucket.expiry,
    gex: bucket.gex / 1e6,
    dex: (bucket.dex ?? 0) / 1e6,
    callDex: (bucket.callDex ?? 0) / 1e6,
    putDex: Math.abs((bucket.putDex ?? 0) / 1e6),
    vega: bucket.vega / 1e6,
    charm: bucket.charm / 1e6,
    gammaFlip: bucket.gammaFlip ?? null,
    callWall: bucket.callWall ?? null,
    putWall: bucket.putWall ?? null,
    dexFlip: bucket.dexFlip ?? null,
    dexCallWall: bucket.dexCallWall ?? null,
    dexPutWall: bucket.dexPutWall ?? null,
  }));

  const levelNames = mode === 'dex'
    ? new Set(['DEX Flip', 'DEX Call Wall', 'DEX Put Wall'])
    : new Set(['Gamma Flip', 'Call Wall', 'Put Wall']);

  const tooltipFormatter = (value: any, name: any) => {
    if (typeof value !== 'number') return ['--', name];
    if (levelNames.has(String(name))) {
      return [`$${value.toFixed(2)}`, name];
    }
    return [`${value.toFixed(2)}M`, name];
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="h-[18rem] rounded-[1.6rem] border border-[#e6ddcf] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/5">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 6, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(152,135,110,0.2)" vertical={false} />
            <XAxis dataKey="label" stroke="#7d705e" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#7d705e" fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip
              formatter={tooltipFormatter}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.expiry ?? ''}
              contentStyle={{ backgroundColor: 'rgba(255,250,242,0.96)', border: '1px solid #e5ddcf', borderRadius: '12px', color: '#5d513f' }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {mode === 'dex' ? (
              <>
                <Bar dataKey="dex" fill="#60a5fa" radius={[8, 8, 0, 0]} name="Net DEX" />
                <Line type="monotone" dataKey="callDex" stroke="#16a34a" strokeWidth={2.2} dot={false} name="Call DEX" />
                <Line type="monotone" dataKey="putDex" stroke="#ea580c" strokeWidth={2.2} dot={false} name="Put DEX |Abs|" />
              </>
            ) : (
              <>
                <Bar dataKey="gex" fill="#60a5fa" radius={[8, 8, 0, 0]} name="Net GEX" />
                <Line type="monotone" dataKey="vega" stroke="#d4af37" strokeWidth={2.2} dot={false} name="Net Vega" />
                <Line type="monotone" dataKey="charm" stroke="#fb923c" strokeWidth={2.2} dot={false} name="Net Charm" />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="h-[18rem] rounded-[1.6rem] border border-[#e6ddcf] bg-[#fcf8f1] p-4 dark:border-white/10 dark:bg-white/5">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 6, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(152,135,110,0.2)" vertical={false} />
            <XAxis dataKey="label" stroke="#7d705e" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="#7d705e" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <Tooltip
              formatter={tooltipFormatter}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.expiry ?? ''}
              contentStyle={{ backgroundColor: 'rgba(255,250,242,0.96)', border: '1px solid #e5ddcf', borderRadius: '12px', color: '#5d513f' }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {mode === 'dex' ? (
              <>
                <Line type="monotone" dataKey="dexFlip" stroke="#b8860b" strokeWidth={2.2} dot={{ r: 2.5 }} name="DEX Flip" />
                <Line type="monotone" dataKey="dexCallWall" stroke="#16a34a" strokeWidth={2.2} dot={{ r: 2.5 }} name="DEX Call Wall" />
                <Line type="monotone" dataKey="dexPutWall" stroke="#ea580c" strokeWidth={2.2} dot={{ r: 2.5 }} name="DEX Put Wall" />
              </>
            ) : (
              <>
                <Line type="monotone" dataKey="gammaFlip" stroke="#b8860b" strokeWidth={2.2} dot={{ r: 2.5 }} name="Gamma Flip" />
                <Line type="monotone" dataKey="callWall" stroke="#2563eb" strokeWidth={2.2} dot={{ r: 2.5 }} name="Call Wall" />
                <Line type="monotone" dataKey="putWall" stroke="#ea580c" strokeWidth={2.2} dot={{ r: 2.5 }} name="Put Wall" />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
