import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: {
    include: ['echarts', 'echarts-for-react', 'tslib'],
  },
  build: {
    chunkSizeWarningLimit: 1200,
    commonjsOptions: {
      include: [/echarts/, /tslib/, /node_modules/],
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('echarts-gl')) {
            return 'charts-3d'
          }
          if (id.includes('echarts-for-react')) {
            return 'charts-react'
          }
          if (id.includes('zrender')) {
            return 'charts-zrender'
          }
          if (id.includes('echarts/core')) {
            return 'charts-runtime'
          }
          if (id.includes('echarts/charts')) {
            return 'charts-series'
          }
          if (id.includes('echarts/components')) {
            return 'charts-components'
          }
          if (id.includes('echarts/renderers')) {
            return 'charts-renderers'
          }
          if (id.includes('echarts')) {
            return 'charts-misc'
          }
          return undefined
        },
      },
    },
  },
  server: {
    port: 3000,
  },
})
