import { describe, expect, it } from 'vitest'

import {
  auditCommandKey,
  classifyAuditCommandResult,
  isPathInside,
  parseAuditSkips,
  platformReleaseSkipBudget,
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

  it('classifies inventoried platform skips as non-blocking and keeps unexplained skips red', () => {
    expect(classifyAuditCommandResult(0, ['POSIX descriptor-relative capability unavailable'])).toEqual({
      knownSkips: ['POSIX descriptor-relative capability unavailable'],
      unknownSkips: [],
      failed: false
    })
    expect(classifyAuditCommandResult(0, [
      '[workspace write tool] symlink rejection explicitly skipped: EPERM',
      '[workspace write tool] FIFO rejection explicitly skipped: mkfifo is unavailable on this platform'
    ])).toEqual({
      knownSkips: [
        '[workspace write tool] symlink rejection explicitly skipped: EPERM',
        '[workspace write tool] FIFO rejection explicitly skipped: mkfifo is unavailable on this platform'
      ],
      unknownSkips: [],
      failed: false
    })
    expect(classifyAuditCommandResult(0, ['unexpected skipped test'])).toMatchObject({
      unknownSkips: ['unexpected skipped test'],
      failed: true
    })
    expect(classifyAuditCommandResult(1, [])).toMatchObject({ failed: true })
  })

  it('accepts only exact win32 vitest skip budgets for unit and integration summaries', () => {
    const unitArgv = ['pnpm', 'run', 'test:unit']
    expect(auditCommandKey(unitArgv)).toBe('pnpm run test:unit')
    expect(platformReleaseSkipBudget.win32['pnpm run test:unit']).toMatchObject({
      testsSkipped: 69,
      filesSkipped: 3
    })

    expect(classifyAuditCommandResult(0, [
      'Test Files  138 passed | 3 skipped (141)',
      'Tests  1246 passed | 69 skipped (1315)'
    ], { argv: unitArgv, platform: 'win32' })).toEqual({
      knownSkips: [
        'Test Files  138 passed | 3 skipped (141)',
        'Tests  1246 passed | 69 skipped (1315)'
      ],
      unknownSkips: [],
      failed: false
    })

    expect(classifyAuditCommandResult(0, [
      'Tests  1246 passed | 70 skipped (1316)'
    ], { argv: unitArgv, platform: 'win32' })).toMatchObject({
      unknownSkips: ['Tests  1246 passed | 70 skipped (1316)'],
      failed: true
    })

    expect(classifyAuditCommandResult(0, [
      'Tests  64 passed | 1 skipped (65)'
    ], { argv: ['pnpm', 'run', 'test:integration'], platform: 'win32' })).toEqual({
      knownSkips: ['Tests  64 passed | 1 skipped (65)'],
      unknownSkips: [],
      failed: false
    })

    // Linux release CI must not inherit Windows budgets.
    expect(classifyAuditCommandResult(0, [
      'Tests  1246 passed | 69 skipped (1315)'
    ], { argv: unitArgv, platform: 'linux' })).toMatchObject({
      unknownSkips: ['Tests  1246 passed | 69 skipped (1315)'],
      failed: true
    })
  })

  it('uses the Windows command shell only for pnpm command shims', () => {
    expect(requiresWindowsCommandShell(['pnpm', '--version'])).toBe(true)
    expect(requiresWindowsCommandShell(['git', 'worktree', 'add'])).toBe(false)
    expect(requiresWindowsCommandShell(['node', '--version'])).toBe(false)
  })

  it('detects test and explicit capability skips without mistaking package-manager progress for coverage', () => {
    expect(parseAuditSkips([
      'Tests 1 skipped',
      'TODO',
      'skip',
      '[workspace write tool] symlink rejection explicitly skipped: EPERM',
      'Lockfile is up to date, resolution step is skipped'
    ].join('\n'))).toEqual([
      'Tests 1 skipped',
      'TODO',
      'skip',
      '[workspace write tool] symlink rejection explicitly skipped: EPERM'
    ])
  })

  it('detects an output path that would dirty the source checkout', () => {
    expect(isPathInside('D:/project/StudiumX', 'D:/project/StudiumX/release-audit.json')).toBe(true)
    expect(isPathInside('D:/project/StudiumX', 'D:/release-evidence/release-audit.json')).toBe(false)
  })
})
