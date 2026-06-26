import { AlertCircle, Loader2 } from 'lucide-react';
import { formatCompactNumber, formatCurrency } from '../../lib/format';

export function TickerToggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-2.5 rounded-xl text-[10px] font-bold tracking-[0.2em] transition-all duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8860b]/50 ${
        active ? 'bg-[#1D1D1F] text-white shadow-lg dark:bg-[#f3efe7] dark:text-[#111317]' : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-[#F5F5F7] dark:text-[#a49b8d] dark:hover:text-[#f5efe3] dark:hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

export function StudioTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-0 py-2 text-[10px] font-black tracking-[0.25em] uppercase transition-all relative active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8860b]/50 rounded-sm ${
        active ? 'text-[#b8860b]' : 'text-[#86868B] hover:text-[#1D1D1F] dark:text-[#9f9688] dark:hover:text-[#f5efe3]'
      }`}
    >
      {label}
      {active && <div className="absolute bottom-[-17px] left-0 w-full h-[2px] bg-[#b8860b]" />}
    </button>
  );
}

export function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'green' | 'amber' | 'orange' | 'slate';
}) {
  const toneMap = {
    green: 'border-[#cfe6cf] bg-[#eef8ee] text-[#2f6b39] dark:border-[#284330] dark:bg-[#16231a] dark:text-[#9fdbab]',
    amber: 'border-[#eadab0] bg-[#fff7e2] text-[#8a6400] dark:border-[#5b4920] dark:bg-[#231d12] dark:text-[#f2d482]',
    orange: 'border-[#efcfbe] bg-[#fff1ea] text-[#9b4f26] dark:border-[#5b3421] dark:bg-[#261810] dark:text-[#f0b390]',
    slate: 'border-[#e5ded2] bg-white/80 text-[#776c5e] dark:border-white/10 dark:bg-white/6 dark:text-[#cbc0b1]',
  };

  return <span className={`rounded-full border px-3 py-1.5 ${toneMap[tone]}`}>{children}</span>;
}

export function ActionButton({
  onClick,
  label,
  icon,
  subtle,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  subtle?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.22em] transition-all duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8860b]/50 ${
        subtle
          ? 'border border-[#e5dccd] bg-white text-[#5f5648] hover:border-[#b8860b] hover:text-[#b8860b] dark:border-white/10 dark:bg-white/6 dark:text-[#d4cabd] dark:hover:border-[#d4af37] dark:hover:text-[#f0d78d]'
          : 'bg-[#1D1D1F] text-white hover:bg-[#b8860b] dark:bg-[#f3efe7] dark:text-[#111317] dark:hover:bg-[#d4af37]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function PanelShell({
  title,
  subtitle,
  status,
  children,
}: {
  title: string;
  subtitle: string;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[2.3rem] border border-[#e6dfd3] bg-white/84 p-6 shadow-[0_18px_55px_rgba(45,33,17,0.05)] dark:border-white/10 dark:bg-white/6 dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-light tracking-[-0.03em] text-[#1D1D1F] dark:text-[#f5efe3]">{title}</h2>
          <p className="mt-1 text-[11px] font-medium font-mono tracking-[0.06em] opacity-60 text-[#7f7261] dark:text-[#b5a998]">{subtitle}</p>
        </div>
        <div className="rounded-full border border-[#e7dfd2] bg-[#faf7f1] px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[#7d705e] dark:border-white/10 dark:bg-white/6 dark:text-[#c5baab]">
          {status}
        </div>
      </div>
      {children}
    </section>
  );
}

export function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid min-h-[240px] place-items-center rounded-[1.8rem] border border-dashed border-[#dfd7c8] bg-[#fbf8f2] p-6 text-center dark:border-white/12 dark:bg-white/4">
      <div className="max-w-sm">
        <p className="text-[10px] uppercase tracking-[0.32em] font-black text-[#8b7e6b] dark:text-[#c4b7a4]">{title}</p>
        <p className="mt-3 text-sm leading-relaxed text-[#766c5e] dark:text-[#a79b8b]">{detail}</p>
      </div>
    </div>
  );
}

export function StatusMessage({ status, error }: { status: string; error: string | null }) {
  if (status === 'ready') return null;

  return (
    <div className={`rounded-[1.6rem] border px-4 py-3 text-sm ${status === 'stale' ? 'border-[#e5c98f] bg-[#fff6e3] text-[#7c5b0b] dark:border-[#695427] dark:bg-[#231c12] dark:text-[#f0d58d]' : 'border-[#e7d8c4] bg-[#fbf7f1] text-[#7e6d58] dark:border-white/10 dark:bg-white/4 dark:text-[#b8ac9d]'}`}>
      <div className="flex items-start gap-3">
        {status === 'stale' ? <AlertCircle size={16} className="mt-0.5" /> : <Loader2 size={16} className="mt-0.5 animate-spin" />}
        <div>
          <p className="font-semibold tracking-wide uppercase text-[11px]">{status === 'stale' ? 'Showing stale but usable data' : 'Awaiting refresh'}</p>
          <p className="mt-1 leading-relaxed">
            {status === 'stale'
              ? error ?? 'The last successful payload is still on screen while the next refresh catches up.'
              : 'Panels will hydrate automatically as soon as the next analytics cycle completes.'}
          </p>
        </div>
      </div>
    </div>
  );
}

export function LevelPill({
  label,
  value,
  distance,
  tone,
}: {
  label: string;
  value: number | undefined;
  distance: string;
  tone: 'amber' | 'blue' | 'orange' | 'slate' | 'rose';
}) {
  const toneMap = {
    amber: 'bg-[#4c3b13] border-[#6d5112] text-[#f4e4b3]',
    blue: 'bg-[#17243d] border-[#304976] text-[#d8e6ff]',
    orange: 'bg-[#422317] border-[#804b31] text-[#ffd7c0]',
    slate: 'bg-[#2c2924] border-[#545049] text-[#efe7da]',
    rose: 'bg-[#422734] border-[#7d4a64] text-[#ffd9e9]',
  };

  return (
    <div className={`rounded-[1.35rem] border px-4 py-3 ${toneMap[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.24em]">{label}</p>
        <span className="text-[10px] uppercase tracking-[0.22em] opacity-75">{distance}</span>
      </div>
      <p className="mt-2 text-xl font-light tracking-[-0.04em] tabular-nums">{formatCurrency(value)}</p>
    </div>
  );
}

