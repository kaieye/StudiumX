import type {
  TeachingMemoryDiagnostics,
  TeachingMemoryKind,
  TeachingMemoryRecord,
  TeachingSettingsV1
} from '../shared/teaching-types'
import { sanitizeMemoryInjectionText } from '../shared/memory-sanitize'
import { TeachingMemoryCatalog } from './teaching-memory-catalog'
import {
  PLATFORM_CAPABILITY_CONSUMERS,
  resolvePlatformCapability
} from './platform/platform-capability-registry'

export type TeachingMemoryRecallInput = {
  query: string
  workspaceRoot?: string
  limit?: number
  /** Optional kind filter (explicit memoryKind or stable kind tag resolution). */
  memoryKind?: TeachingMemoryKind | TeachingMemoryKind[]
}

/**
 * Applies the complete Teaching-memory recall policy to durable records.
 *
 * Callers receive only records selected for their request; scope eligibility,
 * settings, ranking, limits, and injection telemetry remain local here.
 * Content is sanitized at the recall→inject boundary (ADR-0076) before return.
 */
export class TeachingMemoryRecall {
  private lastInjectedCount = 0

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
    const active = (await this.options.catalog.list({
      ...(input.workspaceRoot ? { access: { workspaceRoot: input.workspaceRoot } } : {}),
      ...(input.memoryKind !== undefined ? { memoryKind: input.memoryKind } : {})
    })).filter((record) => !record.disabledAt)
    const userMemories = active.filter((record) => record.scope === 'user')
    const scored = active
      .filter((record) => record.scope !== 'user')
      .map((record) => ({ record, score: scoreMemory(record, input.query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
      .map((entry) => entry.record)
    const selected = [...userMemories, ...scored].slice(0, limit)
    const result = selected
      .map((record) => ({
        ...record,
        content: sanitizeMemoryInjectionText(record.content)
      }))
      .filter((record) => record.content.length > 0)
    this.setLastInjected(result.map((record) => record.id))
    return result
  }

  async diagnostics(): Promise<TeachingMemoryDiagnostics> {
    const settings = await this.options.settingsProvider()
    const snapshot = await this.options.catalog.diagnosticsSnapshot()
    const capability = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.memoryCatalog)
    return {
      enabled: settings.memory.enabled,
      activeCount: snapshot.activeCount,
      tombstoneCount: snapshot.tombstoneCount,
      lastInjectedCount: this.lastInjectedCount,
      legacyMigrationPreflight: snapshot.legacyMigrationPreflight,
      platformIoProfile: capability.profile,
      platformCapabilityCode: capability.code,
      platformCapabilityMessageKey: capability.messageKey
    }
  }

  /** Keeps renderer-facing telemetry aggregate-only; record IDs are never returned. */
  setLastInjected(ids: string[]): void {
    this.lastInjectedCount = ids.length
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
