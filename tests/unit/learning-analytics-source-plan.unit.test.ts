import { describe, expect, it } from 'vitest'
import type { LearningAnalyticsBundle } from '../../src/shared/teaching-types'
import {
  LearningAnalyticsSourcePlan,
  sourceIdsForInvalidation
} from '../../src/main/teaching/services/analytics/source-plan'

type Context = { key: string }

function bundle(): LearningAnalyticsBundle {
  return { contractVersion: 1, generatedAt: '2026-07-14T00:00:00.000Z', query: {} } as LearningAnalyticsBundle
}

describe('LearningAnalyticsSourcePlan', () => {
  it('retries token evidence and dependent insights without rereading review or memory sources', async () => {
    const reads = { workspace: 0, token: 0, review: 0, memory: 0, insights: 0 }
    const plan = new LearningAnalyticsSourcePlan<Context>([
      { id: 'workspace_catalog', fingerprint: async () => 'workspace-v1', read: async () => ({ value: ++reads.workspace, partial: false }) },
      { id: 'token_evidence', dependsOn: ['workspace_catalog'], sections: ['tokens'], fingerprint: async () => 'token-v1', read: async () => ({ value: ++reads.token }) },
      { id: 'review_sources', dependsOn: ['workspace_catalog'], sections: ['review'], fingerprint: async () => 'review-v1', read: async () => ({ value: ++reads.review }) },
      { id: 'memory_store', dependsOn: ['workspace_catalog'], sections: ['memory'], fingerprint: async () => 'memory-v1', read: async () => ({ value: ++reads.memory }) },
      {
        id: 'insight_derivation',
        dependsOn: ['token_evidence', 'review_sources', 'memory_store'],
        sections: ['insights'],
        fingerprint: async (_context, sources) => `insights-${sources.get('token_evidence')?.fingerprint}`,
        read: async (_context, access) => ({ value: { token: access.value<number>('token_evidence'), revision: ++reads.insights } })
      }
    ])
    // Count the catalog reader separately from its value; it should be reused too.
    const reportBefore = plan.report()
    expect(reportBefore.cachedSources).toEqual([])

    const build = (_input: unknown, previous: LearningAnalyticsBundle | null) => previous ?? bundle()
    await plan.read({ key: 'query-a', context: { key: 'query-a' } }, build)
    await plan.refresh({ key: 'query-a', context: { key: 'query-a' }, sectionIds: ['tokens'] }, build)

    expect(reads).toEqual({ workspace: 1, token: 2, review: 1, memory: 1, insights: 2 })
  })

  it('maps Learning record and Reference invalidation to workspace assets only', () => {
    expect(sourceIdsForInvalidation('learning_record')).toEqual(['workspace_assets'])
    expect(sourceIdsForInvalidation('reference')).toEqual(['workspace_assets'])
    expect(sourceIdsForInvalidation('conversation')).toEqual(['token_evidence'])
  })

  it('reports explicit source-to-section dependencies', () => {
    const plan = new LearningAnalyticsSourcePlan<Context>([
      { id: 'workspace_catalog', fingerprint: async () => 'catalog', read: async () => ({ value: null }) },
      { id: 'workspace_assets', dependsOn: ['workspace_catalog'], sections: ['workspace_assets'], fingerprint: async () => 'assets', read: async () => ({ value: null }) }
    ])
    const report = plan.report()
    expect(report.dependencies.workspace_assets).toEqual(['workspace_catalog'])
    expect(report.sections.workspace_assets).toEqual(['workspace_assets'])
  })
})
