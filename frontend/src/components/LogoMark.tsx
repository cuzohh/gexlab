interface LogoMarkProps {
  size?: number
  compact?: boolean
}

export default function LogoMark({ size = 28, compact = false }: LogoMarkProps) {
  const width = compact ? size : size * 4.6
  const height = size

  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={compact ? '0 0 28 28' : '0 0 132 28'}
      fill="none"
    >
      <rect x="1" y="1" width="26" height="26" rx="8" fill="url(#gexlab-logo-bg)" stroke="rgba(255,255,255,0.12)" />
      <path
        d="M6 18.2C8.1 18.2 8.3 10 10.4 10C12.5 10 12.7 18.2 14.8 18.2C16.9 18.2 17.1 7.7 19.2 7.7C21.3 7.7 21.5 18.2 23.6 18.2"
        stroke="url(#gexlab-logo-line)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="10.4" cy="10" r="1.5" fill="#7c3aed" />
      <circle cx="19.2" cy="7.7" r="1.5" fill="#38bdf8" />
      {!compact && (
        <>
          <text x="38" y="13.8" fill="#E8EDF7" fontSize="10" fontWeight="700" letterSpacing="0.24em">
            GEX
          </text>
          <text x="38" y="24" fill="#7DD3FC" fontSize="10" fontWeight="600" letterSpacing="0.16em">
            LAB
          </text>
        </>
      )}
      <defs>
        <linearGradient id="gexlab-logo-bg" x1="2" y1="2" x2="26" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#101725" />
          <stop offset="1" stopColor="#131d2e" />
        </linearGradient>
        <linearGradient id="gexlab-logo-line" x1="6" y1="13" x2="23.6" y2="13" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7c3aed" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
    </svg>
  )
}
