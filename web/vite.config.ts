import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Standalone browser Vite config for the StudiumX Web app.
 *
 * This is NOT electron-vite: there is no main/preload process. The Web app is
 * a read-only "学习伴侣仪表盘" (learning-companion dashboard) backed by
 * StudiumX-Server. It is NOT a teaching execution engine: no model keys, no
 * agent loop, no workspace file writes (plan §9 / AGENTS.md red lines).
 *
 * Path aliases mirror the vitest config so `@shared` / `@renderer` resolve to
 * the same shared source the desktop renderer uses; `@web` points at web/src.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('../src/renderer/src', import.meta.url)),
      '@web': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5174
  },
  build: {
    outDir: 'dist'
  }
})
