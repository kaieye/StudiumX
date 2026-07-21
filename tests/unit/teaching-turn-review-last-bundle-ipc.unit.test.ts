import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseGetTeachingTurnReviewLastBundlePayload,
  parseSaveTeachingTurnReviewLastBundlePayload
} from '../../src/main/teaching-ipc-commands'
import {
  runGetTeachingTurnReviewLastBundleIpc,
  runSaveTeachingTurnReviewLastBundleIpc
} from '../../src/main/teaching-turn-review-last-bundle-ipc'
import { loadTeachingTurnReviewLastBundleFromRoot } from '../../src/main/teaching-turn-review-last-bundle-fs'
import { buildTeachingTurnReviewBundle } from '../../src/shared/teaching-turn-review'
import type { SaveTeachingTurnReviewLastBundlePayload } from '../../src/shared/teaching-types/teaching-turn-review-ipc'

const GENERATED_AT = '2026-07-21T12:00:00.000Z'
const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-last-bundle-ipc-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

function sampleBundle(overrides?: Record<string, unknown>) {
  return buildTeachingTurnReviewBundle({
    turnId: 'turn-last-bundle-ipc-1',
    generatedAt: GENERATED_AT,
    candidates: [
      {
        id: 'review:lesson_gap:v1',
        kind: 'lesson_gap',
        title: 'Possible lesson gap',
        summary: 'soft gap',
        requiresHumanApproval: true,
        payload: { signal: 'gap', diagnosticOnly: true }
      },
      {
        id: 'review:memory_candidate:v1',
        kind: 'memory_candidate',
        title: 'Memory candidate',
        summary: 'soft memory',
        requiresHumanApproval: true
      }
    ],
    ...overrides
  })
}

describe('parseGetTeachingTurnReviewLastBundlePayload', () => {
  it('accepts undefined / null / empty object', () => {
    expect(parseGetTeachingTurnReviewLastBundlePayload(undefined)).toBeUndefined()
    expect(parseGetTeachingTurnReviewLastBundlePayload(null)).toBeUndefined()
    expect(parseGetTeachingTurnReviewLastBundlePayload({})).toBeUndefined()
  })

  it('rejects unknown keys fail-closed', () => {
    expect(() => parseGetTeachingTurnReviewLastBundlePayload({ rootPath: '/tmp' })).toThrow(
      /must be empty/
    )
    expect(() => parseGetTeachingTurnReviewLastBundlePayload({ autoApply: true })).toThrow(
      /must be empty/
    )
  })
})

describe('parseSaveTeachingTurnReviewLastBundlePayload', () => {
  it('accepts bundle only', () => {
    const parsed = parseSaveTeachingTurnReviewLastBundlePayload({ bundle: sampleBundle() })
    expect(parsed.bundle.turnId).toBe('turn-last-bundle-ipc-1')
    expect(parsed.bundle.candidates).toHaveLength(2)
    expect(parsed.decision).toBeUndefined()
    expect(parsed.source).toBeUndefined()
  })

  it('accepts optional decision + settings_demo source', () => {
    const parsed = parseSaveTeachingTurnReviewLastBundlePayload({
      bundle: sampleBundle(),
      decision: {
        turnId: 'turn-last-bundle-ipc-1',
        decidedAt: '2026-07-21T12:05:00.000Z',
        decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'approve', note: 'ok' }]
      },
      source: 'settings_demo'
    })
    expect(parsed.source).toBe('settings_demo')
    expect(parsed.decision?.decisions[0]?.action).toBe('approve')
    expect(parsed.decision?.decisions[0]?.note).toBe('ok')
  })

  it('accepts manual and unknown sources', () => {
    expect(
      parseSaveTeachingTurnReviewLastBundlePayload({
        bundle: sampleBundle(),
        source: 'manual'
      }).source
    ).toBe('manual')
    expect(
      parseSaveTeachingTurnReviewLastBundlePayload({
        bundle: sampleBundle(),
        source: 'unknown'
      }).source
    ).toBe('unknown')
  })

  it('rejects finalize_hook product source (IPC subset only)', () => {
    expect(() =>
      parseSaveTeachingTurnReviewLastBundlePayload({
        bundle: sampleBundle(),
        source: 'finalize_hook'
      })
    ).toThrow(/settings_demo\|manual\|unknown/)
  })

  it('rejects unknown payload keys fail-closed', () => {
    expect(() =>
      parseSaveTeachingTurnReviewLastBundlePayload({
        bundle: sampleBundle(),
        autoApply: true
      })
    ).toThrow(/only "bundle"/)
    expect(() =>
      parseSaveTeachingTurnReviewLastBundlePayload({
        bundle: sampleBundle(),
        applyPlan: []
      })
    ).toThrow(/only "bundle"/)
  })

  it('requires bundle', () => {
    expect(() =>
      parseSaveTeachingTurnReviewLastBundlePayload({ source: 'manual' })
    ).toThrow(/requires "bundle"/)
  })

  it('rejects candidate without requiresHumanApproval true', () => {
    expect(() =>
      parseSaveTeachingTurnReviewLastBundlePayload({
        bundle: {
          turnId: 't',
          generatedAt: GENERATED_AT,
          candidates: [
            {
              id: 'x',
              kind: 'other',
              title: 't',
              summary: 's',
              requiresHumanApproval: false
            }
          ]
        }
      })
    ).toThrow(/requiresHumanApproval must be true/)
  })

  it('rejects forbidden action at parser boundary', () => {
    expect(() =>
      parseSaveTeachingTurnReviewLastBundlePayload({
        bundle: sampleBundle(),
        decision: {
          decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'auto_apply' }]
        }
      })
    ).toThrow(/approve\|reject\|defer/)
  })
})

