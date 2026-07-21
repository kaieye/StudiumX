import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH,
  loadTeachingTurnReviewLastBundleFromRoot,
  normalizeTeachingTurnReviewLastBundleRelativePath,
  saveTeachingTurnReviewLastBundleToRoot,
  TEACHING_TURN_REVIEW_LAST_BUNDLE_MAX_BYTES
} from '../../src/main/teaching-turn-review-last-bundle-fs'
import {
  toTeachingTurnReviewLastBundleSnapshot
} from '../../src/shared/teaching-turn-review-last-bundle'
import { buildTeachingTurnReviewBundle } from '../../src/shared/teaching-turn-review'

const roots: string[] = []

async function lastBundleRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-last-bundle-fs-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

function sampleSnapshot() {
  return toTeachingTurnReviewLastBundleSnapshot({
    bundle: buildTeachingTurnReviewBundle({
      turnId: 'turn-fs-1',
      generatedAt: '2026-07-21T18:00:00.000Z',
      candidates: [
        {
          id: 'review:lesson_gap:v1',
          kind: 'lesson_gap',
          title: 'Possible lesson gap',
          summary: 'soft gap',
          requiresHumanApproval: true,
          payload: { signal: 'gap' }
        }
      ]
    }),
    source: 'manual',
    savedAt: '2026-07-21T18:01:00.000Z',
    decision: {
      decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'approve', note: 'later' }]
    }
  })
}

describe('normalizeTeachingTurnReviewLastBundleRelativePath', () => {
  it('accepts simple relative paths and rejects escape / absolute', () => {
    expect(
      normalizeTeachingTurnReviewLastBundleRelativePath(
        'studiumx-teaching-turn-review-last-bundle.json'
      )
    ).toBe('studiumx-teaching-turn-review-last-bundle.json')
    expect(normalizeTeachingTurnReviewLastBundleRelativePath('cache/last.json')).toBe(
      'cache/last.json'
    )
    expect(normalizeTeachingTurnReviewLastBundleRelativePath('../escape.json')).toBeNull()
    expect(normalizeTeachingTurnReviewLastBundleRelativePath('/etc/passwd')).toBeNull()
    expect(normalizeTeachingTurnReviewLastBundleRelativePath('C:/Windows/system.ini')).toBeNull()
    expect(normalizeTeachingTurnReviewLastBundleRelativePath('')).toBeNull()
    expect(normalizeTeachingTurnReviewLastBundleRelativePath('   ')).toBeNull()
  })
})

