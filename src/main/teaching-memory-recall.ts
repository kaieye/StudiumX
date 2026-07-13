import type {
  TeachingMemoryDiagnostics,
  TeachingMemoryRecord,
  TeachingSettingsV1
} from '../shared/teaching-types'
import { TeachingMemoryCatalog } from './teaching-memory-catalog'

export type TeachingMemoryRecallInput = {
  query: string
  workspaceRoot?: string
  limit?: number
}

/**
 * Applies the complete Teaching-memory recall policy to durable records.
 *
 * Callers receive only records selected for their request; scope eligibility,
 * settings, ranking, limits, and injection telemetry remain local here.
 */
export class TeachingMemoryRecall {
  private lastInjectedIds: string[] = []

  constructor(
    private readonly options: {
      catalog: TeachingMemoryCatalog
      settingsProvider: () => Promise<TeachingSettingsV1>
    }
  ) {}

  async retrieve(input: TeachingMemoryRecallInput): Promise<TeachingMemoryRecord[]> {
    const settings = await this.options.settingsProvider()
    if (!settings.memory.enabled) {
      this.setLastInjected([])
      return []
    }
    const limit = Math.max(1, input.limit ?? settings.memory.maxInjected)
    const active = (await this.options.catalog.list(input.workspaceRoot)).filter((record) => !record.disabledAt)
    const userMemories = active.filter((record) => record.scope === 'user')
    const scored = active
      .filter((record) => record.scope !== 'user')
      .map((record) => ({ record, score: scoreMemory(record, input.query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
      .map((entry) => entry.record)
    const result = [...userMemories, ...scored].slice(0, limit)
    this.setLastInjected(result.map((record) => record.id))
    return result
  }

  async diagnostics(): Promise<TeachingMemoryDiagnostics> {
    const settings = await this.options.settingsProvider()
    const records = await this.options.catalog.readAll()
    return {
      enabled: settings.memory.enabled,
      rootDir: this.options.catalog.rootDir,
      activeCount: records.filter((record) => !record.deletedAt && !record.disabledAt).length,
      tombstoneCount: records.filter((record) => Boolean(record.deletedAt)).length,
      lastInjectedIds: [...this.lastInjectedIds]
    }
  }

  setLastInjected(ids: string[]): void {
    this.lastInjectedIds = [...ids]
  }
}

function scoreMemory(record: TeachingMemoryRecord, query: string): number {
  const queryGrams = ngrams(query)
  if (queryGrams.size === 0) return 0
  const textGrams = ngrams(`${record.content} ${record.tags.join(' ')}`)
  let overlap = 0
  for (const gram of queryGrams) {
    if (textGrams.has(gram)) overlap += 1
  }
  const coverage = overlap / queryGrams.size
  return (overlap + coverage) * record.confidence
}

function ngrams(input: string): Set<string> {
  const grams = new Set<string>()
  const normalized = input.toLowerCase()
  const asciiWords = normalized.match(/[a-z0-9_]{3,}/g) ?? []
  for (const word of asciiWords) {
    for (let index = 0; index + 3 <= word.length; index += 1) {
      grams.add(word.slice(index, index + 3))
    }
  }
  const cjkRuns = normalized.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? []
  for (const run of cjkRuns) {
    for (let index = 0; index + 2 <= run.length; index += 1) {
      grams.add(run.slice(index, index + 2))
    }
    if (run.length < 2) grams.add(run)
  }
  return grams
}