export function InsightChip({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: 'amber' | 'blue' | 'orange' | 'slate';
}) {
  const toneMap = {
    amber: 'bg-[#fff7e6] border-[#f0ddb0] text-[#835a00]',
    blue: 'bg-[#eef5ff] border-[#d8e6ff] text-[#2b4f87]',
    orange: 'bg-[#fff1e8] border-[#f3d3bf] text-[#8b5027]',
    slate: 'bg-[#f8f5ef] border-[#e6ddcf] text-[#5f574b]',
  };

  return (
    <div className={`rounded-[1.4rem] border p-4 ${toneMap[tone]}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.28em]">{label}</p>
      <p className="mt-2 text-lg font-light tracking-[-0.03em]">{value}</p>
      <p className="mt-1 text-[12px] leading-relaxed opacity-80">{hint}</p>
    </div>
  );
}

export function AristocratMetric({
  cardTitle,
  value,
  descriptor,
  valueLabel,
  icon,
}: {
  cardTitle: string;
  value?: number;
  descriptor: string;
  valueLabel?: string;
  icon?: React.ReactNode;
}) {
  const display = valueLabel ?? formatCompactNumber(value);

  return (
    <div className="rounded-[2rem] border border-[#e6dfd3] bg-white/84 p-6 shadow-[0_18px_55px_rgba(45,33,17,0.05)] transition-all duration-300 hover:shadow-[0_24px_64px_rgba(45,33,17,0.09)] hover:-translate-y-px dark:border-white/10 dark:bg-white/6 dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)] dark:hover:shadow-[0_24px_64px_rgba(0,0,0,0.4)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#847766] dark:text-[#b7ab9a]" style={{ textWrap: 'balance' } as React.CSSProperties}>{cardTitle}</p>
        {icon && <span className="text-[#b8860b]">{icon}</span>}
      </div>
      <p className="mt-4 text-[2rem] font-light tracking-[-0.05em] tabular-nums text-[#1D1D1F] dark:text-[#f5efe3]">{display}</p>
      <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[#7b7061] dark:text-[#a79b8b]">{descriptor}</p>
    </div>
  );
}
