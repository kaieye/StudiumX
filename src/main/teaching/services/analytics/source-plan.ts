import type { AnalyticsSectionId, AnalyticsWarning, LearningAnalyticsBundle } from '../../../../shared/teaching-types'

export type LearningAnalyticsSourceId =
  | 'workspace_catalog'
  | 'token_evidence'
  | 'workspace_assets'
  | 'review_sources'
  | 'memory_store'
  | 'platform_sources'
  | 'personal_study'
  | 'presence_snapshot'
  | 'insight_derivation'

export type LearningAnalyticsInvalidation =
  | LearningAnalyticsSourceId
  | 'workspace'
  | 'conversation'
  | 'ledger'
  | 'learning_record'
  | 'reference'
  | 'review'
  | 'memory'
  | 'settings'
  | 'skills'
  | 'connector'
  | 'workspace_change'
  | 'personal_activity'
  | 'presence'

export type SourceReadResult<T> = {
  value: T
  /** Warnings are inherited by downstream source adapters. */
  warnings?: AnalyticsWarning[]
  /** Signals a usable, but incomplete, source result to downstream adapters. */
  partial?: boolean
}

type SourceAdapter<Context, Value> = {
  id: LearningAnalyticsSourceId
  dependsOn?: readonly LearningAnalyticsSourceId[]
  sections?: readonly AnalyticsSectionId[]
  fingerprint: (context: Context, dependencies: ReadonlyMap<LearningAnalyticsSourceId, SourceSnapshot<unknown>>) => Promise<string>
  read: (context: Context, access: SourceAccess) => Promise<SourceReadResult<Value>>
}

type SourceSnapshot<Value> = SourceReadResult<Value> & {
  fingerprint: string
  touchedAt: number
}

export type SourceAccess = {
  value<T>(source: LearningAnalyticsSourceId): T
  warningsFor(source: LearningAnalyticsSourceId): AnalyticsWarning[]
  isPartial(source: LearningAnalyticsSourceId): boolean
}

export type SourcePlanReadOptions<Context> = {
  key: string
  context: Context
  /** Omitting this reads a complete bundle. */
  sectionIds?: readonly AnalyticsSectionId[]
  /** Source providers for these sections bypass their cached values once. */
  forceSectionIds?: readonly AnalyticsSectionId[]
}

export type SourcePlanBuildInput = {
  values: ReadonlyMap<LearningAnalyticsSourceId, unknown>
  warningsFor: (source: LearningAnalyticsSourceId) => AnalyticsWarning[]
  isPartial: (source: LearningAnalyticsSourceId) => boolean
}

export type SourcePlanReport = {
  dependencies: Record<LearningAnalyticsSourceId, LearningAnalyticsSourceId[]>
  sections: Record<LearningAnalyticsSourceId, AnalyticsSectionId[]>
  cachedSources: Array<{ id: LearningAnalyticsSourceId; key: string; fingerprint: string; partial: boolean }>
  cachedBundles: number
}

const ALL_SECTIONS: AnalyticsSectionId[] = [
  'hero', 'focus', 'tasks', 'tokens', 'workspace_assets', 'review', 'memory', 'platform', 'presence', 'insights'
]

const INVALIDATION_SOURCES: Record<LearningAnalyticsInvalidation, LearningAnalyticsSourceId[]> = {
  workspace_catalog: ['workspace_catalog'],
  token_evidence: ['token_evidence'],
  workspace_assets: ['workspace_assets'],
  review_sources: ['review_sources'],
  memory_store: ['memory_store'],
  platform_sources: ['platform_sources'],
  personal_study: ['personal_study'],
  presence_snapshot: ['presence_snapshot'],
  insight_derivation: ['insight_derivation'],
  workspace: ['workspace_catalog'],
  conversation: ['token_evidence'],
  ledger: ['token_evidence'],
  learning_record: ['workspace_assets'],
  reference: ['workspace_assets'],
  review: ['review_sources'],
  memory: ['memory_store'],
  settings: ['platform_sources'],
  skills: ['platform_sources'],
  connector: ['platform_sources'],
  workspace_change: ['platform_sources'],
  personal_activity: ['personal_study'],
  presence: ['presence_snapshot']
}

/**
 * Keeps analytics source policy separate from section calculations.  A source is
 * fingerprinted independently, cached independently, and is only re-read when
 * its own fingerprint changes or a retry explicitly targets one of its sections.
 */
export class LearningAnalyticsSourcePlan<Context> {
  private readonly adapters = new Map<LearningAnalyticsSourceId, SourceAdapter<Context, unknown>>()
  private readonly sourceCache = new Map<string, SourceSnapshot<unknown>>()
  private readonly bundleCache = new Map<string, LearningAnalyticsBundle>()
  private readonly inFlight = new Map<string, Promise<LearningAnalyticsBundle>>()

