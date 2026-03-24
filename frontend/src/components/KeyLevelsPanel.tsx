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
  color: 'positive' | 'negative' | 'warning' | 'accent' | 'accent-alt' | 'neutral'
  futures?: FuturesData | null
}) {
  if (value === null || !Number.isFinite(value)) return null

  const hasValidSpot = Number.isFinite(spot) && spot !== 0
  const distance = hasValidSpot ? ((value - spot) / spot * 100).toFixed(2) : null
  const distanceNumber = distance === null ? null : Number(distance)
  const sign = distanceNumber !== null && distanceNumber >= 0 ? '+' : ''
  const futuresPrice = futures && Number.isFinite(futures.ratio) ? (value * futures.ratio).toFixed(2) : null

  return (
    <div className="key-level-row" data-tone={color}>
      <div className="key-level-label">
        <div className="key-level-swatch" />
        <span className="key-level-name">{label}</span>
      </div>
      <div className="key-level-values">
        <div>
          <div className="key-level-price">${value.toFixed(2)}</div>
          {futuresPrice && (
            <div className="key-level-futures">
              {futures!.name} {futuresPrice}
            </div>
          )}
        </div>
        <span className="key-level-distance" data-direction={distanceNumber === null || distanceNumber >= 0 ? 'up' : 'down'}>
          {distanceNumber === null ? '--' : `${sign}${distance}%`}
        </span>
      </div>
    </div>
  )
}

export default function KeyLevelsPanel({ keyLevels, spot, futures }: KeyLevelsPanelProps) {
  return (
    <div>
      <LevelRow label="CALL WALL"   value={keyLevels.call_wall}   spot={spot} color="positive" futures={futures} />
      <LevelRow label="PUT WALL"    value={keyLevels.put_wall}    spot={spot} color="negative" futures={futures} />
      <LevelRow label="ZERO GAMMA"  value={keyLevels.zero_gamma}  spot={spot} color="warning" futures={futures} />
      <LevelRow label="MAX PAIN"    value={keyLevels.max_pain}    spot={spot} color="accent" futures={futures} />
      <LevelRow label="VOL TRIGGER" value={keyLevels.vol_trigger} spot={spot} color="accent-alt" futures={futures} />
      <LevelRow label="SPOT"        value={spot}                  spot={spot} color="neutral" futures={futures} />
    </div>
  )
}
