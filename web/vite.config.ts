import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = import.meta.dirname
const shared = path.resolve(root, '../server/src/shared')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(root, 'src'), '@shared': shared } },
  server: {
    proxy: { '/api': 'http://localhost:8422' },
    fs: { allow: [path.resolve(root, '..')] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
})
