import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

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

  write(level: string, message: string): void {
    if (!this.enabled || this.stopped) return
    const line = `${new Date().toISOString()} [${level}] ${message}\n`
    this.queue.push(line)
    void this.flush()
  }

  info(message: string): void {
    this.write('info', message)
  }

  warn(message: string): void {
    this.write('warn', message)
  }

  error(message: string): void {
    this.write('error', message)
  }

  /** Capture console warnings/errors without suppressing their normal output. */
  captureConsole(): void {
    if (this.consoleRestore) return

    const originalWarn = console.warn
    const originalError = console.error
    const capturedWarn = (...args: unknown[]) => {
      this.warn(formatConsoleArgs(args))
      originalWarn.apply(console, args)
    }
    const capturedError = (...args: unknown[]) => {
      this.error(formatConsoleArgs(args))
      originalError.apply(console, args)
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
      if ((!file.startsWith('studiumx') && !file.startsWith('teachos')) || !file.endsWith('.log')) continue
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

function formatConsoleArgs(args: unknown[]): string {
  return args.map(stringifyArg).join(' ')
}

function stringifyArg(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
