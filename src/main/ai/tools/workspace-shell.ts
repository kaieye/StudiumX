/**
 * Workspace-bounded command / shell tool (ADR-0152 + ADR-0153).
 * Codex dual-axis: sandboxMode (FS posture) × approvalMode (AskForApproval).
 * Registered when tools.workspaceShell !== false (application-wide tools are enabled).
 * effect=privileged; path fence; not teaching Evidence.
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

import { isPathInsideRoot } from '../../path-access'
import { resolveWorkspacePathTarget } from './workspace-path-target'
import { isKnownSafeReadCommand, resolveShellArgv } from './shell-command-safety'
import { detectHardlineCommand } from './shell-hardline'
import { sanitizeShellChildEnv } from './shell-env-scrub'
import {
  evaluateShellUnderSandbox,
  resolveAgentSandboxReadiness
} from './agent-sandbox-policy'
import { transformArgvWithCodexSandbox, windowsLevelFromSettings } from './codex-sandbox-transform'
import type { AgentSandboxMode } from '../../../shared/teaching-types/agent-sandbox'
import { jsonResult } from './workspace'
import type { ToolContext, ToolEntry, ToolPermissionRequest } from './registry'

export const RUN_WORKSPACE_COMMAND_TOOL_NAME = 'run_workspace_command' as const

/** Max combined stdout+stderr bytes returned to the model (after capture). */
export const WORKSPACE_SHELL_MAX_OUTPUT_BYTES = 48 * 1024

const DEFAULT_TIMEOUT_MS = 30_000

function jsonError(message: string, extra?: Record<string, unknown>): string {
  return jsonResult({
    tool: RUN_WORKSPACE_COMMAND_TOOL_NAME,
    error: true,
    message,
    ...extra
  })
}

function truncateOutput(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return { text, truncated: false }
  return {
    text: buf.subarray(0, maxBytes).toString('utf8') + '\n…[truncated]',
    truncated: true
  }
}

async function describeWorkspaceShellPermission(
  args: unknown,
  ctx: ToolContext
): Promise<Omit<ToolPermissionRequest, 'id' | 'kind' | 'toolName'>> {
  const resolved = resolveShellArgv(args)
  if ('error' in resolved) {
    return {
      operation: 'run_workspace_command',
      reason: resolved.error,
      availableScopes: ['once', 'run']
    }
  }
  const hardline = detectHardlineCommand({ argv: resolved.argv })
  if (hardline.blocked) {
    return {
      operation: 'run_workspace_command',
      reason: hardline.reason.slice(0, 480),
      availableScopes: ['once', 'run']
    }
  }
  const preview = resolved.argv.slice(0, 8).join(' ')
  const safe = isKnownSafeReadCommand(resolved.argv)
  const sandboxMode: AgentSandboxMode = ctx.settings.tools.sandboxMode ?? 'workspace_write'
  const windowsLevel = windowsLevelFromSettings(ctx.settings.tools.windowsSandboxLevel)
  const readiness = resolveAgentSandboxReadiness({
    mode: sandboxMode,
    windowsSandboxLevel: windowsLevel
  })
  const backendNote = readiness.osEnforcementAvailable
    ? `expected backend=${readiness.backend}`
    : `expected backend=${readiness.backend} (may degrade to policy fence)`
  const cwd = resolved.cwdRelative || '.'
  const reason = [
    safe ? `Run known-safe read-oriented command: ${preview}` : `Run workspace command: ${preview}`,
    `cwd=${cwd}`,
    `sandboxMode=${sandboxMode}`,
    `knownSafe=${safe ? 'yes' : 'no'}`,
    backendNote
  ].join(' · ')
  return {
    operation: 'run_workspace_command',
    targetPath: resolved.cwdRelative,
    reason: reason.slice(0, 480),
    // creates=false → based_on_approval treats non-safe like overwrite (prompt);
    // safe commands get auto-allow via dedicated branch in resolveToolPermission.
    creates: false,
    availableScopes: ['once', 'run']
  }
}

/**
 * Kill a spawned child (and, on Unix, its process group when detached).
 *
 * Windows limits (documented only; Job Object/helper is Stage G):
 * - Node can only signal the direct child PID reliably.
 * - Grandchildren started by cmd/pwsh are not guaranteed to die with the parent.
 * - No process-group kill equivalent is applied here.
 */
function killSpawnedChild(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
  useProcessGroup: boolean
): void {
  try {
    if (useProcessGroup && process.platform !== 'win32' && typeof child.pid === 'number') {
      try {
        process.kill(-child.pid, signal)
        return
      } catch {
        // Fall through to direct child kill (e.g. ESRCH / EPERM).
      }
    }
    child.kill(signal)
  } catch {
    // ignore — process may already be gone
  }
}

