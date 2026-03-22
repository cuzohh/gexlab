/**
 * Key Levels Panel — Shows all key GEX levels with distance-from-spot
 * calculations, directional indicators, and optional futures price translation.
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

interface FuturesData {
  name: string
  ratio: number
}

interface KeyLevelsPanelProps {
  keyLevels: KeyLevels
  spot: number
  futures?: FuturesData | null
}

function LevelRow({ label, value, spot, color, futures }: {
  label: string
  value: number | null
  spot: number
  color: string
  futures?: FuturesData | null
}) {
  if (!value) return null

  const distance = ((value - spot) / spot * 100).toFixed(2)
  const sign = parseFloat(distance) >= 0 ? '+' : ''
  const futuresPrice = futures ? (value * futures.ratio).toFixed(2) : null

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0.55rem 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ width: '3px', height: '20px', borderRadius: '2px', backgroundColor: color }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', textAlign: 'right' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color }}>${value.toFixed(2)}</div>
          {futuresPrice && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '1px' }}>
              {futures!.name} {futuresPrice}
            </div>
          )}
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.65rem',
          color: parseFloat(distance) >= 0 ? 'var(--positive)' : 'var(--negative)',
          opacity: 0.7,
          minWidth: '45px',
        }}>
          {sign}{distance}%
        </span>
      </div>
    </div>
  )
}

export default function KeyLevelsPanel({ keyLevels, spot, futures }: KeyLevelsPanelProps) {
  return (
    <div>
      <LevelRow label="CALL WALL"   value={keyLevels.call_wall}   spot={spot} color="#10b981" futures={futures} />
      <LevelRow label="PUT WALL"    value={keyLevels.put_wall}    spot={spot} color="#ef4444" futures={futures} />
      <LevelRow label="ZERO GAMMA"  value={keyLevels.zero_gamma}  spot={spot} color="#f59e0b" futures={futures} />
      <LevelRow label="MAX PAIN"    value={keyLevels.max_pain}    spot={spot} color="#5e6ad2" futures={futures} />
      <LevelRow label="VOL TRIGGER" value={keyLevels.vol_trigger} spot={spot} color="#8b5cf6" futures={futures} />
      <LevelRow label="SPOT"        value={spot}                  spot={spot} color="#ededf0" futures={futures} />
    </div>
  )
}
