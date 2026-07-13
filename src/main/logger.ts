import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Minimal file logger — writes to `userData/studiumx.log` and rotates by
 * retention window. The main process pipes console warnings/errors here so
 * users can attach diagnostics from Settings > 通用.
 */
export class Logger {
  private readonly logPath: string
  private enabled: boolean
  private queue: string[] = []
  private flushing = false

  constructor(options: { userDataPath: string; enabled: boolean; retentionDays: number }) {
    this.logPath = join(options.userDataPath, 'studiumx.log')
    this.enabled = options.enabled
  }

  configure(enabled: boolean, retentionDays: number): void {
    this.enabled = enabled
    void this.purgeOldLogs(retentionDays)
  }

  get path(): string {
    return this.logPath
  }

  write(level: string, message: string): void {
    if (!this.enabled) return
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

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return
    this.flushing = true
    const batch = this.queue.splice(0, this.queue.length)
    try {
      await mkdir(dirname(this.logPath), { recursive: true })
      await writeFile(this.logPath, batch.join(''), { flag: 'a' })
    } catch {
      // swallow — logging must never break the app
    } finally {
      this.flushing = false
      if (this.queue.length > 0) void this.flush()
    }
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
    const content = await readFile(this.logPath, 'utf8').catch(() => '')
    if (content.length <= maxBytes) return content
    return content.slice(-maxBytes)
  }
}
