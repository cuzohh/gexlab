/**
 * Key Levels Panel — A styled panel showing all key GEX levels
 * with distance-from-spot calculations and directional indicators.
 */

interface KeyLevels {
  call_wall: number | null
  call_wall_gex: number
  put_wall: number | null
  put_wall_gex: number
  zero_gamma: number | null
  max_pain: number | null
  vol_trigger: number | null
}

interface KeyLevelsPanelProps {
  keyLevels: KeyLevels
  spot: number
}

function LevelRow({ label, value, spot, color }: { label: string; value: number | null; spot: number; color: string }) {
  if (!value) return null

  const distance = ((value - spot) / spot * 100).toFixed(2)
  const sign = parseFloat(distance) >= 0 ? '+' : ''

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0.6rem 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ width: '3px', height: '20px', borderRadius: '2px', backgroundColor: color }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color }}>${value.toFixed(2)}</span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          color: parseFloat(distance) >= 0 ? 'var(--positive)' : 'var(--negative)',
          opacity: 0.7,
        }}>
          {sign}{distance}%
        </span>
      </div>
    </div>
  )
}

export default function KeyLevelsPanel({ keyLevels, spot }: KeyLevelsPanelProps) {
  return (
    <div>
      <LevelRow label="CALL WALL"    value={keyLevels.call_wall}    spot={spot} color="#10b981" />
      <LevelRow label="PUT WALL"     value={keyLevels.put_wall}     spot={spot} color="#ef4444" />
      <LevelRow label="ZERO GAMMA"   value={keyLevels.zero_gamma}   spot={spot} color="#f59e0b" />
      <LevelRow label="MAX PAIN"     value={keyLevels.max_pain}     spot={spot} color="#5e6ad2" />
      <LevelRow label="VOL TRIGGER"  value={keyLevels.vol_trigger}  spot={spot} color="#8b5cf6" />
      <div style={{ padding: '0.6rem 0' }}>
        <LevelRow label="SPOT" value={spot} spot={spot} color="#ededf0" />
      </div>
    </div>
  )
}
