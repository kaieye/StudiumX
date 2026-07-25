import { describe, expect, it } from 'vitest'

import {
  isWindowsWslBash,
  resolveAgentShell,
  shellArgvForCommand
} from '../../src/main/ai/tools/agent-shell-resolve'
import {
  collectWritableRoots,
  defaultForbidReadRoots,
  createBwrapCommandArgs
} from '../../src/main/ai/tools/codex-sandbox-transform'
import { resolveShellArgv } from '../../src/main/ai/tools/shell-command-safety'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('agent-shell-resolve (Reasonix shell.go)', () => {
  it('does not treat empty path as WSL bash', () => {
    expect(isWindowsWslBash('')).toBe(false)
  })

  it('resolveAgentShell returns a shell path', () => {
    const sh = resolveAgentShell('auto')
    expect(sh.path.length).toBeGreaterThan(0)
    expect(['bash', 'powershell']).toContain(sh.kind)
  })

  it('shellArgvForCommand wraps bash with -lc', () => {
    const argv = shellArgvForCommand({ kind: 'bash', path: '/bin/bash' }, 'echo hi')
    expect(argv).toEqual(['/bin/bash', '-lc', 'echo hi'])
  })

  it('shellArgvForCommand wraps powershell with UTF-8 prologue', () => {
    const argv = shellArgvForCommand(
      { kind: 'powershell', path: 'powershell.exe' },
      'Get-ChildItem'
    )
    expect(argv[0]).toBe('powershell.exe')
    expect(argv).toContain('-NoProfile')
    expect(argv).toContain('-Command')
    expect(String(argv[argv.length - 1])).toContain('Get-ChildItem')
    expect(String(argv[argv.length - 1])).toContain('UTF8')
  })
})

describe('ref_project gap fills (Reasonix write roots + pi deny-read)', () => {
  it('collectWritableRoots includes workspace', () => {
    const root = process.cwd()
    const roots = collectWritableRoots(root)
    expect(roots.some((r) => r.toLocaleLowerCase() === root.toLocaleLowerCase())).toBe(true)
  })

  it('defaultForbidReadRoots only returns existing sensitive dirs', () => {
    for (const p of defaultForbidReadRoots()) {
      expect(p.length).toBeGreaterThan(0)
    }
  })

  it('bwrap workspace_write binds multiple write roots when they exist', () => {
    const ws = process.cwd()
    const { argv, note } = createBwrapCommandArgs({
      command: ['true'],
      workspaceRoot: ws,
      mode: 'workspace_write',
      allowNetwork: false,
      bwrapPath: '/usr/bin/bwrap'
    })
    expect(argv[0]).toBe('/usr/bin/bwrap')
    expect(argv).toContain('--bind')
    expect(note).toMatch(/Reasonix|write roots/)
  })

  it('resolveShellArgv expands piped command via shell', () => {
    const r = resolveShellArgv({ command: 'echo hi | cat' })
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      // bash -lc or pwsh -Command
      expect(r.argv.length).toBeGreaterThanOrEqual(3)
      expect(r.argv.some((a) => a.includes('echo hi | cat') || a === '-lc' || a === '-Command')).toBe(
        true
      )
    }
  })
})

// silence unused imports in some envs
void join
void tmpdir
