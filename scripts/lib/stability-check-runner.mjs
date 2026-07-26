import { spawn } from 'node:child_process'

export async function runCommand({
  command,
  args,
  cwd,
  timeoutMs,
  env = process.env,
  outputLimitBytes = 64 * 1024
}) {
  return new Promise((resolveResult) => {
    let stdout = ''
    let stderr = ''
    let truncated = false
    let settled = false
    let timedOut = false
    let closeResult = null
    let termination = null
    let timeout

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveResult({ ...result, stdout, stderr, truncated, termination })
    }

    const finishAfterClose = () => {
      if (!closeResult) return
      if (timedOut && !termination) return

      const { exitCode, signal } = closeResult
      if (timedOut) {
        const killFailure = termination?.succeeded ? '' : `; tree termination failed: ${termination?.error ?? 'unknown error'}`
        finish({
          kind: 'timeout',
          exitCode,
          signal,
          error: `Timed out after ${timeoutMs}ms${killFailure}`
        })
      } else if (signal) {
        finish({ kind: 'signal', exitCode, signal, error: null })
      } else if (exitCode === 0) {
        finish({ kind: 'passed', exitCode, signal: null, error: null })
      } else {
        finish({ kind: 'exit_code', exitCode, signal: null, error: null })
      }
    }

    let child
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      finish({
        kind: 'spawn_error',
        exitCode: null,
        signal: null,
        error: serializeError(error)
      })
      return
    }

    child.stdout?.on('data', (chunk) => {
      const captured = appendOutput(stdout, chunk, outputLimitBytes)
      stdout = captured.value
      truncated ||= captured.truncated
    })
    child.stderr?.on('data', (chunk) => {
      const captured = appendOutput(stderr, chunk, outputLimitBytes)
      stderr = captured.value
      truncated ||= captured.truncated
    })
    child.once('error', (error) => {
      finish({
        kind: 'spawn_error',
        exitCode: null,
        signal: null,
        error: serializeError(error)
      })
    })
    child.once('close', (exitCode, signal) => {
      closeResult = { exitCode, signal }
      finishAfterClose()
    })

    timeout = setTimeout(async () => {
      if (settled || closeResult) return
      timedOut = true
      termination = await terminateProcessTree(child)
      finishAfterClose()
    }, timeoutMs)
    timeout.unref()
  })
}

export async function terminateProcessTree(child) {
  const pid = child.pid
  if (!Number.isInteger(pid) || pid <= 0) {
    return {
      attempted: true,
      succeeded: false,
      method: 'unavailable',
      pid: pid ?? null,
      error: 'Child process did not expose a valid PID.'
    }
  }

  if (process.platform === 'win32') {
    return terminateWindowsProcessTree(pid)
  }

  try {
    process.kill(-pid, 'SIGTERM')
    return {
      attempted: true,
      succeeded: true,
      method: 'process-group SIGTERM',
      pid,
      error: null
    }
  } catch (groupError) {
    try {
      child.kill('SIGTERM')
      return {
        attempted: true,
        succeeded: false,
        method: 'process-group SIGTERM with direct-child fallback',
        pid,
        error: `Failed to terminate process group: ${serializeError(groupError)}`
      }
    } catch (childError) {
      return {
        attempted: true,
        succeeded: false,
        method: 'process-group SIGTERM',
        pid,
        error: `Failed to terminate process group: ${serializeError(groupError)}; direct-child fallback failed: ${serializeError(childError)}`
      }
    }
  }
}

