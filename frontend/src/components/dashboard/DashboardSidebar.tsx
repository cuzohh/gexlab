'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GripVertical, Radio, Waves } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspacePrefs } from './WorkspacePrefsProvider';

type DashboardView = 'overview' | 'exposure' | 'dex' | 'vega' | 'charm' | 'chain' | 'events' | 'volatility' | 'ledger' | 'levels' | 'settings';

export function DashboardSidebar({
  pollerPaused,
  navItems,
  onReorder,
}: {
  pollerPaused: boolean;
  navItems: Array<{ href: string; label: string; view: DashboardView; blurb: string }>;
  onReorder: (draggedHref: string, targetHref: string) => void;
}) {
  const pathname = usePathname();
  const { hydrated, priceMode, sessionMode } = useWorkspacePrefs();

  if (!hydrated) return null;

  return (
    <aside className="hidden xl:block xl:w-[12.75rem] xl:flex-none">
      <div className="app-scroll sticky top-6 max-h-[calc(100vh-3rem)] space-y-4 overflow-y-auto pr-0">
        <div className="rounded-[1.75rem] border border-[#e4dbcc] bg-[linear-gradient(180deg,rgba(255,252,246,0.94),rgba(246,240,231,0.9))] p-4 shadow-[0_18px_48px_rgba(45,33,17,0.08)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(23,27,34,0.96),rgba(18,22,29,0.94))] dark:shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#8a7d68] dark:text-[#c8bbab]">Navigation</p>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[#7c725f] dark:text-[#b7ab9a]">
              <Radio size={12} className={cn(pollerPaused ? 'text-[#9b4f26]' : 'text-[#2f6b39]')} />
              {pollerPaused ? 'Paused' : 'Live'}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', item.href);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const draggedHref = event.dataTransfer.getData('text/plain');
                    if (draggedHref && draggedHref !== item.href) {
                      onReorder(draggedHref, item.href);
                    }
                  }}
                  className={cn(
                    'block rounded-[1.15rem] border transition-all',
                    'px-3 py-3',
                    active
                      ? 'border-[#d7c08a] bg-[linear-gradient(135deg,#fffaf0,#f8edd2)] shadow-[0_14px_35px_rgba(95,70,10,0.09)] dark:border-[#8d7331] dark:bg-[linear-gradient(135deg,#241d12,#171b22)] dark:shadow-[0_14px_35px_rgba(0,0,0,0.35)]'
                      : 'border-[#e5ddcf] bg-white/75 hover:border-[#d7c08a] hover:bg-[#fffaf2] dark:border-white/10 dark:bg-white/5 dark:hover:border-[#8d7331] dark:hover:bg-white/8'
                  )}
                  aria-label={`${item.label}. Drag to reorder.`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#8a7d68] dark:text-[#c8bbab]">{item.label}</p>
                    <GripVertical size={14} className="shrink-0 text-[#9b8f7d] dark:text-[#b7ab9a]" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-[#e4dbcc] bg-[linear-gradient(180deg,rgba(255,252,246,0.94),rgba(246,240,231,0.9))] p-4 shadow-[0_18px_48px_rgba(45,33,17,0.08)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(23,27,34,0.96),rgba(18,22,29,0.94))] dark:shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.26em] text-[#8a7d68] dark:text-[#c8bbab]">
            <Waves size={12} className="text-[#b8860b]" />
            Session
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[#6d6255] dark:text-[#a79b8b]">{sessionMode}</p>
          <p className="mt-2 text-xs leading-relaxed text-[#7c725f] dark:text-[#b7ab9a]">
            {priceMode === 'futures' ? 'Futures-converted view is active.' : 'ETF-native view is active.'}
          </p>
        </div>
      </div>
    </aside>
  );
}
