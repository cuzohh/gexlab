import type { ReactNode } from 'react'

export default function ChartEmptyState({ children }: { children: ReactNode }) {
  return <div className="chart-empty-state">{children}</div>
}
