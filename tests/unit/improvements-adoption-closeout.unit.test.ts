/**
 * Structural contract for ADR-0121's improvements-adoption closeout.
 *
 * The former per-slice architecture review reports were deliberately deleted
 * after their accepted decisions moved into ADRs. Keeping this test tied to
 * those deleted campaign artifacts would recreate the second backlog that
 * ADR-0121 explicitly forbids.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const closeoutPath = 'docs/adr/0121-improvements-adoption-closeout.md'
const legacyImprovementsDirectory = 'docs/improvements'

const REPRESENTATIVE_IMPLEMENTATION_ADRS = [
  'docs/adr/0051-provider-finish-reason-and-length-tool-rejection.md',
  'docs/adr/0067-cancel-tool-pair-close-and-busy-ack.md',
  'docs/adr/0070-agent-runtime-wire-shared-protocol.md',
  'docs/adr/0120-teaching-ipc-commands-agent-conversation-peel.md'
] as const

const SPOT_PATHS = [
  'src/main/teaching-workspace.ts',
  'src/main/learning-session-ledger.ts',
  'src/main/teaching-turn-coordinator.ts',
  'src/main/teaching-turn-coordinator-host.ts',
  'src/main/ai/tools',
  'src/main/mcp',
  'src/shared/mcp',
  'src/shared/study-planning',
  'src/renderer/src/study-space',
  'src/renderer/src/views/workbench',
  'src/preload',
  'scripts'
] as const

function readRepo(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('ADR-0121 improvements-adoption closeout contract', () => {
  it('keeps ADR-0121 and the ADR index as the canonical closeout authority', () => {
    expect(existsSync(resolve(root, closeoutPath))).toBe(true)
    const closeout = readRepo(closeoutPath)
    const index = readRepo('docs/adr/README.md')

    expect(closeout).toMatch(/决策状态[^\n]*accepted/)
    expect(closeout).toMatch(/实施说明[^\n]*已采纳/)
    expect(closeout).toContain('`docs/improvements/` 清空')
    expect(closeout).toContain('Phase 0–2')
    expect(closeout).toMatch(/新的上游借鉴[\s\S]*新建 ADR/)
    expect(index).toContain('[ADR-0121](0121-improvements-adoption-closeout.md)')
    expect(index).toContain('`docs/improvements/` 目录已清空')
  })

  it('does not recreate the deleted improvements campaign as a second backlog', () => {
    const directory = resolve(root, legacyImprovementsDirectory)
    const entries = existsSync(directory) ? readdirSync(directory) : []
    expect(entries).toEqual([])
  })

  it('keeps representative implementation ADRs and live production paths on disk', () => {
    for (const relativePath of [...REPRESENTATIVE_IMPLEMENTATION_ADRS, ...SPOT_PATHS]) {
      expect(existsSync(resolve(root, relativePath)), `missing path ${relativePath}`).toBe(true)
    }
  })
})
