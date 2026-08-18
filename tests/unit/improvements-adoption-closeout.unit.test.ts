/**
 * The ADR directory is the current decision set, not a second implementation
 * backlog. Historical implementation slices remain in Git/PR history only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const legacyImprovementsDirectory = 'docs/improvements'

const SPOT_PATHS = [
  'src/main/teaching-workspace.ts',
  'src/main/learning-session-ledger.ts',
  'src/main/teaching-turn-coordinator-host.ts',
  'src/main/ai/tools',
  'src/main/mcp',
  'src/shared/mcp',
  'src/preload',
  'scripts'
] as const

function readRepo(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('current ADR-set governance contract', () => {
  it('keeps Git/PR as history and the ADR README as the current index', () => {
    const index = readRepo('docs/adr/README.md')
    expect(index).toContain('当前有效架构决策集')
    expect(index).toMatch(/实施历史.*Git.*PR|Git.*PR.*历史/)
    expect(index).toContain('不保留 superseded stub')
    expect(index).not.toContain('ADR-AGENTS')
  })

  it('does not recreate the deleted improvements campaign as a second backlog', () => {
    const directory = resolve(root, legacyImprovementsDirectory)
    const entries = existsSync(directory) ? readdirSync(directory) : []
    expect(entries).toEqual([])
  })

  it('keeps representative production paths on disk', () => {
    for (const relativePath of SPOT_PATHS) {
      expect(existsSync(resolve(root, relativePath)), `missing path ${relativePath}`).toBe(true)
    }
  })
})
