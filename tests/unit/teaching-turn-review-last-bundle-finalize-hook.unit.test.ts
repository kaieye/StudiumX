import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createSaveTeachingTurnReviewLastBundleFinalizeHook
} from '../../src/main/teaching-turn-review-last-bundle-finalize-hook'
import {
  DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH,
  loadTeachingTurnReviewLastBundleFromRoot
} from '../../src/main/teaching-turn-review-last-bundle-fs'
import { buildTeachingTurnReviewBundle } from '../../src/shared/teaching-turn-review'
import { parseTeachingTurnReviewLastBundleSnapshot } from '../../src/shared/teaching-turn-review-last-bundle'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-last-bundle-finalize-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

function sampleBundle() {
  return buildTeachingTurnReviewBundle({
    turnId: 'turn-finalize-1',
    generatedAt: '2026-07-21T20:00:00.000Z',
    candidates: [
      {
        id: 'review:lesson_gap:v1',
        kind: 'lesson_gap',
        title: 'Possible lesson gap',
        summary: 'soft gap for finalize save',
        requiresHumanApproval: true,
        payload: { signal: 'gap' }
      }
    ]
  })
}

describe('createSaveTeachingTurnReviewLastBundleFinalizeHook', () => {
  it('enabled false: no file written under temp root after hook call', async () => {
    const root = await tempRoot()
    const hook = createSaveTeachingTurnReviewLastBundleFinalizeHook({
      rootPath: root,
      enabled: false
    })

    await expect(
      hook({ mode: 'visible', bundle: sampleBundle() })
    ).resolves.toBeUndefined()

    await expect(loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })).resolves.toBeNull()
    await expect(readdir(root)).resolves.toEqual([])
  })

  it('enabled undefined: no-op (default off)', async () => {
    const root = await tempRoot()
    const hook = createSaveTeachingTurnReviewLastBundleFinalizeHook({
      rootPath: root
    })

    await expect(
      hook({ mode: 'visible', bundle: sampleBundle() })
    ).resolves.toBeUndefined()

    await expect(loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })).resolves.toBeNull()
  })

  it('enabled true + valid root: saves loadable snapshot with source finalize_hook', async () => {
    const root = await tempRoot()
    const bundle = sampleBundle()
    const hook = createSaveTeachingTurnReviewLastBundleFinalizeHook({
      rootPath: root,
      enabled: true
    })

    await expect(hook({ mode: 'visible', bundle })).resolves.toBeUndefined()

    const loaded = await loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })
    expect(loaded).not.toBeNull()
    expect(loaded?.source).toBe('finalize_hook')
    expect(loaded?.version).toBe(1)
    expect(loaded?.bundle.turnId).toBe(bundle.turnId)
    expect(loaded?.bundle.generatedAt).toBe(bundle.generatedAt)
    expect(loaded?.bundle.candidates).toEqual(bundle.candidates)
    expect(loaded?.decision).toBeUndefined()

    const onDisk = await readFile(
      join(root, DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH),
      'utf8'
    )
    const parsed = parseTeachingTurnReviewLastBundleSnapshot(JSON.parse(onDisk) as unknown)
    expect(parsed.source).toBe('finalize_hook')
    expect(onDisk).not.toMatch(
      /autoApply|auto_apply|applyPlan|skillFileContent|profilePatch|writePath|mutations|fsWrite/i
    )
    expect(onDisk).not.toMatch(/"decision"/)
  })

  it('enabled true + empty rootPath: no throw; no write', async () => {
    const root = await tempRoot()
    const hook = createSaveTeachingTurnReviewLastBundleFinalizeHook({
      rootPath: '   ',
      enabled: true
    })

    await expect(
      hook({ mode: 'visible', bundle: sampleBundle() })
    ).resolves.toBeUndefined()

    // Empty root becomes no-op before any FS; unrelated temp root stays empty.
    await expect(readdir(root)).resolves.toEqual([])
  })

  it('enabled true + save failure / invalid root: hook does not throw', async () => {
    // Non-existent nested path under a file is hard; use a path that cannot be a directory root.
    // On Windows/Unix, saving under a non-writable absolute-looking empty-after-trim is already covered.
    // Use a relativePath that escapes so save returns ok:false without throw.
    const root = await tempRoot()
    const hook = createSaveTeachingTurnReviewLastBundleFinalizeHook({
      rootPath: root,
      enabled: true,
      relativePath: '../escape-last-bundle.json'
    })

    await expect(
      hook({ mode: 'visible', bundle: sampleBundle() })
    ).resolves.toBeUndefined()

    await expect(loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })).resolves.toBeNull()
  })

  it('never invents decision / autoApply keys in saved JSON', async () => {
    const root = await tempRoot()
    const hook = createSaveTeachingTurnReviewLastBundleFinalizeHook({
      rootPath: root,
      enabled: true
    })

    await hook({ mode: 'visible', bundle: sampleBundle() })

    const onDisk = await readFile(
      join(root, DEFAULT_TEACHING_TURN_REVIEW_LAST_BUNDLE_RELATIVE_PATH),
      'utf8'
    )
    const raw = JSON.parse(onDisk) as Record<string, unknown>
    expect(Object.keys(raw).sort()).toEqual(['bundle', 'savedAt', 'source', 'version'].sort())
    expect(raw).not.toHaveProperty('decision')
    expect(raw).not.toHaveProperty('autoApply')
    expect(raw).not.toHaveProperty('applyPlan')
    expect(raw.source).toBe('finalize_hook')
  })
})