function runSpawn(options: {
  argv: string[]
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<{
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
}> {
  return new Promise((resolvePromise) => {
    const [command, ...args] = options.argv
    if (!command) {
      resolvePromise({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: 'Empty argv.',
        timedOut: false,
        aborted: false
      })
      return
    }

    // Pre-aborted: settle without spawn, without throw, without arming timers (E5).
    if (options.signal?.aborted) {
      resolvePromise({
        exitCode: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: true
      })
      return
    }

    // Declare timer before finish/onAbort can run so abort never hits a TDZ on `timer`.
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    let aborted = false
    let settled = false

    // Unix: detach so we can kill the whole process group on timeout/abort.
    // Windows: keep non-detached; Job Object isolation is Stage G.
    const useProcessGroup = process.platform !== 'win32'
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: sanitizeShellChildEnv(process.env),
      shell: false,
      windowsHide: true,
      detached: useProcessGroup
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let captured = 0
    const push = (target: Buffer[], chunk: Buffer) => {
      if (captured >= WORKSPACE_SHELL_MAX_OUTPUT_BYTES * 2) return
      const room = WORKSPACE_SHELL_MAX_OUTPUT_BYTES * 2 - captured
      const slice = chunk.subarray(0, room)
      target.push(slice)
      captured += slice.length
    }

    child.stdout?.on('data', (chunk: Buffer) => push(stdoutChunks, chunk))
    child.stderr?.on('data', (chunk: Buffer) => push(stderrChunks, chunk))

    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      extra?: { timedOut?: boolean; aborted?: boolean }
    ) => {
      if (settled) return
      settled = true
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      options.signal?.removeEventListener('abort', onAbort)
      resolvePromise({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut: Boolean(extra?.timedOut ?? timedOut),
        aborted: Boolean(extra?.aborted ?? aborted)
      })
    }

    const onAbort = () => {
      aborted = true
      killSpawnedChild(child, 'SIGTERM', useProcessGroup)
      // Windows: TerminateProcess via SIGKILL immediately — no reliable graceful
      // group kill. Unix: short grace then process-group SIGKILL.
      if (process.platform === 'win32') {
        killSpawnedChild(child, 'SIGKILL', false)
      } else {
        setTimeout(() => {
          killSpawnedChild(child, 'SIGKILL', useProcessGroup)
        }, 1_500).unref?.()
      }
      finish(null, 'SIGTERM', { aborted: true })
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })

    timer = setTimeout(() => {
      timedOut = true
      killSpawnedChild(child, 'SIGTERM', useProcessGroup)
      // Force kill: immediate on Windows; grace period on Unix process groups.
      if (process.platform === 'win32') {
        killSpawnedChild(child, 'SIGKILL', false)
      } else {
        setTimeout(() => {
          killSpawnedChild(child, 'SIGKILL', useProcessGroup)
        }, 1_500).unref?.()
      }
      finish(null, 'SIGTERM', { timedOut: true })
    }, options.timeoutMs)
    timer.unref?.()

    child.on('error', (error) => {
      if (!stderrChunks.length) {
        stderrChunks.push(
          Buffer.from(error instanceof Error ? error.message : String(error), 'utf8')
        )
      }
      finish(null, null)
    })

    child.on('close', (code, signal) => {
      finish(code, signal)
    })
  })
}

