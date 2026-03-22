export {}

declare global {
  interface Window {
    gexlabDesktop?: {
      apiBase: string | null
      isDesktop: boolean
    }
  }
}
