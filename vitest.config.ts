import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = __dirname
const domTestDefaults = {
  environment: 'jsdom' as const,
  setupFiles: ['./tests/setup/vitest.setup.ts'],
  clearMocks: true,
  restoreMocks: true,
  mockReset: true,
  testTimeout: 10_000,
  hookTimeout: 10_000
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(root, 'src/renderer/src'),
      '@shared': resolve(root, 'src/shared'),
      '@test': resolve(root, 'tests')
    }
  },
  test: {
    ...domTestDefaults,
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: './out/test-results/vitest/coverage',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/**/index.tsx',
        'src/renderer/src/main.tsx'
      ]
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'tests/unit/**/*.{test,spec}.{ts,tsx}',
            'tests/smoke/**/*.unit.{test,spec}.{ts,tsx}',
            'tests/**/*.unit.{test,spec}.{ts,tsx}'
          ]
        }
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: [
            'tests/integration/**/*.{test,spec}.{ts,tsx}',
            'tests/**/*.integration.{test,spec}.{ts,tsx}'
          ],
          testTimeout: 20_000,
          hookTimeout: 20_000
        }
      }
    ]
  }
})
