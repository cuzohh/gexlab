import { useEffect, useState } from 'react'
import LogoMark from './LogoMark'

interface DesktopTitleBarProps {
  page: 'home' | 'dashboard' | 'docs'
  ticker?: string
}

export default function DesktopTitleBar({ page, ticker }: DesktopTitleBarProps) {
  const desktopBridge = window.gexlabDesktop
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!desktopBridge?.isDesktop) {
      return
    }

    desktopBridge.windowControls.isMaximized().then(setMaximized)
    return desktopBridge.windowControls.onMaximizedChanged(setMaximized)
  }, [desktopBridge])

  if (!desktopBridge?.isDesktop) {
    return null
  }

  const subtitle = page === 'dashboard'
    ? `${ticker || 'SPY'} gamma dashboard`
    : page === 'docs'
      ? 'Documentation'
      : 'Local analytics terminal'

  return (
    <div className="desktop-titlebar">
      <div className="desktop-titlebar-glow" />
      <div className="desktop-drag-region">
        <div className="desktop-titlebar-brand">
          <LogoMark />
          <div className="desktop-titlebar-copy">
            <strong>GEXLAB</strong>
            <span>{subtitle}</span>
          </div>
        </div>
      </div>
      <div className="desktop-window-controls">
        <button type="button" onClick={() => desktopBridge.windowControls.minimize()} aria-label="Minimize window">
          <span />
        </button>
        <button type="button" onClick={() => desktopBridge.windowControls.toggleMaximize()} aria-label={maximized ? 'Restore window' : 'Maximize window'}>
          <span className={maximized ? 'is-maximized' : ''} />
        </button>
        <button type="button" className="desktop-window-close" onClick={() => desktopBridge.windowControls.close()} aria-label="Close window">
          <span />
        </button>
      </div>
    </div>
  )
}
