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

function terminateWindowsProcessTree(pid) {
  return new Promise((resolveResult) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      resolveResult(result)
    }

    let taskkill
    try {
      taskkill = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      finish({
        attempted: true,
        succeeded: false,
        method: 'taskkill /PID /T /F',
        pid,
        error: serializeError(error),
        output: { stdout, stderr }
      })
      return
    }

    taskkill.stdout?.on('data', (chunk) => { stdout += Buffer.from(chunk).toString('utf8') })
    taskkill.stderr?.on('data', (chunk) => { stderr += Buffer.from(chunk).toString('utf8') })
    taskkill.once('error', (error) => {
      finish({
        attempted: true,
        succeeded: false,
        method: 'taskkill /PID /T /F',
        pid,
        error: serializeError(error),
        output: { stdout, stderr }
      })
    })
    taskkill.once('close', (exitCode, signal) => {
      finish({
        attempted: true,
        succeeded: exitCode === 0 && !signal,
        method: 'taskkill /PID /T /F',
        pid,
        error: exitCode === 0 && !signal ? null : `taskkill exited with code ${exitCode ?? 'null'}${signal ? ` and signal ${signal}` : ''}`,
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
