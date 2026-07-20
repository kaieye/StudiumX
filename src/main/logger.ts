import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { redactAgentSecretText } from '../shared/agent-secret-redaction'
import { normalizeTraceId } from '../shared/trace-context'

const MAX_LOG_MESSAGE_LENGTH = 2_000
const LOG_COMPONENTS = ['main'] as const
const LOG_TAGS = ['agent-archive', 'memory-catalog', 'learning-session-ledger', 'direct-lesson-action'] as const

export type SafeLogComponent = typeof LOG_COMPONENTS[number]
export type SafeLogTag = typeof LOG_TAGS[number]

/**
 * Narrow, non-user-controlled diagnostic context. Tags are a fixed vocabulary
 * so paths, provider identifiers, and user strings cannot become log labels.
 */
export type SafeLogContext = Readonly<{
  component?: SafeLogComponent
  tag?: SafeLogTag
  traceId?: string
}>

export type ParsedLogLine = Readonly<{
  timestamp: string
  level: string
  message: string
  component?: SafeLogComponent
  tag?: SafeLogTag
  traceId?: string
}>

export type LoggerChild = Readonly<{
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}>

/**
 * Durable diagnostic journal. It serializes best-effort file persistence,
 * retention, console diagnostics, and orderly shutdown behind the logger's
 * existing write/read interface.
 */
export class Logger {
  private readonly logPath: string
  private enabled: boolean
  private queue: string[] = []
  private flushPromise: Promise<void> | null = null
  private consoleRestore: (() => void) | null = null
  private shutdownPromise: Promise<void> | null = null
  private stopped = false

  constructor(options: { userDataPath: string; enabled: boolean; retentionDays: number }) {
    this.logPath = join(options.userDataPath, 'studiumx.log')
    this.enabled = options.enabled
    void this.purgeOldLogs(options.retentionDays)
  }

  configure(enabled: boolean, retentionDays: number): void {
    this.enabled = enabled
    void this.purgeOldLogs(retentionDays)
  }

  get path(): string {
    return this.logPath
  }

  /** Creates a fixed, safe context without changing legacy logger callers. */
  child(context: SafeLogContext): LoggerChild {
    const safeContext = normalizeLogContext(context)
    return {
      info: (message) => this.info(message, safeContext),
      warn: (message) => this.warn(message, safeContext),
      error: (message) => this.error(message, safeContext)
    }
  }

  write(level: string, message: string, context?: SafeLogContext): void {
    if (!this.enabled || this.stopped) return
    const safeContext = normalizeLogContext(context)
    const tags = formatLogContext(safeContext)
    const safeMessage = sanitizeLogMessage(message)
    const line = `${new Date().toISOString()} [${sanitizeLogLevel(level)}]${tags} ${safeMessage}\n`
    this.queue.push(line)
    void this.flush()
  }

  info(message: string, context?: SafeLogContext): void {
    this.write('info', message, context)
  }

  warn(message: string, context?: SafeLogContext): void {
    this.write('warn', message, context)
  }

  error(message: string, context?: SafeLogContext): void {
    this.write('error', message, context)
  }

  /** Capture console warnings/errors without suppressing their normal output. */
  captureConsole(): void {
    if (this.consoleRestore) return

    const originalWarn = console.warn
    const originalError = console.error
    const capturedWarn = (...args: unknown[]) => {
      const safeMessage = sanitizeLogMessage(formatConsoleArgs(args))
      this.warn(safeMessage)
      originalWarn.call(console, safeMessage)
    }
    const capturedError = (...args: unknown[]) => {
      const safeMessage = sanitizeLogMessage(formatConsoleArgs(args))
      this.error(safeMessage)
      originalError.call(console, safeMessage)
    }

    console.warn = capturedWarn
    console.error = capturedError
    this.consoleRestore = () => {
      if (console.warn === capturedWarn) console.warn = originalWarn
      if (console.error === capturedError) console.error = originalError
      this.consoleRestore = null
    }
  }

