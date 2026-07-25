import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  createBwrapCommandArgs,
  createSeatbeltCommandArgs,
  findSystemBwrapInPath,
  getPlatformSandbox,
  probeOsSandboxBackend,
  probeWindowsSandboxHelper,
  selectInitialSandboxType,
  shouldRequirePlatformSandbox,
  systemBwrapHasUserNamespace,
  transformArgvWithCodexSandbox
} from '../../src/main/ai/tools/codex-sandbox-transform'

describe('codex-sandbox-transform (Codex manager/seatbelt/bwrap subset)', () => {
  it('get_platform_sandbox matches Codex platform matrix', () => {
    // We cannot change process.platform; only assert function shape for current host.
    const withWin = getPlatformSandbox(true)
    const withoutWin = getPlatformSandbox(false)
    if (process.platform === 'darwin') {
      expect(withWin).toBe('macos_seatbelt')
      expect(withoutWin).toBe('macos_seatbelt')
    } else if (process.platform === 'linux') {
      expect(withWin).toBe('linux_seccomp')
    } else if (process.platform === 'win32') {
      expect(withWin).toBe('windows_restricted_token')
      expect(withoutWin).toBeNull()
    }
  })

  it('should_require_platform_sandbox: full_access Auto → false (Codex unrestricted)', () => {
    expect(shouldRequirePlatformSandbox('full_access', 'auto')).toBe(false)
    expect(shouldRequirePlatformSandbox('workspace_write', 'auto')).toBe(true)
    expect(shouldRequirePlatformSandbox('read_only', 'auto')).toBe(true)
    expect(shouldRequirePlatformSandbox('full_access', 'require')).toBe(true)
    expect(shouldRequirePlatformSandbox('workspace_write', 'forbid')).toBe(false)
  })

  it('select_initial returns none for full_access auto', () => {
    expect(selectInitialSandboxType({ mode: 'full_access' })).toBe('none')
  })

  it('createBwrapCommandArgs workspace_write uses ro-bind / and bind workspace', () => {
    const { argv, note } = createBwrapCommandArgs({
      command: ['git', 'status'],
      workspaceRoot: '/tmp/ws',
      mode: 'workspace_write',
      allowNetwork: false,
      bwrapPath: '/usr/bin/bwrap'
    })
    expect(argv[0]).toBe('/usr/bin/bwrap')
    expect(argv).toContain('--ro-bind')
    expect(argv).toContain('--bind')
    expect(argv).toContain('--unshare-net')
    expect(argv).toContain('--')
    expect(argv.slice(-2)).toEqual(['git', 'status'])
    expect(note).toMatch(/workspace-write/)
  })

  it('createBwrapCommandArgs full_access+network skips wrap', () => {
    const { argv, note } = createBwrapCommandArgs({
      command: ['npm', 'test'],
      workspaceRoot: '/tmp/ws',
      mode: 'full_access',
      allowNetwork: true,
      bwrapPath: '/usr/bin/bwrap'
    })
    expect(argv).toEqual(['npm', 'test'])
    expect(note).toMatch(/no bwrap/)
  })

  it('createSeatbeltCommandArgs shape matches sandbox-exec -p --', () => {
    // Use empty policies via temp — function reads resources; if missing throw.
    // Unit-level: only check structure when resource root exists in repo.
    const resourceRoot = require('node:path').join(process.cwd(), 'resources', 'sandbox')
    const args = createSeatbeltCommandArgs({
      command: ['echo', 'hi'],
      workspaceRoot: '/Users/me/ws',
      mode: 'workspace_write',
      allowNetwork: false,
      resourceRoot
    })
    expect(args[0]).toBe('-p')
    expect(typeof args[1]).toBe('string')
    expect(args[1]).toContain('(deny default)')
    expect(args).toContain('--')
    expect(args.slice(-2)).toEqual(['echo', 'hi'])
  })

  it('transform on Windows without helper does not apply OS wrap', () => {
    if (process.platform !== 'win32') return
    const plan = transformArgvWithCodexSandbox({
      argv: ['git', 'status'],
      workspaceRoot: process.cwd(),
      mode: 'workspace_write',
      windowsSandboxLevel: 'restricted_token'
    })
    expect(plan.applied).toBe(false)
    expect(plan.sandboxType).toBe('windows_restricted_token')
    if (!plan.applied) {
      expect(plan.windowsReadiness).toBe('notConfigured')
      expect(plan.argv).toEqual(['git', 'status'])
      expect(plan.reason.length).toBeGreaterThan(20)
      expect(plan.reason).toMatch(/policy_fence|notConfigured/i)
    }
  })

  it('findSystemBwrapInPath returns string or null', () => {
    const found = findSystemBwrapInPath()
    expect(found === null || typeof found === 'string').toBe(true)
  })
})

