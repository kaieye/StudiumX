import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MusicProvider } from '../../shared/music-types'

export type MusicCookieState = {
  netease: string
  qq: string
}

const EMPTY: MusicCookieState = { netease: '', qq: '' }

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

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await readFile(storePath(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<MusicCookieState>
      this.state = {
        netease: normalizeCookieText(parsed.netease),
        qq: normalizeCookieText(parsed.qq)
      }
    } catch {
      this.state = { ...EMPTY }
    }
    this.loaded = true
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
    await this.ensureLoaded()
    const normalized = normalizeCookieText(cookie)
    this.state[provider] = normalized
    await this.persist()
    return normalized
  }

  async clear(provider: MusicProvider): Promise<void> {
    await this.ensureLoaded()
    this.state[provider] = ''
    await this.persist()
  }

  private async persist(): Promise<void> {
    const path = storePath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(this.state, null, 2), 'utf8')
  }
}
