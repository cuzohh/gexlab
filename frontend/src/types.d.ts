export {}

declare global {
  interface Window {
    gexlabDesktop?: {
      apiBase: string | null
      isDesktop: boolean
      platform: string
      openExternal: (url: string) => Promise<void>
      windowControls: {
        minimize: () => Promise<void>
        toggleMaximize: () => Promise<boolean>
        close: () => Promise<void>
        isMaximized: () => Promise<boolean>
        onMaximizedChanged: (listener: (maximized: boolean) => void) => () => void
      }
    }
  }
}