describe('Stage C0 — Windows fail-closed', () => {
  it('probeWindowsSandboxHelper always returns notConfigured with null helperPath', () => {
    const probe = probeWindowsSandboxHelper()
    expect(probe.readiness).toBe('notConfigured')
    expect(probe.helperPath).toBeNull()
  })

  it('fake codex-command-runner.exe / setup exe on disk still notConfigured and applied:false', () => {
    const fakeDir = join(tmpdir(), `studiumx-fake-win-sandbox-${Date.now()}`)
    const windowsDir = join(fakeDir, 'resources', 'sandbox', 'windows')
    mkdirSync(windowsDir, { recursive: true })
    try {
      writeFileSync(join(windowsDir, 'codex-command-runner.exe'), 'fake')
      writeFileSync(join(windowsDir, 'codex-windows-sandbox-setup.exe'), 'fake')

      // Probe must ignore disk presence until Stage G protocol exists.
      const probe = probeWindowsSandboxHelper()
      expect(probe.readiness).toBe('notConfigured')
      expect(probe.helperPath).toBeNull()

      const readinessProbe = probeOsSandboxBackend({
        mode: 'workspace_write',
        platform: 'win32',
        windowsSandboxLevel: 'restricted_token'
      })
      expect(readinessProbe.osEnforcementAvailable).toBe(false)
      expect(readinessProbe.backend).toBe('policy_fence')
      expect(readinessProbe.windowsReadiness).toBe('notConfigured')
      expect(readinessProbe.reason).toMatch(/notConfigured|policy_fence|no OS isolation/i)

      // Transform must never wrap with wrong helper flags when readiness is notConfigured.
      if (process.platform === 'win32') {
        const plan = transformArgvWithCodexSandbox({
          argv: ['git', 'status'],
          workspaceRoot: process.cwd(),
          mode: 'workspace_write',
          windowsSandboxLevel: 'restricted_token'
        })
        expect(plan.applied).toBe(false)
        expect(plan.argv).toEqual(['git', 'status'])
        if (!plan.applied) {
          expect(plan.windowsReadiness).toBe('notConfigured')
          expect(plan.reason).not.toMatch(/--codex-run-as-fs-helper/)
          expect(plan.argv[0]).not.toMatch(/codex-command-runner/i)
        }
      }
    } finally {
      rmSync(fakeDir, { recursive: true, force: true })
    }
  })
})

describe('Stage C — honest backend probe', () => {
  it('systemBwrapHasUserNamespace treats result.error as unavailable (false)', () => {
    const ok = systemBwrapHasUserNamespace('/usr/bin/bwrap', () => ({
      error: new Error('spawn ENOENT'),
      status: null,
      stderr: ''
    }))
    expect(ok).toBe(false)
  })

  it('systemBwrapHasUserNamespace returns false on permission failures in stderr', () => {
    const ok = systemBwrapHasUserNamespace('/usr/bin/bwrap', () => ({
      error: null,
      status: 1,
      stderr: 'No permissions to create a new namespace'
    }))
    expect(ok).toBe(false)
  })

  it('systemBwrapHasUserNamespace returns true only on clean status 0', () => {
    const ok = systemBwrapHasUserNamespace('/usr/bin/bwrap', () => ({
      error: null,
      status: 0,
      stderr: ''
    }))
    expect(ok).toBe(true)
  })

  it('probeOsSandboxBackend win32 never claims OS enforcement', () => {
    const probe = probeOsSandboxBackend({
      mode: 'workspace_write',
      platform: 'win32'
    })
    expect(probe.osEnforcementAvailable).toBe(false)
    expect(probe.backend).toBe('policy_fence')
    expect(probe.windowsReadiness).toBe('notConfigured')
    expect(probe.reason).toMatch(/policy_fence|notConfigured|no OS isolation/i)
  })

  it('probeOsSandboxBackend full_access auto selects none / policy_fence', () => {
    const probe = probeOsSandboxBackend({
      mode: 'full_access',
      platform: 'win32'
    })
    expect(probe.selectedType).toBe('none')
    expect(probe.osEnforcementAvailable).toBe(false)
    expect(probe.backend).toBe('policy_fence')
  })

  it('probeOsSandboxBackend macOS without seatbelt reports policy_fence (non-darwin host)', () => {
    if (process.platform === 'darwin') return
    const probe = probeOsSandboxBackend({
      mode: 'workspace_write',
      platform: 'darwin'
    })
    // On non-darwin hosts, isExecutableFile('/usr/bin/sandbox-exec') is typically false.
    expect(probe.osEnforcementAvailable).toBe(false)
    expect(probe.backend).toBe('policy_fence')
    expect(probe.reason).toMatch(/seatbelt|sandbox-exec|policy_fence|no OS isolation/i)
  })

  it('applied:false reasons are human-readable for host transform', () => {
    const plan = transformArgvWithCodexSandbox({
      argv: ['git', 'status'],
      workspaceRoot: process.cwd(),
      mode: 'workspace_write'
    })
    if (!plan.applied) {
      expect(typeof plan.reason).toBe('string')
      expect(plan.reason.length).toBeGreaterThan(12)
      // Should not look like an internal code token only.
      expect(plan.reason).toMatch(/ |policy_fence|notConfigured|unavailable|sandbox/i)
    }
  })

  it('readiness.osEnforcementAvailable is consistent with transform applied possibility', () => {
    const probe = probeOsSandboxBackend({
      mode: 'workspace_write',
      platform: process.platform
    })
    const plan = transformArgvWithCodexSandbox({
      argv: ['git', 'status'],
      workspaceRoot: process.cwd(),
      mode: 'workspace_write'
    })
    if (!probe.osEnforcementAvailable) {
      expect(plan.applied).toBe(false)
    }
    // If applied true, readiness must have claimed availability.
    if (plan.applied) {
      expect(probe.osEnforcementAvailable).toBe(true)
    }
  })
})