async function terminateWindowsProcessTree(pid) {
  // taskkill /T resolves the tree from live parent-child links, so descendants
  // of an already-exited parent are invisible to it (orphaned workers survive).
  // Snapshot descendant PIDs first, kill the tree, then sweep the snapshot.
  const descendants = await listWindowsDescendantPids(pid)
  const main = await runWindowsTaskkill(['/PID', String(pid), '/T', '/F'])

  let sweptCount = 0
  let sweepError = null
  for (const descendantPid of descendants) {
    const sweep = await runWindowsTaskkill(['/PID', String(descendantPid), '/F'])
    if (sweep.ok || isWindowsProcessNotFound(sweep)) {
      sweptCount += 1
      continue
    }
    sweepError = sweepError ?? `descendant ${descendantPid}: ${sweep.error ?? 'unknown error'}`
  }

  const sweepComplete = sweepError === null
  // Success = the tree kill worked, or every snapshotted descendant is gone
  // (covers the dead-parent case where taskkill /T has nothing to resolve).
  const succeeded =
    (main.ok || isWindowsProcessNotFound(main)) && sweepComplete
  const errorParts = []
  if (!main.ok && !isWindowsProcessNotFound(main)) errorParts.push(main.error ?? 'taskkill failed')
  if (sweepError) errorParts.push(`orphan sweep failed: ${sweepError}`)

  return {
    attempted: true,
    succeeded,
    method: descendants.length > 0
      ? `taskkill /PID /T /F + orphan sweep (${sweptCount}/${descendants.length})`
      : 'taskkill /PID /T /F',
    pid,
    error: errorParts.length > 0 ? errorParts.join('; ') : null,
    output: main.output
  }
}

const WINDOWS_PID_SNAPSHOT_TIMEOUT_MS = 3_000
const WINDOWS_PID_SNAPSHOT_LIMIT = 64

/**
 * Best-effort recursive descendant PID snapshot via a single CIM process list.
 * Returns [] on any failure — the sweep is an additive safety net only.
 */
async function listWindowsDescendantPids(rootPid) {
  const listing = await runBoundedWindowsCommand(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'
    ],
    WINDOWS_PID_SNAPSHOT_TIMEOUT_MS
  )
  if (!listing.ok) return []

  const childrenByParent = new Map()
  for (const line of listing.output.stdout.split(/\r?\n/)) {
    const match = /^(\d+)\s+(\d+)\s*$/.exec(line.trim())
    if (!match) continue
    const childPid = Number(match[1])
    const parentPid = Number(match[2])
    if (!Number.isInteger(childPid) || !Number.isInteger(parentPid)) continue
    const list = childrenByParent.get(parentPid) ?? []
    list.push(childPid)
    childrenByParent.set(parentPid, list)
  }

  const descendants = []
  const queue = [rootPid]
  const seen = new Set([rootPid])
  while (queue.length > 0 && descendants.length < WINDOWS_PID_SNAPSHOT_LIMIT) {
    const current = queue.shift()
    for (const childPid of childrenByParent.get(current) ?? []) {
      if (seen.has(childPid)) continue
      seen.add(childPid)
      descendants.push(childPid)
      queue.push(childPid)
    }
  }
  return descendants
}

function isWindowsProcessNotFound(result) {
  if (result.ok) return false
  const text = `${result.output?.stderr ?? ''}${result.output?.stdout ?? ''}`
  // taskkill exits 128 with "not found" when the PID is already gone.
  return result.exitCode === 128 || /not found|没有找到|找不到/i.test(text)
}

function runWindowsTaskkill(args) {
  return runBoundedWindowsCommand('taskkill', args, 5_000)
}

function runBoundedWindowsCommand(command, args, timeoutMs) {
  return new Promise((resolveResult) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult(result)
    }

    let child
    try {
      child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolveResult({ ok: false, exitCode: null, error: serializeError(error), output: { stdout, stderr } })
      return
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* best effort */ }
      finish({ ok: false, exitCode: null, error: `${command} timed out after ${timeoutMs}ms`, output: { stdout, stderr } })
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => { stdout += Buffer.from(chunk).toString('utf8') })
    child.stderr?.on('data', (chunk) => { stderr += Buffer.from(chunk).toString('utf8') })
    child.once('error', (error) => {
      finish({ ok: false, exitCode: null, error: serializeError(error), output: { stdout, stderr } })
    })
    child.once('close', (exitCode, signal) => {
      const ok = exitCode === 0 && !signal
      finish({
        ok,
        exitCode,
        error: ok ? null : `${command} exited with code ${exitCode ?? 'null'}${signal ? ` and signal ${signal}` : ''}`,
        output: { stdout, stderr }
      })
    })
  })
}

function appendOutput(existing, chunk, outputLimitBytes) {
  const next = `${existing}${Buffer.from(chunk).toString('utf8')}`
  if (Buffer.byteLength(next) <= outputLimitBytes) return { value: next, truncated: false }

  const preserved = Buffer.from(next).subarray(-outputLimitBytes).toString('utf8')
  return { value: preserved, truncated: true }
}

function serializeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