describe('saveTeachingTurnReviewLastBundleToRoot / loadTeachingTurnReviewLastBundleFromRoot', () => {
  it('round-trips a valid snapshot under the default relative path', async () => {
    const root = await lastBundleRoot()
    const snapshot = sampleSnapshot()

    const saved = await saveTeachingTurnReviewLastBundleToRoot({
      rootPath: root,
      snapshot
    })
    expect(saved).toEqual({ ok: true })

    const loaded = await loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })
    expect(loaded).toEqual(snapshot)
    expect(DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH).toBe(
      'studiumx-teaching-turn-review-last-bundle.json'
    )

    const onDisk = await readFile(
      join(root, DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH),
      'utf8'
    )
    expect(onDisk).not.toMatch(
      /autoApply|applyPlan|skillFileContent|profilePatch|writePath|mutations|fsWrite/i
    )
  })

  it('round-trips via an explicit nested relative path', async () => {
    const root = await lastBundleRoot()
    const snapshot = sampleSnapshot()
    const relativePath = 'cache/review/last-bundle.json'

    const saved = await saveTeachingTurnReviewLastBundleToRoot({
      rootPath: root,
      snapshot,
      relativePath
    })
    expect(saved).toEqual({ ok: true })

    const loaded = await loadTeachingTurnReviewLastBundleFromRoot({
      rootPath: root,
      relativePath
    })
    expect(loaded).toEqual(snapshot)
  })

  it('returns null when the file is missing', async () => {
    const root = await lastBundleRoot()
    await expect(loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })).resolves.toBeNull()
  })

  it('returns null for invalid JSON', async () => {
    const root = await lastBundleRoot()
    await writeFile(
      join(root, DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH),
      '{not-json',
      'utf8'
    )
    await expect(loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })).resolves.toBeNull()
  })

  it('returns null for schema-invalid JSON (missing version / bad source)', async () => {
    const root = await lastBundleRoot()
    await writeFile(
      join(root, DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH),
      JSON.stringify({
        version: 99,
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'manual',
        bundle: {
          generatedAt: '2026-07-21T00:00:00.000Z',
          candidates: []
        }
      }),
      'utf8'
    )
    await expect(loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })).resolves.toBeNull()
  })

  it('returns null for auto-apply shaped durable document', async () => {
    const root = await lastBundleRoot()
    await writeFile(
      join(root, DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH),
      JSON.stringify({
        version: 1,
        savedAt: '2026-07-21T00:00:00.000Z',
        source: 'manual',
        bundle: {
          generatedAt: '2026-07-21T00:00:00.000Z',
          candidates: [
            {
              id: 'evil',
              kind: 'lesson_gap',
              title: 't',
              summary: 's',
              requiresHumanApproval: true,
              payload: { applyPlan: [{ write: 'x' }] }
            }
          ]
        }
      }),
      'utf8'
    )
    await expect(loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })).resolves.toBeNull()
  })

  it('returns null for path-escape relative paths on load', async () => {
    const root = await lastBundleRoot()
    await expect(
      loadTeachingTurnReviewLastBundleFromRoot({
        rootPath: root,
        relativePath: '../escape.json'
      })
    ).resolves.toBeNull()

    await expect(
      loadTeachingTurnReviewLastBundleFromRoot({
        rootPath: root,
        relativePath: '/etc/passwd'
      })
    ).resolves.toBeNull()

    await expect(
      loadTeachingTurnReviewLastBundleFromRoot({
        rootPath: root,
        relativePath: 'C:/Windows/system.ini'
      })
    ).resolves.toBeNull()
  })

  it('returns ok:false for path-escape relative paths on save', async () => {
    const root = await lastBundleRoot()
    const snapshot = sampleSnapshot()
    const saved = await saveTeachingTurnReviewLastBundleToRoot({
      rootPath: root,
      snapshot,
      relativePath: '../escape.json'
    })
    expect(saved.ok).toBe(false)
    if (!saved.ok) {
      expect(saved.reason).toMatch(/escape|invalid/i)
    }
  })

  it('returns null for empty root path on load; ok:false on save', async () => {
    await expect(
      loadTeachingTurnReviewLastBundleFromRoot({ rootPath: '   ' })
    ).resolves.toBeNull()

    const saved = await saveTeachingTurnReviewLastBundleToRoot({
      rootPath: '',
      snapshot: sampleSnapshot()
    })
    expect(saved).toEqual({ ok: false, reason: 'rootPath is required' })
  })

  it('returns null when the document exceeds the bounded read limit', async () => {
    const root = await lastBundleRoot()
    const oversize = `${'x'.repeat(200)}`
    await writeFile(
      join(root, DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH),
      oversize,
      'utf8'
    )

    await expect(
      loadTeachingTurnReviewLastBundleFromRoot({
        rootPath: root,
        maxBytes: 64
      })
    ).resolves.toBeNull()
    expect(TEACHING_TURN_REVIEW_LAST_BUNDLE_MAX_BYTES).toBe(256_000)
  })

  it('save rejects invalid snapshot without writing', async () => {
    const root = await lastBundleRoot()
    const invalid = {
      version: 1,
      savedAt: '2026-07-21T00:00:00.000Z',
      source: 'manual',
      bundle: {
        generatedAt: '2026-07-21T00:00:00.000Z',
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
    } as unknown as ReturnType<typeof sampleSnapshot>

    const saved = await saveTeachingTurnReviewLastBundleToRoot({
      rootPath: root,
      snapshot: invalid
    })
    expect(saved.ok).toBe(false)
    if (!saved.ok) {
      expect(saved.reason).toMatch(/requiresHumanApproval|auto apply/i)
    }

    await expect(loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })).resolves.toBeNull()
  })

  it('overwrite replaces previous snapshot (idempotent last-write-wins cache)', async () => {
    const root = await lastBundleRoot()
    const first = sampleSnapshot()
    const second = toTeachingTurnReviewLastBundleSnapshot({
      bundle: buildTeachingTurnReviewBundle({
        turnId: 'turn-fs-2',
        generatedAt: '2026-07-21T19:00:00.000Z',
        candidates: []
      }),
      source: 'finalize_hook',
      savedAt: '2026-07-21T19:01:00.000Z'
    })

    expect(await saveTeachingTurnReviewLastBundleToRoot({ rootPath: root, snapshot: first })).toEqual({
      ok: true
    })
    expect(await saveTeachingTurnReviewLastBundleToRoot({ rootPath: root, snapshot: second })).toEqual({
      ok: true
    })

    const loaded = await loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })
    expect(loaded).toEqual(second)
    expect(loaded?.bundle.turnId).toBe('turn-fs-2')
  })

  it('never auto-applies after load — snapshot is display cache only', async () => {
    const root = await lastBundleRoot()
    const snapshot = sampleSnapshot()
    await saveTeachingTurnReviewLastBundleToRoot({ rootPath: root, snapshot })
    const loaded = await loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })
    expect(loaded).not.toBeNull()
    // No apply fields; human decision is still just ids/actions.
    expect(loaded).not.toHaveProperty('autoApply')
    expect(loaded?.decision?.decisions.every((d) => d.action !== ('auto_apply' as never))).toBe(
      true
    )
    expect(loaded?.bundle.candidates.every((c) => c.requiresHumanApproval === true)).toBe(true)
  })
})