  constructor(adapters: Array<SourceAdapter<Context, unknown>>) {
    for (const adapter of adapters) this.adapters.set(adapter.id, adapter)
  }

  async read(options: SourcePlanReadOptions<Context>, build: (input: SourcePlanBuildInput, previous: LearningAnalyticsBundle | null, refreshedSections: readonly AnalyticsSectionId[]) => LearningAnalyticsBundle): Promise<LearningAnalyticsBundle> {
    const sections = uniqueSections(options.sectionIds ?? ALL_SECTIONS)
    const forcedSections = uniqueSections(options.forceSectionIds ?? [])
    const pendingKey = `${options.key}:${sections.join(',')}:${forcedSections.join(',')}`
    const existing = this.inFlight.get(pendingKey)
    if (existing) return existing
    const pending = this.readInternal(options, sections, forcedSections, build).finally(() => {
      if (this.inFlight.get(pendingKey) === pending) this.inFlight.delete(pendingKey)
    })
    this.inFlight.set(pendingKey, pending)
    return pending
  }

  async refresh(options: Omit<SourcePlanReadOptions<Context>, 'forceSectionIds'> & { sectionIds: readonly AnalyticsSectionId[] }, build: (input: SourcePlanBuildInput, previous: LearningAnalyticsBundle | null, refreshedSections: readonly AnalyticsSectionId[]) => LearningAnalyticsBundle): Promise<LearningAnalyticsBundle> {
    return this.read({ ...options, forceSectionIds: options.sectionIds }, build)
  }

  /** Clears only the sources affected by the supplied domain events. */
  invalidate(targets?: readonly LearningAnalyticsInvalidation[]): void {
    if (!targets?.length) {
      this.sourceCache.clear()
      this.bundleCache.clear()
      return
    }
    const affected = new Set(targets.flatMap((target) => INVALIDATION_SOURCES[target]))
    for (const key of [...this.sourceCache.keys()]) {
      const source = key.slice(0, key.indexOf(':')) as LearningAnalyticsSourceId
      if (affected.has(source)) this.sourceCache.delete(key)
    }
    // A bundle can contain values from an invalidated source. Keeping it would
    // make a subsequent selective retry merge old data back into the result.
    this.bundleCache.clear()
  }

  report(): SourcePlanReport {
    const dependencies = {} as SourcePlanReport['dependencies']
    const sections = {} as SourcePlanReport['sections']
    for (const [id, adapter] of this.adapters) {
      dependencies[id] = [...(adapter.dependsOn ?? [])]
      sections[id] = [...(adapter.sections ?? [])]
    }
    return {
      dependencies,
      sections,
      cachedSources: [...this.sourceCache.entries()].map(([key, entry]) => ({
        id: key.slice(0, key.indexOf(':')) as LearningAnalyticsSourceId,
        key: key.slice(key.indexOf(':') + 1),
        fingerprint: entry.fingerprint,
        partial: Boolean(entry.partial)
      })),
      cachedBundles: this.bundleCache.size
    }
  }

  private async readInternal(options: SourcePlanReadOptions<Context>, sections: readonly AnalyticsSectionId[], forcedSections: readonly AnalyticsSectionId[], build: (input: SourcePlanBuildInput, previous: LearningAnalyticsBundle | null, refreshedSections: readonly AnalyticsSectionId[]) => LearningAnalyticsBundle): Promise<LearningAnalyticsBundle> {
    const isSelective = options.sectionIds !== undefined
    const previous = this.bundleCache.get(options.key) ?? null
    if (forcedSections.length) sections = this.expandDependentSections(sections, forcedSections)
    if (isSelective && !previous) {
      // A selective retry without a prior bundle cannot safely merge a result.
      // Establish a complete baseline, while still forcing the requested source.
      sections = ALL_SECTIONS
    }
    const required = this.sourcesForSections(sections)
    const forced = this.expandDependentSources(this.providerSourcesForSections(forcedSections))
    const resolved = new Map<LearningAnalyticsSourceId, SourceSnapshot<unknown>>()
    let changed = false

    const resolve = async (source: LearningAnalyticsSourceId): Promise<SourceSnapshot<unknown>> => {
      const known = resolved.get(source)
      if (known) return known
      const adapter = this.adapters.get(source)
      if (!adapter) throw new Error(`Unknown analytics source: ${source}`)
      for (const dependency of adapter.dependsOn ?? []) await resolve(dependency)
      const cacheKey = `${source}:${options.key}`
      const fingerprint = await adapter.fingerprint(options.context, resolved)
      const cached = this.sourceCache.get(cacheKey)
      let snapshot: SourceSnapshot<unknown>
      if (cached && cached.fingerprint === fingerprint && !forced.has(source)) {
        snapshot = cached
      } else {
        changed = true
        const access: SourceAccess = {
          value: <T>(id: LearningAnalyticsSourceId): T => {
            const dependency = resolved.get(id)
            if (!dependency) throw new Error(`Analytics source ${source} requested unresolved dependency ${id}`)
            return dependency.value as T
          },
          warningsFor: (id: LearningAnalyticsSourceId) => this.collectWarnings(id, resolved),
          isPartial: (id: LearningAnalyticsSourceId) => this.collectPartial(id, resolved)
        }
        const result = await adapter.read(options.context, access)
        snapshot = { ...result, fingerprint, touchedAt: Date.now() }
        this.sourceCache.set(cacheKey, snapshot)
      }
      resolved.set(source, snapshot)
      return snapshot
    }

    for (const source of required) await resolve(source)
    if (!isSelective && previous && !changed) return previous
    const input: SourcePlanBuildInput = {
      values: new Map([...resolved.entries()].map(([id, snapshot]) => [id, snapshot.value])),
      warningsFor: (source) => this.collectWarnings(source, resolved),
      isPartial: (source) => this.collectPartial(source, resolved)
    }
    const bundle = build(input, previous, sections)
    this.bundleCache.set(options.key, bundle)
    return bundle
  }