describe('runGetTeachingTurnReviewLastBundleIpc / runSaveTeachingTurnReviewLastBundleIpc', () => {
  it('returns null snapshot when nothing stored under root', async () => {
    const root = await tempRoot()
    const result = await runGetTeachingTurnReviewLastBundleIpc({ rootPath: root })
    expect(result).toEqual({ ok: true, snapshot: null })
  })

  it('fails closed when rootPath empty', async () => {
    const get = await runGetTeachingTurnReviewLastBundleIpc({ rootPath: '   ' })
    expect(get.ok).toBe(false)
    if (get.ok) return
    expect(get.reason).toMatch(/rootPath/i)

    const save = await runSaveTeachingTurnReviewLastBundleIpc(
      { bundle: sampleBundle(), source: 'manual' },
      { rootPath: '' }
    )
    expect(save.ok).toBe(false)
    if (save.ok) return
    expect(save.reason).toMatch(/rootPath/i)
  })

  it('round-trips save then get without auto-apply shape', async () => {
    const root = await tempRoot()
    const payload: SaveTeachingTurnReviewLastBundlePayload = {
      bundle: sampleBundle(),
      decision: {
        turnId: 'turn-last-bundle-ipc-1',
        decidedAt: '2026-07-21T12:10:00.000Z',
        decisions: [
          { candidateId: 'review:lesson_gap:v1', action: 'approve' },
          { candidateId: 'review:memory_candidate:v1', action: 'defer' }
        ]
      },
      source: 'settings_demo'
    }

    const saved = await runSaveTeachingTurnReviewLastBundleIpc(payload, { rootPath: root })
    expect(saved).toEqual({ ok: true })

    const loaded = await runGetTeachingTurnReviewLastBundleIpc({ rootPath: root })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok || !loaded.snapshot) {
      throw new Error('expected snapshot')
    }
    expect(loaded.snapshot.version).toBe(1)
    expect(loaded.snapshot.source).toBe('settings_demo')
    expect(loaded.snapshot.bundle.turnId).toBe('turn-last-bundle-ipc-1')
    expect(loaded.snapshot.bundle.candidates).toHaveLength(2)
    expect(loaded.snapshot.decision?.decisions).toHaveLength(2)
    expect(typeof loaded.snapshot.savedAt).toBe('string')
    expect(loaded.snapshot.savedAt.length).toBeGreaterThan(0)

    // Product surface must never invent apply-plan fields
    const serialized = JSON.stringify(loaded.snapshot)
    expect(serialized).not.toMatch(/autoApply|applyPlan|skillFileContent|profilePatch|writePath/)

    // FS helper agrees with IPC mapper
    const fromFs = await loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })
    expect(fromFs?.bundle.turnId).toBe(loaded.snapshot.bundle.turnId)
    expect(fromFs?.source).toBe('settings_demo')
  })

  it('defaults missing source to unknown on save', async () => {
    const root = await tempRoot()
    const saved = await runSaveTeachingTurnReviewLastBundleIpc(
      { bundle: sampleBundle() },
      { rootPath: root }
    )
    expect(saved).toEqual({ ok: true })
    const loaded = await runGetTeachingTurnReviewLastBundleIpc({ rootPath: root })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok || !loaded.snapshot) return
    expect(loaded.snapshot.source).toBe('unknown')
  })

  it('save result stays projection-cache only (ok shape has no apply plan)', async () => {
    const root = await tempRoot()
    const result = await runSaveTeachingTurnReviewLastBundleIpc(
      { bundle: sampleBundle(), source: 'manual' },
      { rootPath: root }
    )
    expect(result).toEqual({ ok: true })
    expect(result).not.toHaveProperty('applyPlan')
    expect(result).not.toHaveProperty('autoApply')
    expect(result).not.toHaveProperty('snapshot')
  })
})
