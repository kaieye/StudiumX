import { describe, expect, it } from 'vitest'

import {
  evaluateShellUnderSandbox,
  normalizeAgentSandboxMode,
  resolveAgentSandboxReadiness,
  sandboxAllowsOutboundNetwork
} from '../../src/main/ai/tools/agent-sandbox-policy'
import { probeOsSandboxBackend, transformArgvWithCodexSandbox } from '../../src/main/ai/tools/codex-sandbox-transform'
import { toCodexSandboxModeWire } from '../../src/shared/teaching-types/agent-sandbox'

describe('agent-sandbox-policy (Codex dual-axis, ADR-0153)', () => {
  it('maps sandbox modes to Codex wire names', () => {
    expect(toCodexSandboxModeWire('read_only')).toBe('read-only')
    expect(toCodexSandboxModeWire('workspace_write')).toBe('workspace-write')
    expect(toCodexSandboxModeWire('full_access')).toBe('danger-full-access')
  })

  it('normalizes wire and snake forms', () => {
    expect(normalizeAgentSandboxMode('read-only')).toBe('read_only')
    expect(normalizeAgentSandboxMode('workspace-write')).toBe('workspace_write')
    expect(normalizeAgentSandboxMode('danger-full-access')).toBe('full_access')
    expect(normalizeAgentSandboxMode('nope', 'workspace_write')).toBe('workspace_write')
  })

  it('read_only allows only known-safe commands', () => {
    const ok = evaluateShellUnderSandbox({ mode: 'read_only', argv: ['git', 'status'] })
    expect(ok.allowed).toBe(true)
    const bad = evaluateShellUnderSandbox({ mode: 'read_only', argv: ['npm', 'install'] })
    expect(bad.allowed).toBe(false)
    if (!bad.allowed) expect(bad.code).toBe('sandbox_read_only')
  })

  it('workspace_write allows scripts subject to approval axis', () => {
    const r = evaluateShellUnderSandbox({ mode: 'workspace_write', argv: ['npm', 'test'] })
    expect(r.allowed).toBe(true)
    if (r.allowed) expect(r.autoApproveEligible).toBe(false)
  })

  it('readiness is honest about OS helpers', () => {
    const r = resolveAgentSandboxReadiness({ mode: 'workspace_write', platform: 'win32' })
    expect(r.backend).toBe('policy_fence')
    expect(r.osEnforcementAvailable).toBe(false)
    expect(r.codexWire).toBe('workspace-write')
    expect(r.summary).toMatch(/policy_fence/)
    expect(r.windowsReadiness).toBe('notConfigured')
  })

  it('network posture for shell policy (Codex workspace-write default: network off)', () => {
    expect(sandboxAllowsOutboundNetwork('read_only')).toBe(false)
    expect(sandboxAllowsOutboundNetwork('workspace_write')).toBe(false)
    expect(sandboxAllowsOutboundNetwork('full_access')).toBe(true)
  })
})

describe('Stage C — degradation matrix + shared probe', () => {
  it('win32 readiness uses shared probe: notConfigured and policy_fence for all restricted modes', () => {
    for (const mode of ['read_only', 'workspace_write', 'full_access'] as const) {
      const r = resolveAgentSandboxReadiness({ mode, platform: 'win32' })
      expect(r.osEnforcementAvailable).toBe(false)
      expect(r.backend).toBe('policy_fence')
      if (mode !== 'full_access') {
        // restricted modes select windows type then degrade; full_access select none
        expect(r.windowsReadiness).toBe('notConfigured')
      }
      expect(r.summary).toMatch(/policy_fence/)
      expect(r.summary).not.toMatch(/YOLO|DangerFullAccess|always-approve/i)
    }
  })

  it('resolveAgentSandboxReadiness matches probeOsSandboxBackend on host', () => {
    const mode = 'workspace_write' as const
    const r = resolveAgentSandboxReadiness({ mode, platform: process.platform })
    const probe = probeOsSandboxBackend({ mode, platform: process.platform })
    expect(r.osEnforcementAvailable).toBe(probe.osEnforcementAvailable)
    expect(r.backend).toBe(probe.backend)
  })

  it('readiness.osEnforcementAvailable never true when transform cannot apply on host', () => {
    const r = resolveAgentSandboxReadiness({
      mode: 'workspace_write',
      platform: process.platform
    })
    const plan = transformArgvWithCodexSandbox({
      argv: ['git', 'status'],
      workspaceRoot: process.cwd(),
      mode: 'workspace_write'
    })
    if (!r.osEnforcementAvailable) {
      expect(plan.applied).toBe(false)
    }
    if (plan.applied) {
      expect(r.osEnforcementAvailable).toBe(true)
    }
  })

  it('degradation does not pretend OS isolation in summary text', () => {
    const r = resolveAgentSandboxReadiness({ mode: 'workspace_write', platform: 'win32' })
    expect(r.osEnforcementAvailable).toBe(false)
    expect(r.summary).toMatch(/policy_fence|unavailable|notConfigured/i)
    expect(r.summary).not.toMatch(/Docker|VM-level|complete OS sandbox/i)
  })
})