  /** Restore console methods and durably persist all journal entries accepted so far. */
  shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = (async () => {
        this.restoreConsole()
        await this.drain()
        this.stopped = true
      })()
    }
    return this.shutdownPromise
  }

  async purgeOldLogs(retentionDays: number): Promise<void> {
    const dir = dirname(this.logPath)
    const files = await readdir(dir).catch(() => [])
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    for (const file of files) {
      if ((!file.startsWith('studiumx')) || !file.endsWith('.log')) continue
      const full = join(dir, file)
      const info = await stat(full).catch(() => null)
      if (info && info.mtimeMs < cutoff) await unlink(full).catch(() => {})
    }
  }

  async rotate(): Promise<string | null> {
    await this.drain()
    const exists = await stat(this.logPath).then((info) => info.isFile()).catch(() => false)
    if (!exists) return null
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const archive = join(dirname(this.logPath), `studiumx-${stamp}.log`)
    try {
      await rename(this.logPath, archive)
      return archive
    } catch {
      return null
    }
  }

  async readTail(maxBytes = 8192): Promise<string> {
    await this.drain()
    const content = await readFile(this.logPath, 'utf8').catch(() => '')
    if (content.length <= maxBytes) return content
    return content.slice(-maxBytes)
  }

  private restoreConsole(): void {
    this.consoleRestore?.()
  }

  private async drain(): Promise<void> {
    while (this.flushPromise || this.queue.length > 0) {
      await this.flush()
    }
  }

  private flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise
    if (this.queue.length === 0) return Promise.resolve()

    this.flushPromise = (async () => {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.queue.length)
        try {
          await mkdir(dirname(this.logPath), { recursive: true })
          await writeFile(this.logPath, batch.join(''), { flag: 'a' })
        } catch {
          // Logging must never break the app. The failed batch is intentionally discarded.
        }
      }
    })().finally(() => {
      this.flushPromise = null
      if (this.queue.length > 0) void this.flush()
    })

    return this.flushPromise
  }
}

/** Parses both legacy text lines and the optional tagged C-5 line format. */
export function parseLoggerLine(line: string): ParsedLogLine | null {
  const base = /^(\S+) \[([^\]]+)\] (.*?)(?:\r?\n)?$/.exec(line)
  if (!base) return null
  const [, timestamp, level, rawRest] = base
  if (!timestamp || !level || rawRest === undefined) return null

  let rest = rawRest
  const parsed: { component?: SafeLogComponent; tag?: SafeLogTag; traceId?: string } = {}
  const component = /^\[([^\]]+)\] /.exec(rest)
  if (component && isSafeLogComponent(component[1])) {
    parsed.component = component[1]
    rest = rest.slice(component[0].length)
  }
  const tag = /^\[([^\]]+)\] /.exec(rest)
  if (tag && isSafeLogTag(tag[1])) {
    parsed.tag = tag[1]
    rest = rest.slice(tag[0].length)
  }
  const trace = /^\[trace=([^\]]+)\] /.exec(rest)
  const traceId = trace ? normalizeTraceId(trace[1]) : undefined
  if (trace && traceId) {
    parsed.traceId = traceId
    rest = rest.slice(trace[0].length)
  }

  return { timestamp, level, message: rest, ...parsed }
}

function normalizeLogContext(context: SafeLogContext | undefined): SafeLogContext {
  if (!context) return {}
  return {
    component: isSafeLogComponent(context.component) ? context.component : undefined,
    tag: isSafeLogTag(context.tag) ? context.tag : undefined,
    traceId: normalizeTraceId(context.traceId)
  }
}

function formatLogContext(context: SafeLogContext): string {
  return [
    context.component ? `[${context.component}]` : '',
    context.tag ? `[${context.tag}]` : '',
    context.traceId ? `[trace=${context.traceId}]` : ''
  ].filter(Boolean).map((value) => ` ${value}`).join('')
}

function sanitizeLogLevel(level: string): string {
  return /^[a-z0-9_-]{1,24}$/i.test(level) ? level : 'info'
}

function sanitizeLogMessage(message: string): string {
  let redacted: string
  try {
    redacted = redactAgentSecretText(typeof message === 'string' ? message : '[invalid log message]')
  } catch {
    return '[log message omitted]'
  }
  const singleLine = redacted.replace(/[\r\n]+/g, ' ').trim() || '[empty log message]'
  return singleLine.length <= MAX_LOG_MESSAGE_LENGTH
    ? singleLine
    : `${singleLine.slice(0, MAX_LOG_MESSAGE_LENGTH)}…[truncated]`
}

function formatConsoleArgs(args: unknown[]): string {
  if (args.length === 0) return '[console call without text]'
  return args.map((value) => {
    if (typeof value === 'string') return value
    if (value instanceof Error) return `Error: ${value.message}`
    return '[console value omitted]'
  }).join(' ')
}

function isSafeLogComponent(value: unknown): value is SafeLogComponent {
  return typeof value === 'string' && (LOG_COMPONENTS as readonly string[]).includes(value)
}

function isSafeLogTag(value: unknown): value is SafeLogTag {
  return typeof value === 'string' && (LOG_TAGS as readonly string[]).includes(value)
}
