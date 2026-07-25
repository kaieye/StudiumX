/**
 * Codex-aligned OS sandbox transform (seatbelt / bwrap / Windows helper).
 * Readiness and argv transform share probeOsSandboxBackend so Doctor / tool
 * metadata never claim OS isolation that transform cannot apply.
 *
 * Windows: fail-closed notConfigured until Stage G implements the real helper
 * protocol — mere presence of codex-command-runner.exe must never flip ready.
 */

import { spawnSync } from 'node:child_process'
import {
  accessSync,
  constants as fsConstants,
  readFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import {
  type AgentSandboxMode,
  sandboxAllowsOutboundNetwork
} from '../../../shared/teaching-types/agent-sandbox'
import type { AgentSandboxBackendId } from '../../../shared/teaching-types/agent-sandbox'

/** Mirrors codex_sandboxing::SandboxType */
export type CodexSandboxType =
  | 'none'
  | 'macos_seatbelt'
  | 'linux_seccomp'
  | 'windows_restricted_token'

/** Mirrors codex_protocol::config_types::WindowsSandboxLevel */
export type WindowsSandboxLevel = 'disabled' | 'restricted_token' | 'elevated'

/** Mirrors SandboxablePreference */
export type SandboxablePreference = 'auto' | 'require' | 'forbid'

/** Codex WindowsSandboxReadiness wire */
export type WindowsSandboxReadiness = 'ready' | 'notConfigured' | 'updateRequired'

export type CodexOsSandboxPlan =
  | Readonly<{
      applied: true
      sandboxType: Exclude<CodexSandboxType, 'none'>
      argv: string[]
      env?: Record<string, string>
      note: string
    }>
  | Readonly<{
      applied: false
      sandboxType: CodexSandboxType
      argv: string[]
      reason: string
      windowsReadiness?: WindowsSandboxReadiness
    }>

/** Shared probe result for readiness + transform (Stage C unify). */
export type OsSandboxProbe = Readonly<{
  selectedType: CodexSandboxType
  /** True only when OS wrap can actually be applied on this host. */
  osEnforcementAvailable: boolean
  /** Backend that will be used (policy_fence when OS unavailable). */
  backend: AgentSandboxBackendId
  /** Human-readable availability / degradation reason. */
  reason: string
  windowsReadiness?: WindowsSandboxReadiness
  details?: Readonly<{
    seatbeltExecutable?: string
    resourceRoot?: string
    bwrapPath?: string
  }>
}>

const MACOS_SEATBELT_EXECUTABLE = '/usr/bin/sandbox-exec'

/** From codex linux-sandbox bwrap.rs LINUX_PLATFORM_DEFAULT_READ_ROOTS */
const LINUX_PLATFORM_DEFAULT_READ_ROOTS = [
  '/bin',
  '/sbin',
  '/usr',
  '/etc',
  '/lib',
  '/lib64',
  '/nix/store',
  '/run/current-system/sw'
] as const

function pathExists(path: string): boolean {
  try {
    accessSync(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return pathExists(path)
  }
}

/** Reasonix seatbelt writeAllowDirs + linuxWriteDirs (toolchain caches). */
export function collectWritableRoots(workspaceRoot: string): string[] {
  const dirs: string[] = [resolve(workspaceRoot)]
  if (process.platform !== 'win32') {
    dirs.push('/dev', '/tmp', '/private/tmp', '/private/var/folders')
  }
  dirs.push(tmpdir())
  try {
    const home = homedir()
    if (home) {
      for (const sub of [
        'Library/Caches',
        '.cache',
        '.npm',
        '.cargo',
        'go',
        join('.cache', 'pnpm'),
        join('.local', 'share', 'pnpm')
      ]) {
        dirs.push(join(home, sub))
      }
    }
  } catch {
    // ignore
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const d of dirs) {
    if (!d) continue
    const abs = resolve(d)
    if (process.platform === 'win32' && (abs.startsWith('/') || abs.startsWith('\\'))) {
      // skip unix-only roots on Windows
      if (d.startsWith('/')) continue
    }
    if (abs !== resolve(workspaceRoot) && !pathExists(abs)) continue
    const key = abs.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(abs)
  }
  return out
}

/** pi-main sandbox extension DEFAULT_CONFIG.filesystem.denyRead */
export function defaultForbidReadRoots(): string[] {
  try {
    const home = homedir()
    if (!home) return []
    return [join(home, '.ssh'), join(home, '.aws'), join(home, '.gnupg')].filter((p) =>
      pathExists(p)
    )
  } catch {
    return []
  }
}

/** codex_sandboxing::get_platform_sandbox */
export function getPlatformSandbox(windowsSandboxEnabled: boolean): CodexSandboxType | null {
  if (process.platform === 'darwin') return 'macos_seatbelt'
  if (process.platform === 'linux') return 'linux_seccomp'
  if (process.platform === 'win32') {
    return windowsSandboxEnabled ? 'windows_restricted_token' : null
  }
  return null
}

/**
 * codex policy_transforms::should_require_platform_sandbox (simplified to SandboxMode).
 * full_access ≈ unrestricted FS + network enabled → no platform sandbox required.
 * read_only / workspace_write ≈ restricted → require when Auto.
 */
export function shouldRequirePlatformSandbox(
  mode: AgentSandboxMode,
  pref: SandboxablePreference
): boolean {
  if (pref === 'forbid') return false
  if (pref === 'require') return true
  // Auto
  return mode !== 'full_access'
}

export function selectInitialSandboxType(input: {
  mode: AgentSandboxMode
  pref?: SandboxablePreference
  windowsSandboxLevel?: WindowsSandboxLevel
}): CodexSandboxType {
  const pref = input.pref ?? 'auto'
  const level = input.windowsSandboxLevel ?? 'restricted_token'
  if (!shouldRequirePlatformSandbox(input.mode, pref)) {
    return 'none'
  }
  // Prefer the host platform (not a faked platform string) for which OS sandbox type is selected.
  // Readiness may pass platform for diagnostics, but type selection still follows real host matrix
  // when called without override; probeOsSandboxBackend re-checks platform applicability.
  const platform = getPlatformSandbox(level !== 'disabled')
  return platform ?? 'none'
}

/**
 * Select initial sandbox type for a given platform (used by shared probe so readiness
 * can diagnose win32/linux/darwin without requiring the test host to match).
 */
export function selectInitialSandboxTypeForPlatform(input: {
  mode: AgentSandboxMode
  pref?: SandboxablePreference
  windowsSandboxLevel?: WindowsSandboxLevel
  platform: NodeJS.Platform
}): CodexSandboxType {
  const pref = input.pref ?? 'auto'
  const level = input.windowsSandboxLevel ?? 'restricted_token'
  if (!shouldRequirePlatformSandbox(input.mode, pref)) {
    return 'none'
  }
  if (input.platform === 'darwin') return 'macos_seatbelt'
  if (input.platform === 'linux') return 'linux_seccomp'
  if (input.platform === 'win32') {
    return level !== 'disabled' ? 'windows_restricted_token' : 'none'
  }
  return 'none'
}

export function findSystemBwrapInPath(envPath = process.env.PATH ?? ''): string | null {
  const parts = envPath.split(delimiter).filter(Boolean)
  for (const dir of parts) {
    const candidate = join(dir, process.platform === 'win32' ? 'bwrap.exe' : 'bwrap')
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

/** Optional spawn injector for unit tests (default: child_process.spawnSync). */
export type BwrapSpawnFn = (
  command: string,
  args: readonly string[],
  options: { timeout: number; encoding: 'utf8' }
) => {
  error?: Error | null
  status: number | null
  stderr?: string | Buffer | null
}

/** codex bwrap probe: user namespaces (best-effort, short timeout). */
export function systemBwrapHasUserNamespace(
  bwrapPath: string,
  spawn: BwrapSpawnFn = spawnSync as BwrapSpawnFn
): boolean {
  try {
    const result = spawn(
      bwrapPath,
      ['--unshare-user', '--unshare-net', '--ro-bind', '/', '/', '/bin/true'],
      { timeout: 500, encoding: 'utf8' }
    )
    // Spawn failure (ENOENT, EACCES, timeout error object, etc.) means unavailable — never treat as ready.
    if (result.error) return false
    const stderr = String(result.stderr ?? '')
    const failures = [
      'loopback: Failed RTM_NEWADDR',
      'loopback: Failed RTM_NEWLINK',
      'setting up uid map: Permission denied',
      'No permissions to create a new namespace'
    ]
    if (failures.some((f) => stderr.includes(f))) return false
    return result.status === 0
  } catch {
    return false
  }
}

export function resolveSandboxResourceRoot(): string | null {
  const candidates = [
    typeof process.resourcesPath === 'string'
      ? join(process.resourcesPath, 'sandbox')
      : null,
    // Electron app path variants (same pattern as builtin-skills)
    join(process.cwd(), 'resources', 'sandbox'),
    join(resolve(__dirname, '../../../../resources/sandbox'))
  ].filter((p): p is string => Boolean(p))

  for (const root of candidates) {
    if (pathExists(join(root, 'macos', 'seatbelt_base_policy.sbpl'))) return root
  }
  return null
}

function loadMacosSeatbeltPolicyText(resourceRoot: string): {
  base: string
  network: string
  platformDefaults: string
} {
  const macos = join(resourceRoot, 'macos')
  return {
    base: readFileSync(join(macos, 'seatbelt_base_policy.sbpl'), 'utf8'),
    network: readFileSync(join(macos, 'seatbelt_network_policy.sbpl'), 'utf8'),
    platformDefaults: readFileSync(join(macos, 'restricted_read_only_platform_defaults.sbpl'), 'utf8')
  }
}

/**
 * Subset of codex seatbelt::create_seatbelt_command_args for workspace-scoped modes.
 * Uses Codex-shipped .sbpl fragments + dynamic write/read roots for the teaching workspace.
 */
export function createSeatbeltCommandArgs(input: {
  command: string[]
  workspaceRoot: string
  mode: AgentSandboxMode
  allowNetwork: boolean
  resourceRoot: string
}): string[] {
  const policies = loadMacosSeatbeltPolicyText(input.resourceRoot)
  const root = resolve(input.workspaceRoot).replace(/\\/g, '/')

  // Codex builds file-write / file-read policies from writable/readable roots.
  // Write roots: workspace + Reasonix toolchain caches (seatbelt_darwin writeAllowDirs).
  const writeRoots = collectWritableRoots(input.workspaceRoot).map((p) => p.replace(/\\/g, '/'))
  const forbidRoots = defaultForbidReadRoots().map((p) => p.replace(/\\/g, '/'))

  const fileWritePolicy =
    input.mode === 'full_access'
      ? '(allow file-write* (regex #"^/"))'
      : [
          '; writable roots (Codex workspace-write + Reasonix writeAllowDirs)',
          '(deny file-write*)',
          '(allow file-write*',
          ...writeRoots.map((r) => `  (subpath "${r}")`),
          ')'
        ].join('\n')

  const fileReadPolicy =
    input.mode === 'read_only'
      ? [
          '; allow read-only file operations under workspace + platform defaults',
          '(allow file-read*',
          `  (subpath "${root}"))`
        ].join('\n')
      : [
          '; allow read-only file operations',
          '(allow file-read*)',
          // pi-main default denyRead (sensitive home paths)
          ...forbidRoots.map((r) => `(deny file-read* (subpath "${r}"))`)
        ].join('\n')

  const sections = [
    policies.base,
    fileReadPolicy,
    fileWritePolicy,
    input.mode === 'read_only' || input.mode === 'workspace_write' ? policies.platformDefaults : '',
    input.allowNetwork ? policies.network : '(deny network*)'
  ].filter(Boolean)

  const fullPolicy = sections.join('\n')
  return ['-p', fullPolicy, '--', ...input.command]
}

/**
 * Subset of codex linux-sandbox bwrap mounts for our three SandboxModes.
 * full_access + network → no bwrap wrap (Codex skips when full write + full net).
 * workspace_write → ro-bind / + bind workspace (+ unshare-net when network off).
 * read_only → tmpfs / + platform default ro-binds + ro-bind workspace.
 */
export function createBwrapCommandArgs(input: {
  command: string[]
  workspaceRoot: string
  mode: AgentSandboxMode
  allowNetwork: boolean
  bwrapPath: string
}): { argv: string[]; note: string } {
  const workspace = resolve(input.workspaceRoot)
  const unshareNet = !input.allowNetwork

  if (input.mode === 'full_access' && input.allowNetwork) {
    return {
      argv: input.command,
      note: 'Codex full-access + network: no bwrap wrap (create_bwrap_command_args skip path).'
    }
  }

  if (input.mode === 'full_access') {
    // create_bwrap_flags_full_filesystem: bind / / + unshare-user/pid + optional unshare-net
    const args = [
      input.bwrapPath,
      '--new-session',
      '--die-with-parent',
      '--bind',
      '/',
      '/',
      '--unshare-user',
      '--unshare-pid'
    ]
    if (unshareNet) args.push('--unshare-net')
    args.push('--proc', '/proc', '--', ...input.command)
    return { argv: args, note: 'Codex bwrap full filesystem + unshare-net.' }
  }

  if (input.mode === 'workspace_write') {
    // Codex workspace-write (ro-bind /) + Reasonix bwrapArgs (bind write roots, tmpfs forbid-read)
    const args = [
      input.bwrapPath,
      '--new-session',
      '--die-with-parent',
      '--ro-bind',
      '/',
      '/',
      '--dev',
      '/dev',
      '--proc',
      '/proc',
      '--tmpfs',
      '/tmp'
    ]
    if (unshareNet) args.push('--unshare-net')
    args.push('--unshare-user', '--unshare-pid')
    for (const root of collectWritableRoots(workspace)) {
      if (pathExists(root)) {
        args.push('--bind', root, root)
      }
    }
    for (const deny of defaultForbidReadRoots()) {
      if (pathExists(deny)) {
        args.push('--tmpfs', deny)
      }
    }
    args.push('--chdir', workspace, '--', ...input.command)
    return {
      argv: args,
      note: 'Codex+Reasonix bwrap workspace-write (ro-bind / + bind write roots + tmpfs deny-read).'
    }
  }

  // read_only: tmpfs root + platform defaults + ro-bind workspace
  const args = [
    input.bwrapPath,
    '--new-session',
    '--die-with-parent',
    '--tmpfs',
    '/',
    '--dev',
    '/dev'
  ]
  for (const root of LINUX_PLATFORM_DEFAULT_READ_ROOTS) {
    if (pathExists(root)) {
      args.push('--ro-bind', root, root)
    }
  }
  if (pathExists(workspace)) {
    args.push('--ro-bind', workspace, workspace)
  }
  for (const deny of defaultForbidReadRoots()) {
    if (pathExists(deny)) {
      args.push('--tmpfs', deny)
    }
  }
  args.push('--unshare-user', '--unshare-pid')
  if (unshareNet) args.push('--unshare-net')
  args.push('--proc', '/proc', '--chdir', workspace, '--', ...input.command)
  return {
    argv: args,
    note: 'Codex+pi bwrap read-only (tmpfs root + platform ro-binds + workspace; tmpfs deny-read).'
  }
}

/**
 * Windows sandbox helper readiness.
 *
 * Stage C0 / C: fail-closed until Stage G implements the full wrapper protocol
 * handshake. Presence of codex-command-runner.exe / setup exe on disk must NOT
 * report ready (would enable wrong-flag wrapping and a false OS-isolation claim).
 */
export function probeWindowsSandboxHelper(): {
  readiness: WindowsSandboxReadiness
  helperPath: string | null
} {
  return { readiness: 'notConfigured', helperPath: null }
}

/**
 * Unified OS backend probe used by resolveAgentSandboxReadiness and
 * transformArgvWithCodexSandbox so osEnforcementAvailable stays consistent with
 * whether transform can return applied:true.
 */
export function probeOsSandboxBackend(input: {
  mode: AgentSandboxMode
  platform?: NodeJS.Platform
  windowsSandboxLevel?: WindowsSandboxLevel
  pref?: SandboxablePreference
}): OsSandboxProbe {
  const platform = input.platform ?? process.platform
  const windowsLevel = input.windowsSandboxLevel ?? 'restricted_token'
  const selectedType = selectInitialSandboxTypeForPlatform({
    mode: input.mode,
    pref: input.pref,
    windowsSandboxLevel: windowsLevel,
    platform
  })

  if (selectedType === 'none') {
    return {
      selectedType: 'none',
      osEnforcementAvailable: false,
      backend: 'policy_fence',
      reason:
        'Platform sandbox not required for this SandboxMode (or Windows sandbox level disabled). policy_fence applies.'
    }
  }

  if (selectedType === 'macos_seatbelt') {
    if (platform !== 'darwin') {
      return {
        selectedType,
        osEnforcementAvailable: false,
        backend: 'policy_fence',
        reason: 'macOS seatbelt only applies on darwin; policy_fence on this host — no OS isolation claim.'
      }
    }
    if (!isExecutableFile(MACOS_SEATBELT_EXECUTABLE)) {
      return {
        selectedType,
        osEnforcementAvailable: false,
        backend: 'policy_fence',
        reason:
          'sandbox-exec unavailable at /usr/bin/sandbox-exec; policy_fence only — no OS isolation claim.'
      }
    }
    const resourceRoot = resolveSandboxResourceRoot()
    if (!resourceRoot) {
      return {
        selectedType,
        osEnforcementAvailable: false,
        backend: 'policy_fence',
        reason:
          'Codex seatbelt policy files not found under resources/sandbox/macos; policy_fence only — no OS isolation claim.'
      }
    }
    return {
      selectedType,
      osEnforcementAvailable: true,
      backend: 'macos_seatbelt',
      reason: 'Codex macOS seatbelt available (sandbox-exec + policy resources).',
      details: {
        seatbeltExecutable: MACOS_SEATBELT_EXECUTABLE,
        resourceRoot
      }
    }
  }

  if (selectedType === 'linux_seccomp') {
    if (platform !== 'linux') {
      return {
        selectedType,
        osEnforcementAvailable: false,
        backend: 'policy_fence',
        reason: `Linux bwrap sandbox not applicable on ${platform}; policy_fence only — no OS isolation claim.`
      }
    }
    const bwrap = findSystemBwrapInPath()
    if (!bwrap) {
      return {
        selectedType,
        osEnforcementAvailable: false,
        backend: 'policy_fence',
        reason:
          'bubblewrap not on PATH (Codex prerequisite); policy_fence only — no OS isolation claim.'
      }
    }
    if (!systemBwrapHasUserNamespace(bwrap)) {
      return {
        selectedType,
        osEnforcementAvailable: false,
        backend: 'policy_fence',
        reason:
          'bubblewrap found but user namespaces unavailable; policy_fence only — no OS isolation claim.'
      }
    }
    return {
      selectedType,
      osEnforcementAvailable: true,
      backend: 'linux_bwrap_landlock',
      reason: `Codex linux_seccomp available (system bwrap at ${bwrap}).`,
      details: { bwrapPath: bwrap }
    }
  }

  // windows_restricted_token
  if (platform !== 'win32') {
    return {
      selectedType: 'windows_restricted_token',
      osEnforcementAvailable: false,
      backend: 'policy_fence',
      reason: 'Windows RestrictedToken not applicable; policy_fence only — no OS isolation claim.',
      windowsReadiness: 'notConfigured'
    }
  }

  const win = probeWindowsSandboxHelper()
  // Always notConfigured / unavailable until Stage G full protocol.
  return {
    selectedType: 'windows_restricted_token',
    osEnforcementAvailable: false,
    backend: 'policy_fence',
    reason:
      'Windows sandbox helper protocol not implemented (WindowsSandboxReadiness=notConfigured). policy_fence only — no OS isolation claim. RestrictedToken wrapper requires a verified Stage G helper handshake.',
    windowsReadiness: win.readiness
  }
}

/**
 * Transform user argv through Codex platform sandbox when available.
 * On failure / missing helper: return applied:false with original argv (caller keeps policy_fence).
 */
export function transformArgvWithCodexSandbox(input: {
  argv: string[]
  workspaceRoot: string
  mode: AgentSandboxMode
  windowsSandboxLevel?: WindowsSandboxLevel
}): CodexOsSandboxPlan {
  const original = [...input.argv]
  const allowNetwork = sandboxAllowsOutboundNetwork(input.mode)
  const probe = probeOsSandboxBackend({
    mode: input.mode,
    windowsSandboxLevel: input.windowsSandboxLevel
  })

  if (probe.selectedType === 'none') {
    return {
      applied: false,
      sandboxType: 'none',
      argv: original,
      reason: `Codex select_initial: ${probe.reason}`
    }
  }

  if (!probe.osEnforcementAvailable) {
    return {
      applied: false,
      sandboxType: probe.selectedType,
      argv: original,
      reason: probe.reason,
      ...(probe.windowsReadiness !== undefined
        ? { windowsReadiness: probe.windowsReadiness }
        : {})
    }
  }

  if (probe.selectedType === 'macos_seatbelt') {
    const resourceRoot = probe.details?.resourceRoot
    const seatbelt = probe.details?.seatbeltExecutable ?? MACOS_SEATBELT_EXECUTABLE
    if (!resourceRoot) {
      return {
        applied: false,
        sandboxType: 'macos_seatbelt',
        argv: original,
        reason:
          'Codex seatbelt policy files not found under resources/sandbox/macos; policy_fence only — no OS isolation claim.'
      }
    }
    try {
      const seatbeltArgs = createSeatbeltCommandArgs({
        command: original,
        workspaceRoot: input.workspaceRoot,
        mode: input.mode,
        allowNetwork,
        resourceRoot
      })
      return {
        applied: true,
        sandboxType: 'macos_seatbelt',
        argv: [seatbelt, ...seatbeltArgs],
        note: 'Codex macOS seatbelt (sandbox-exec -p policy -- command).'
      }
    } catch (error) {
      return {
        applied: false,
        sandboxType: 'macos_seatbelt',
        argv: original,
        reason: `Codex seatbelt transform failed: ${error instanceof Error ? error.message : String(error)}. policy_fence only — no OS isolation claim.`
      }
    }
  }

  if (probe.selectedType === 'linux_seccomp') {
    const bwrap = probe.details?.bwrapPath
    if (!bwrap) {
      return {
        applied: false,
        sandboxType: 'linux_seccomp',
        argv: original,
        reason:
          'Codex could not find bubblewrap on PATH. Install bubblewrap with your OS package manager (see Codex sandbox prerequisites). policy_fence only — no OS isolation claim.'
      }
    }
    const { argv, note } = createBwrapCommandArgs({
      command: original,
      workspaceRoot: input.workspaceRoot,
      mode: input.mode,
      allowNetwork,
      bwrapPath: bwrap
    })
    if (
      argv === original ||
      (argv.length === original.length && argv.every((v, i) => v === original[i]))
    ) {
      return { applied: false, sandboxType: 'linux_seccomp', argv: original, reason: note }
    }
    return { applied: true, sandboxType: 'linux_seccomp', argv, note }
  }

  // windows_restricted_token: Stage G will implement real helper protocol.
  // Never wrap with guessed flags (C0 fail-closed).
  return {
    applied: false,
    sandboxType: 'windows_restricted_token',
    argv: original,
    reason:
      probe.reason ||
      'Windows sandbox helper protocol not implemented (WindowsSandboxReadiness=notConfigured). policy_fence only — no OS isolation claim.',
    windowsReadiness: probe.windowsReadiness ?? 'notConfigured'
  }
}

export function backendIdForSandboxType(type: CodexSandboxType): AgentSandboxBackendId {
  switch (type) {
    case 'macos_seatbelt':
      return 'macos_seatbelt'
    case 'linux_seccomp':
      return 'linux_bwrap_landlock'
    case 'windows_restricted_token':
      return 'windows_restricted_token'
    case 'none':
      return 'none'
  }
}

export function windowsLevelFromSettings(raw: unknown): WindowsSandboxLevel {
  const v = String(raw ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/-/g, '_')
  if (v === 'disabled') return 'disabled'
  if (v === 'elevated') return 'elevated'
  if (v === 'restricted_token' || v === 'restrictedtoken') return 'restricted_token'
  return 'restricted_token'
}
