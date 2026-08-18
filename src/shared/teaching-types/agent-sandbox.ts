/**
 * Codex-aligned agent sandbox modes (ADR-0015).
 *
 * Orthogonal to AgentApprovalMode (AskForApproval):
 * - sandboxMode  = what the process may do (FS / network posture)
 * - approvalMode = when to ask the human
 *
 * UI must not label full_access as YOLO / DangerFullAccess / always-approve.
 */

export const AGENT_SANDBOX_MODES = [
  'read_only',
  'workspace_write',
  'full_access'
] as const

export type AgentSandboxMode = (typeof AGENT_SANDBOX_MODES)[number]

/** Codex protocol SandboxMode string (kebab-case). */
export type CodexSandboxModeWire = 'read-only' | 'workspace-write' | 'danger-full-access'

export function toCodexSandboxModeWire(mode: AgentSandboxMode): CodexSandboxModeWire {
  switch (mode) {
    case 'read_only':
      return 'read-only'
    case 'workspace_write':
      return 'workspace-write'
    case 'full_access':
      // Codex wire name; product UI still says「本课放行 / 全盘策略」not YOLO.
      return 'danger-full-access'
  }
}

/**
 * Codex workspace-write often disables outbound network by default;
 * full_access enables it. Pure helper shared by policy + OS transform.
 * Orthogonal to approvalMode (本课放行 / full_access approval).
 */
export function sandboxAllowsOutboundNetwork(mode: AgentSandboxMode): boolean {
  return mode === 'full_access'
}

export function fromCodexSandboxModeWire(raw: string | undefined | null): AgentSandboxMode | null {
  switch (String(raw ?? '').trim().toLocaleLowerCase()) {
    case 'read-only':
    case 'read_only':
    case 'readonly':
      return 'read_only'
    case 'workspace-write':
    case 'workspace_write':
      return 'workspace_write'
    case 'danger-full-access':
    case 'full_access':
    case 'full-access':
      return 'full_access'
    default:
      return null
  }
}

/**
 * Platform sandbox backend readiness (honest — not a Docker/VM claim).
 * Mirrors Codex SandboxType at a coarse level without shipping OS helpers yet.
 */
export type AgentSandboxBackendId =
  | 'none'
  | 'policy_fence'
  | 'windows_restricted_token'
  | 'linux_bwrap_landlock'
  | 'macos_seatbelt'

/** Codex WindowsSandboxLevel (config_types.rs). */
export type WindowsSandboxLevel = 'disabled' | 'restricted_token' | 'elevated'

export const WINDOWS_SANDBOX_LEVELS = [
  'disabled',
  'restricted_token',
  'elevated'
] as const

/** Codex WindowsSandboxReadiness protocol. */
export type WindowsSandboxReadiness = 'ready' | 'notConfigured' | 'updateRequired'

export type AgentSandboxReadiness = Readonly<{
  /** Effective sandbox mode after settings normalize. */
  mode: AgentSandboxMode
  /** Backend actually applied for this host (may be policy_fence only). */
  backend: AgentSandboxBackendId
  /** True when OS-level helper is available and would be used if mode requires it. */
  osEnforcementAvailable: boolean
  /** Human-readable, non-secret status for Doctor / tool results. */
  summary: string
  /** Codex wire mode for interoperability / diagnostics. */
  codexWire: CodexSandboxModeWire
  /** Codex WindowsSandboxLevel (Windows only diagnostics). */
  windowsSandboxLevel?: WindowsSandboxLevel
  /** Codex WindowsSandboxReadiness when on Windows. */
  windowsReadiness?: WindowsSandboxReadiness
}>

/**
 * Product-facing readiness copy (Stage E). Never YOLO / DangerFullAccess / always-approve.
 * Pure formatter — does not probe OS.
 */
export function formatAgentSandboxReadinessForUi(input: {
  mode: AgentSandboxMode
  backend: AgentSandboxBackendId
  osEnforcementAvailable: boolean
  platform?: string
  windowsReadiness?: WindowsSandboxReadiness
  summary?: string
}): string {
  const platform = input.platform ?? (typeof globalThis !== 'undefined' && typeof (globalThis as { process?: { platform?: string } }).process?.platform === 'string' ? (globalThis as { process?: { platform?: string } }).process!.platform! : 'unknown')
  const modeLabel =
    input.mode === 'read_only'
      ? '只读沙箱'
      : input.mode === 'workspace_write'
        ? '工作区可写'
        : '宽松策略'
  const os =
    input.osEnforcementAvailable
      ? platform === 'darwin'
        ? '命令级 OS 包装（Seatbelt）可用'
        : platform === 'linux'
          ? '命令级 OS 包装（bwrap/landlock）可用'
          : platform === 'win32'
            ? 'Windows 受限令牌包装可用'
            : '命令级 OS 包装可用'
      : platform === 'win32'
        ? '当前为策略围栏（Windows helper 未就绪）'
        : '当前为策略围栏（无 OS 强制）'
  const win =
    platform === 'win32' && input.windowsReadiness
      ? ` · Windows readiness=${input.windowsReadiness}`
      : ''
  const backend = `backend=${input.backend}`
  return `${modeLabel} · ${backend} · ${os}${win}`.slice(0, 280)
}

