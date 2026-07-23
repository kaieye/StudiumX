import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LearningAnalyticsService } from '../../src/main/teaching/services/learning-analytics'
import { assertAnalyticsBundle } from '../../src/renderer/src/views/workbench/analytics/useStudyAnalytics'

function query(localToday = '2026-07-23') {
  return {
    range: {
      preset: 'week' as const,
      from: '2026-07-20',
      to: localToday,
      fromInclusive: true,
      toInclusive: true,
      calendar: 'local_gregorian' as const,
      weekStartsOn: 1 as const
    },
    scope: {
      personalFocus: { kind: 'personal' as const, clientId: 'sx-client-test' },
      teaching: { kind: 'none' as const },
      presence: { kind: 'none' as const }
    },
    calendarContext: { localToday, timeZone: 'Asia/Shanghai', weekStartsOn: 1 as const }
  }
}

const sectionIds = [
  'hero',
  'focus',
  'tasks',
  'tokens',
  'workspace_assets',
  'review',
  'memory',
  'platform',
  'presence',
  'insights'
] as const

describe('learning analytics incomplete settings resilience', () => {
  it('survives incomplete settings without failing the full page request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'analytics-repro-'))
    try {
      const service = new LearningAnalyticsService({
        appDataRoot: root,
        listWorkspaceSummaries: async () => [],
        readConversation: async () => {
          throw new Error('no conversation')
        },
        getProgress: async () =>
          ({ progress: { totalAnswered: 0, correct: 0, byLesson: {} } }) as any,
        listReviewCards: async () => ({ cards: [] }),
        listMemory: async () => [],
        getMemoryDiagnostics: async () => ({ tombstoneCount: 0 }) as any,
        listSkills: async () => ({ skills: [] }) as any,
        // Incomplete settings: previously threw inside scanPlatform and failed the whole page.
        loadSettings: async () => ({ version: 1 }) as any
      })
      const q = query()
      const bundle = await service.getLearningAnalytics({
        query: q,
        sectionIds: [...sectionIds],
        personalStudy: {
          version: 1,
          identity: 'id-1',
          capturedAt: new Date().toISOString(),
          clientId: 'sx-client-test',
          trackingStartedOn: '2026-07-01',
          facts: [],
          current: { xp: 10, streakDays: 1, tasks: [] },
          diagnostics: { invalidFactRows: 0, retentionPruned: false }
        }
      })
      expect(() => assertAnalyticsBundle(bundle)).not.toThrow()
      for (const key of [
        'hero',
        'focus',
        'tasks',
        'tokens',
        'workspaceAssets',
        'review',
        'memory',
        'platform',
        'presence',
        'insights'
      ] as const) {
        expect(bundle[key]?.state, key).toBeTruthy()
      }
      expect(bundle.platform.state).toBe('error')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
