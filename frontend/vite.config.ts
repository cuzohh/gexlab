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
    commonjsOptions: {
      include: [/echarts/, /tslib/, /node_modules/],
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('echarts') || id.includes('echarts-for-react')) {
            return 'charts'
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
