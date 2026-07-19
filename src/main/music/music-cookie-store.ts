import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MusicProvider } from '../../shared/music-types'
import { replaceDurably, type DurableFileOperations } from '../persistence/durable-file'

export type MusicCookieState = {
  netease: string
  qq: string
}

export type MusicCookieStoreOptions = {
  path?: string
  operations?: DurableFileOperations
  warn?: (message: string) => void
}

const EMPTY: MusicCookieState = { netease: '', qq: '' }

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function storePath(): string {
  return join(app.getPath('userData'), 'music-cookies.json')
}

export function normalizeCookieText(value: string | null | undefined): string {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/;+$/, ''))
    .filter(Boolean)
    .join('; ')
}

export function parseCookieHeader(cookieText: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(cookieText || '').split(/[;\n\r]+/)) {
    const raw = part.trim()
    if (!raw) continue
    const index = raw.indexOf('=')
    if (index <= 0) continue
    const key = raw.slice(0, index).trim()
    const value = raw.slice(index + 1).trim().replace(/;+$/, '')
    if (key) out[key] = value
  }
  return out
}

export class MusicCookieStore {
  private state: MusicCookieState = { ...EMPTY }
  private loaded = false
  private readonly configuredPath: string | undefined
  private initialLoad: Promise<void> | undefined
  private mutationTail: Promise<void> = Promise.resolve()
  private requiresCanonicalRefresh = false

  constructor(private readonly options: MusicCookieStoreOptions = {}) {
    this.configuredPath = options.path
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.initialLoad ??= this.loadInitialState()
    await this.initialLoad
  }

  async get(provider: MusicProvider): Promise<string> {
    await this.ensureLoaded()
    return this.state[provider] || ''
  }

  async getAll(): Promise<MusicCookieState> {
    await this.ensureLoaded()
    return { ...this.state }
  }

  async set(provider: MusicProvider, cookie: string): Promise<string> {
    return this.serializeMutation(async () => {
      await this.prepareMutation()
      const normalized = normalizeCookieText(cookie)
      const candidate = { ...this.state, [provider]: normalized }
      await this.persist(candidate)
      this.state = candidate
      return normalized
    })
  }

  async clear(provider: MusicProvider): Promise<void> {
    return this.serializeMutation(async () => {
      await this.prepareMutation()
      const candidate = { ...this.state, [provider]: '' }
      await this.persist(candidate)
      this.state = candidate
    })
  }

  private async loadInitialState(): Promise<void> {
    try {
      this.state = await this.readCanonicalState()
    } catch {
      this.state = { ...EMPTY }
    }
    this.loaded = true
  }

  private async prepareMutation(): Promise<void> {
    await this.ensureLoaded()
    if (!this.requiresCanonicalRefresh) return
    this.state = await this.readCanonicalState()
    this.requiresCanonicalRefresh = false
  }

  private async readCanonicalState(): Promise<MusicCookieState> {
    let raw: string
    try {
      raw = this.options.operations
        ? await this.options.operations.readFile(this.filePath(), 'utf8')
        : await readFile(this.filePath(), 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return { ...EMPTY }
      throw error
    }

    try {
      const parsed = JSON.parse(raw) as Partial<MusicCookieState>
      return {
        netease: normalizeCookieText(parsed.netease),
        qq: normalizeCookieText(parsed.qq)
      }
    } catch {
      return { ...EMPTY }
    }
  }

  private serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationTail.then(mutation, mutation)
    this.mutationTail = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  private filePath(): string {
    return this.configuredPath ?? storePath()
  }

  private async persist(candidate: MusicCookieState): Promise<void> {
    try {
      await replaceDurably({
        path: this.filePath(),
        content: JSON.stringify(candidate, null, 2),
        mode: 0o600,
        operations: this.options.operations,
        warn: this.options.warn
      })
    } catch (error) {
      this.requiresCanonicalRefresh = true
      throw error
    }
  }
}