  private expandDependentSections(sectionIds: readonly AnalyticsSectionId[], forcedSections: readonly AnalyticsSectionId[]): AnalyticsSectionId[] {
    const result = new Set(sectionIds)
    const forcedSources = this.providerSourcesForSections(forcedSections)
    const affectedSources = this.expandDependentSources(forcedSources)
    for (const [source, adapter] of this.adapters) {
      if (affectedSources.has(source)) for (const section of adapter.sections ?? []) result.add(section)
    }
    return [...result]
  }

  private expandDependentSources(initial: ReadonlySet<LearningAnalyticsSourceId>): Set<LearningAnalyticsSourceId> {
    const result = new Set(initial)
    let changed = true
    while (changed) {
      changed = false
      for (const [source, adapter] of this.adapters) {
        if (!result.has(source) && (adapter.dependsOn ?? []).some((dependency) => result.has(dependency))) {
          result.add(source)
          changed = true
        }
      }
    }
    return result
  }

  private providerSourcesForSections(sectionIds: readonly AnalyticsSectionId[]): Set<LearningAnalyticsSourceId> {
    const wanted = new Set(sectionIds)
    return new Set([...this.adapters.entries()].flatMap(([source, adapter]) => (adapter.sections ?? []).some((section) => wanted.has(section)) ? [source] : []))
  }

  private sourcesForSections(sectionIds: readonly AnalyticsSectionId[]): Set<LearningAnalyticsSourceId> {
    const wanted = new Set(sectionIds)
    const sources = new Set<LearningAnalyticsSourceId>()
    const add = (source: LearningAnalyticsSourceId): void => {
      if (sources.has(source)) return
      sources.add(source)
      for (const dependency of this.adapters.get(source)?.dependsOn ?? []) add(dependency)
    }
    for (const [source, adapter] of this.adapters) {
      if ((adapter.sections ?? []).some((section) => wanted.has(section))) add(source)
    }
    return sources
  }

  private collectWarnings(source: LearningAnalyticsSourceId, resolved: ReadonlyMap<LearningAnalyticsSourceId, SourceSnapshot<unknown>>, seen = new Set<LearningAnalyticsSourceId>()): AnalyticsWarning[] {
    if (seen.has(source)) return []
    seen.add(source)
    const adapter = this.adapters.get(source)
    const own = resolved.get(source)?.warnings ?? []
    return [...new Map([...own, ...(adapter?.dependsOn ?? []).flatMap((dependency) => this.collectWarnings(dependency, resolved, seen))].map((warning) => [`${warning.code}:${warning.source ?? ''}:${warning.message}`, warning])).values()]
  }

  private collectPartial(source: LearningAnalyticsSourceId, resolved: ReadonlyMap<LearningAnalyticsSourceId, SourceSnapshot<unknown>>, seen = new Set<LearningAnalyticsSourceId>()): boolean {
    if (seen.has(source)) return false
    seen.add(source)
    if (resolved.get(source)?.partial) return true
    return (this.adapters.get(source)?.dependsOn ?? []).some((dependency) => this.collectPartial(dependency, resolved, seen))
  }
}

export function sourceIdsForInvalidation(target: LearningAnalyticsInvalidation): LearningAnalyticsSourceId[] {
  return [...INVALIDATION_SOURCES[target]]
}

function uniqueSections(sectionIds: readonly AnalyticsSectionId[]): AnalyticsSectionId[] {
  return [...new Set(sectionIds)]
}
