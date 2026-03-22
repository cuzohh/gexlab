import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['echarts', 'echarts-for-react', 'tslib'],
  },
  build: {
    commonjsOptions: {
      include: [/echarts/, /tslib/, /node_modules/],
    },
  },
  server: {
    port: 3000,
  },
})
