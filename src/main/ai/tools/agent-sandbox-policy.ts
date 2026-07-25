/**
 * Pure agent sandbox policy + Codex OS readiness (ADR-0153 Phase 1–2).
 * Policy decisions have no I/O; readiness uses the shared OS probe
 * (probeOsSandboxBackend) so Doctor / tool metadata match transform applied.
 */

import {
  type AgentSandboxMode,
  type AgentSandboxReadiness,
  type WindowsSandboxLevel,
  sandboxAllowsOutboundNetwork as sharedSandboxAllowsOutboundNetwork,
  toCodexSandboxModeWire
} from '../../../shared/teaching-types/agent-sandbox'
import { isKnownSafeReadCommand } from './shell-command-safety'
import {
  probeOsSandboxBackend,
  windowsLevelFromSettings
} from './codex-sandbox-transform'

export type ShellSandboxDecision =
  | Readonly<{ allowed: true; autoApproveEligible: boolean; reason: string }>
  | Readonly<{ allowed: false; reason: string; code: string }>

/**
 * Whether a shell argv may run under the given sandbox mode.
 * Codex SandboxMode posture (orthogonal to AskForApproval).
 */
export function evaluateShellUnderSandbox(input: {
  mode: AgentSandboxMode
  argv: readonly string[]
}): ShellSandboxDecision {
  const argv = [...input.argv]
  if (!argv.length) {
    return { allowed: false, code: 'empty_argv', reason: 'Empty command argv.' }
  }

  const safeRead = isKnownSafeReadCommand(argv)

  switch (input.mode) {
    case 'read_only':
      if (!safeRead) {
        return {
          allowed: false,
          code: 'sandbox_read_only',
          reason:
            'Sandbox mode is read_only (Codex read-only): only known-safe read-oriented commands are allowed. Switch to workspace_write or full_access for builds/scripts.'
        }
      }
      return {
        allowed: true,
        autoApproveEligible: true,
        reason: 'read_only sandbox: known-safe read command.'
      }
    case 'workspace_write':
      return {
        allowed: true,
        autoApproveEligible: safeRead,
        reason: safeRead
          ? 'workspace_write sandbox: known-safe read command (eligible for risk-based auto-allow).'
          : 'workspace_write sandbox: command permitted inside workspace fence; subject to approvalMode.'
      }
    case 'full_access':
      return {
        allowed: true,
        autoApproveEligible: true,
        reason:
          'full_access sandbox: host policy allows broader execution; still subject to approvalMode and path fence unless host opts out of fence.'
      }
    default: {
      const _exhaustive: never = input.mode
      return {
        allowed: false,
        code: 'unknown_sandbox_mode',
        reason: `Unknown sandbox mode: ${String(_exhaustive)}`
      }
    }
  }
}

/** Codex workspace-write often disables network by default; full_access enables. */
export function sandboxAllowsOutboundNetwork(mode: AgentSandboxMode): boolean {
  return sharedSandboxAllowsOutboundNetwork(mode)
}

/**
 * Resolve readiness for Doctor / tool metadata (Codex dual-axis + platform probe).
 * Uses the same probeOsSandboxBackend as transformArgvWithCodexSandbox.
 */
export function resolveAgentSandboxReadiness(input: {
  mode: AgentSandboxMode
  platform?: NodeJS.Platform
  windowsSandboxLevel?: WindowsSandboxLevel | string
}): AgentSandboxReadiness {
  const platform = input.platform ?? process.platform
  const mode = input.mode
  const codexWire = toCodexSandboxModeWire(mode)
  const windowsLevel = windowsLevelFromSettings(input.windowsSandboxLevel ?? 'restricted_token')

  const probe = probeOsSandboxBackend({
    mode,
    platform,
    windowsSandboxLevel: windowsLevel
  })

  // Degradation: when OS backend unavailable → policy_fence; do not pretend OS isolation.
  const summary =
    probe.selectedType === 'none'
      ? `Sandbox mode=${mode} (Codex ${codexWire}); ${probe.reason}`
      : probe.osEnforcementAvailable
        ? `Sandbox mode=${mode}; Codex backend=${probe.backend}. ${probe.reason}`
        : `Sandbox mode=${mode}; OS backend unavailable → policy_fence. ${probe.reason}`

  return {
    mode,
    backend: probe.backend,
    osEnforcementAvailable: probe.osEnforcementAvailable,
    summary,
    codexWire,
    ...(platform === 'win32'
      ? {
          windowsSandboxLevel: windowsLevel,
          windowsReadiness: probe.windowsReadiness ?? 'notConfigured'
        }
      : {})
  }
}

export function normalizeAgentSandboxMode(
  input: unknown,
  fallback: AgentSandboxMode = 'workspace_write'
): AgentSandboxMode {
  if (typeof input !== 'string') return fallback
  const key = input.trim().toLocaleLowerCase().replace(/-/g, '_')
  if (key === 'read_only' || key === 'readonly') return 'read_only'
  if (key === 'workspace_write' || key === 'workspacewrite') return 'workspace_write'
  if (key === 'full_access' || key === 'fullaccess' || key === 'danger_full_access') {
    return 'full_access'
  }
  if (input === 'read-only') return 'read_only'
  if (input === 'workspace-write') return 'workspace_write'
  if (input === 'danger-full-access') return 'full_access'
  return fallback
}
