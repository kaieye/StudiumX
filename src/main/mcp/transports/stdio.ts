/**
 * MCP stdio transport — minimal JSON-RPC over child_process (ADR-0128 §4.1).
 *
 * Uses spawn(command, args, { shell: false }). No official SDK dependency
 * (pin decision: minimal JSON-RPC Content-Length framing subset).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { McpCallToolResult, McpToolListItem, McpTransport } from './types'

export type StdioMcpTransportOptions = {
  serverId: string
  command: string
  args: readonly string[]
  cwd?: string | null
  env: Record<string, string>
  initializeTimeoutMs?: number
  listTimeoutMs?: number
  callTimeoutMs?: number
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Create a stdio MCP transport. Lazy: process starts on first initialize().
 */
export function createStdioMcpTransport(options: StdioMcpTransportOptions): McpTransport {
  let child: ChildProcessWithoutNullStreams | null = null
  let nextId = 1
  const pending = new Map<number | string, Pending>()
  let buffer = Buffer.alloc(0)
  let initialized = false
  let closed = false

  const initializeTimeoutMs = options.initializeTimeoutMs ?? 30_000
  const listTimeoutMs = options.listTimeoutMs ?? 30_000
  const callTimeoutMs = options.callTimeoutMs ?? 60_000

  function ensureChild(): ChildProcessWithoutNullStreams {
    if (closed) throw new Error('transport closed')
    if (child) return child

    child = spawn(options.command, [...options.args], {
      shell: false,
      cwd: options.cwd ?? undefined,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    child.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      drainBuffer()
    })

    child.stderr.on('data', () => {
      // Intentionally ignore stderr content (may contain secrets); availability only.
    })

    child.on('exit', () => {
      failAllPending(new Error('mcp child exited'))
      child = null
      initialized = false
    })

    child.on('error', (error) => {
      failAllPending(error instanceof Error ? error : new Error(String(error)))
      child = null
      initialized = false
    })

    return child
  }

  function failAllPending(error: Error): void {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
      pending.delete(id)
    }
  }

  function drainBuffer(): void {
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const headerText = buffer.subarray(0, headerEnd).toString('utf8')
      const match = /Content-Length:\s*(\d+)/i.exec(headerText)
      if (!match) {
        // Skip malformed header line.
        buffer = buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (buffer.length < bodyStart + length) return
      const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
      buffer = buffer.subarray(bodyStart + length)
      try {
        handleMessage(JSON.parse(body) as Record<string, unknown>)
      } catch {
        // ignore malformed JSON body
      }
    }
  }

  function handleMessage(message: Record<string, unknown>): void {
    if (message.id == null) return // notification
    const id = message.id as number | string
    const entry = pending.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(id)
    if (message.error) {
      const err = message.error as { message?: string }
      entry.reject(new Error(err.message ?? 'mcp rpc error'))
      return
    }
    entry.resolve(message.result)
  }

  function send(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const proc = ensureChild()
    const id = nextId++
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {})
    })
    const frame = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('aborted'))
        return
      }

      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('mcp timeout'))
      }, timeoutMs)

      const onAbort = (): void => {
        clearTimeout(timer)
        pending.delete(id)
        reject(new Error('aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(value)
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
        timer
      })

      try {
        proc.stdin.write(frame)
      } catch (error) {
        clearTimeout(timer)
        pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async function killChild(): Promise<void> {
    if (!child) return
    const proc = child
    child = null
    initialized = false
    failAllPending(new Error('transport closed'))
    return new Promise((resolve) => {
      const force = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          // ignore
        }
        resolve()
      }, 2_000)
      proc.once('exit', () => {
        clearTimeout(force)
        resolve()
      })
      try {
        proc.kill('SIGTERM')
      } catch {
        clearTimeout(force)
        resolve()
      }
    })
  }

  return {
    serverId: options.serverId,
    async initialize(signal) {
      if (initialized) return
      try {
        await send(
          'initialize',
          {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'studiumx', version: '0.0.0' }
          },
          initializeTimeoutMs,
          signal
        )
        // notifications/initialized (no id)
        const proc = ensureChild()
        const note = JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized'
        })
        proc.stdin.write(
          `Content-Length: ${Buffer.byteLength(note, 'utf8')}\r\n\r\n${note}`
        )
        initialized = true
      } catch (error) {
        await killChild()
        throw error
      }
    },
    async listTools(signal) {
      if (!initialized) await this.initialize(signal)
      const result = (await send('tools/list', {}, listTimeoutMs, signal)) as {
        tools?: McpToolListItem[]
      }
      return Array.isArray(result?.tools) ? result.tools : []
    },
    async callTool(name, args, signal) {
      if (!initialized) await this.initialize(signal)
      const result = (await send(
        'tools/call',
        { name, arguments: args },
        callTimeoutMs,
        signal
      )) as McpCallToolResult
      return result ?? { content: null }
    },
    async close() {
      closed = true
      await killChild()
    }
  }
}