export async function executeRunWorkspaceCommand(
  args: unknown,
  ctx: ToolContext
): Promise<string> {
  const resolved = resolveShellArgv(args)
  if ('error' in resolved) {
    return jsonError(resolved.error)
  }

  // Hardline floor (below 本课放行 / full_access): catastrophic host-destroying commands
  // never run. Product does not label this YOLO; full_access remains auto-allow for the run.
  const commandArg =
    args && typeof args === 'object' && 'command' in args && typeof (args as { command?: unknown }).command === 'string'
      ? String((args as { command: string }).command)
      : undefined
  const hardline = detectHardlineCommand({
    argv: resolved.argv,
    command: commandArg
  })
  if (hardline.blocked) {
    return jsonError(hardline.reason, {
      code: hardline.code,
      hardline: true,
      description: hardline.description
    })
  }

  const sandboxMode: AgentSandboxMode = ctx.settings.tools.sandboxMode ?? 'workspace_write'
  const sandboxDecision = evaluateShellUnderSandbox({ mode: sandboxMode, argv: resolved.argv })
  if (!sandboxDecision.allowed) {
    return jsonError(sandboxDecision.reason, {
      code: sandboxDecision.code,
      sandboxMode,
      readiness: resolveAgentSandboxReadiness({ mode: sandboxMode })
    })
  }

  let target
  try {
    // full_access still keeps cwd inside teaching workspace by default (product SoT).
    target = resolveWorkspacePathTarget(ctx.workspaceRoot, resolved.cwdRelative, '.')
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error))
  }

  // Ensure cwd exists and stays inside workspace (realpath when possible).
  const cwdAbsolute = resolve(target.absolutePath)
  if (!isPathInsideRoot(target.root, cwdAbsolute)) {
    return jsonError('cwd escapes the teaching workspace.')
  }

  const windowsLevel = windowsLevelFromSettings(ctx.settings.tools.windowsSandboxLevel)
  const osPlan = transformArgvWithCodexSandbox({
    argv: resolved.argv,
    workspaceRoot: target.root,
    mode: sandboxMode,
    windowsSandboxLevel: windowsLevel
  })
  const execArgv = osPlan.applied ? osPlan.argv : resolved.argv

  const result = await runSpawn({
    argv: execArgv,
    cwd: cwdAbsolute,
    timeoutMs: resolved.timeoutMs || DEFAULT_TIMEOUT_MS,
    signal: ctx.signal
  })

  const stdout = truncateOutput(result.stdout, WORKSPACE_SHELL_MAX_OUTPUT_BYTES)
  const stderr = truncateOutput(result.stderr, Math.floor(WORKSPACE_SHELL_MAX_OUTPUT_BYTES / 2))

  return jsonResult({
    tool: RUN_WORKSPACE_COMMAND_TOOL_NAME,
    ok: !result.timedOut && !result.aborted && result.exitCode === 0,
    argv: resolved.argv,
    cwd: target.relativePath,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    knownSafeRead: isKnownSafeReadCommand(resolved.argv),
    sandboxMode,
    sandbox: resolveAgentSandboxReadiness({
      mode: sandboxMode,
      windowsSandboxLevel: windowsLevel
    }),
    osSandbox: {
      applied: osPlan.applied,
      sandboxType: osPlan.sandboxType,
      note: osPlan.applied ? osPlan.note : osPlan.reason
    },
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    note:
      'Command output is not teaching Evidence or settlement authority (ADR-0152/0153).'
  })
}

export const runWorkspaceCommandTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'run_workspace_command',
      description:
        '在当前教学工作区内执行一条命令（argv 数组，不经 shell 字符串拼接）。cwd 必须是工作区相对路径。开启工具且 workspaceShell 未关闭时可用（主流 Agent 默认姿态）。输出有字节与超时上限；结果不是学习证据。审批遵循 Agent 权限三态（需批准 / 按风险 / 本课放行）。',
      parameters: {
        type: 'object',
        properties: {
          argv: {
            type: 'array',
            description: '命令与参数列表，例如 ["git","status"] 或 ["npm","test"]。优先使用 argv。',
            items: { type: 'string' }
          },
          command: {
            type: 'string',
            description:
              '可选：命令行字符串。无 shell 元字符时分词；含管道等时经 bash -lc / pwsh -Command（Reasonix）。'
          },
          cwd: {
            type: 'string',
            description: '相对工作区目录，默认 "."。'
          },
          timeoutMs: { type: 'number', description: '超时毫秒，默认 30000，最大 120000。' }, shell: { type: 'string', description: 'command 字符串时的解释器：auto | bash | powershell | pwsh（Reasonix）。' }
        },
        required: []
      }
    }
  },
  permission: {
    kind: 'workspace_write',
    describe: describeWorkspaceShellPermission
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
    risk: 'privileged'
  },
  capabilities: {
    isReadOnly: false,
    maxConcurrency: 1,
    supportsCancel: true,
    effectClass: 'privileged'
  },
  resultBudget: WORKSPACE_SHELL_MAX_OUTPUT_BYTES + 8 * 1024,
  handler: executeRunWorkspaceCommand
}

/**
 * Mainstream agent alias for run_workspace_command (same handler / contract).
 * Registered as secondary name so models that emit `shell` still work.
 */
export const SHELL_TOOL_NAME = 'shell' as const

export const shellTool: ToolEntry = {
  ...runWorkspaceCommandTool,
  definition: {
    type: 'function',
    function: {
      ...runWorkspaceCommandTool.definition.function,
      name: 'shell',
      description:
        'Alias of run_workspace_command for mainstream agent compatibility. Prefer argv. Workspace-fenced; sandboxMode × approvalMode (Codex dual-axis). Not teaching Evidence.'
    }
  }
}
