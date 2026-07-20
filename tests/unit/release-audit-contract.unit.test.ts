import { describe, expect, it } from 'vitest'

import {
  classifyAuditCommandResult,
  isPathInside,
  parseAuditSkips,
  releaseAuditCommands,
  requiresWindowsCommandShell
} from '../../scripts/release-audit-contract.mjs'

describe('release audit contract', () => {
  it('uses the order-sensitive Electron argv and repeats every P0 Golden three times', () => {
    const goldenCommands = releaseAuditCommands.filter((argv) => argv.includes('--repeat-each=3'))

    expect(goldenCommands).toEqual([
      ['pnpm', 'exec', 'playwright', 'test', 'tests/e2e/teaching-learning-loop-crash-recovery.e2e.spec.ts', '--project=electron-e2e', '--repeat-each=3'],
      ['pnpm', 'exec', 'playwright', 'test', 'tests/e2e/teaching-learning-loop-longitudinal.e2e.spec.ts', '--project=electron-e2e', '--repeat-each=3'],
      ['pnpm', 'exec', 'playwright', 'test', 'tests/e2e/teaching-turn-presentation.a11y.e2e.spec.ts', '--project=electron-e2e', '--repeat-each=3']
    ])
  })

  it('records recognized platform skips but never treats any skip as release green', () => {
    expect(classifyAuditCommandResult(0, ['POSIX descriptor-relative capability unavailable'])).toEqual({
      knownSkips: ['POSIX descriptor-relative capability unavailable'],
      unknownSkips: [],
      failed: true
    })
    expect(classifyAuditCommandResult(0, ['unexpected skipped test'])).toMatchObject({
      unknownSkips: ['unexpected skipped test'],
      failed: true
    })
  })

  it('uses the Windows command shell only for pnpm command shims', () => {
    expect(requiresWindowsCommandShell(['pnpm', '--version'])).toBe(true)
    expect(requiresWindowsCommandShell(['git', 'worktree', 'add'])).toBe(false)
    expect(requiresWindowsCommandShell(['node', '--version'])).toBe(false)
  })
  it('detects bare and summary skip markers in command output', () => {
    expect(parseAuditSkips('Tests 1 skipped\nTODO\nskip')).toEqual(['', '', ''])
  })
  it('detects an output path that would dirty the source checkout', () => {
    expect(isPathInside('D:/project/StudiumX', 'D:/project/StudiumX/release-audit.json')).toBe(true)
    expect(isPathInside('D:/project/StudiumX', 'D:/release-evidence/release-audit.json')).toBe(false)
  })
})
