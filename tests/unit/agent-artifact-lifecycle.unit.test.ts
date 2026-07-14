import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAgentArtifacts } from '../../src/main/agent-artifact-lifecycle'

const createdRoots: string[] = []
const NOW = '2026-07-14T00:00:00.000Z'
const DAY_MS = 24 * 60 * 60 * 1000

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-artifact-lifecycle-'))
  createdRoots.push(root)
  return root
}

async function writeAgedFile(root: string, relativePath: string, content: string, ageDays: number): Promise<string> {
  const absolutePath = join(root, ...relativePath.split('/'))
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
  const timestamp = new Date(Date.parse(NOW) - ageDays * DAY_MS)
  await utimes(absolutePath, timestamp, timestamp)
  return absolutePath
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('agent artifact lifecycle', () => {
  it('plans expired conversation artifacts without mutating files during dry-run', async () => {
    const root = await createRoot()
    const relativePath = 'conversations/.agent-sessions/conversation-1/tool-results/result.txt'
    const absolutePath = await writeAgedFile(root, relativePath, 'old tool output', 100)

    const result = await cleanupAgentArtifacts({
      storageRoot: root,
      dryRun: true,
      now: NOW
    })

    expect(result.schemaVersion).toBe(1)
    expect(result.dryRun).toBe(true)
    expect(result.actions).toEqual([
      expect.objectContaining({
        relativePath,
        kind: 'conversation_tool_result',
        reason: 'retention_expired',
        status: 'planned'
      })
    ])
    await expect(stat(absolutePath)).resolves.toBeDefined()
    await expect(readFile(join(root, '.agent-sessions', 'artifact-cleanup.jsonl'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('never deletes live references and writes a content-free audit for an actual sweep', async () => {
    const root = await createRoot()
    const referencedPath = 'conversations/.agent-sessions/conversation-1/tool-results/referenced.txt'
    const orphanPath = 'conversations/.agent-sessions/conversation-1/child-transcripts/orphan.txt'
    const referencedAbsolutePath = await writeAgedFile(root, referencedPath, 'password=hunter2 referenced content', 120)
    const orphanAbsolutePath = await writeAgedFile(root, orphanPath, 'orphan transcript body', 120)

    const result = await cleanupAgentArtifacts({
      storageRoot: root,
      now: NOW,
      protection: { liveReferences: [referencedPath] }
    })

    expect(result.totals.protectedEntries).toBe(1)
    expect(result.actions).toEqual([
      expect.objectContaining({ relativePath: orphanPath, status: 'deleted' })
    ])
    await expect(stat(referencedAbsolutePath)).resolves.toBeDefined()
    await expect(stat(orphanAbsolutePath)).rejects.toMatchObject({ code: 'ENOENT' })

    const audit = await readFile(join(root, '.agent-sessions', 'artifact-cleanup.jsonl'), 'utf8')
    expect(audit.trim().split('\n')).toHaveLength(2)
    expect(audit).toContain(orphanPath)
    expect(audit).not.toContain('hunter2')
    expect(audit).not.toContain('orphan transcript body')
  })

  it('protects active run and parent-turn staging scopes while planning terminal staging cleanup', async () => {
    const root = await createRoot()
    const activeRunTranscript = '.agent-sessions/child-transcripts/run-active/transcript.txt'
    const activeParentStage = '.agent-sessions/parent-turns/run-parent.json'
    const activeParentTranscript = '.agent-sessions/child-transcripts/run-parent/transcript.txt'
    const terminalParentStage = '.agent-sessions/parent-turns/run-terminal.json'
    const terminalTranscript = '.agent-sessions/child-transcripts/run-terminal/transcript.txt'

    await writeAgedFile(root, '.agent-sessions/runs/run-active.json', JSON.stringify({
      version: 1,
      runId: 'run-active',
      status: 'running'
    }), 120)
    await writeAgedFile(root, activeRunTranscript, 'active run transcript', 120)
    await writeAgedFile(root, activeParentStage, JSON.stringify({
      schemaVersion: 1,
      runId: 'run-parent',
      status: 'interrupted'
    }), 120)
    await writeAgedFile(root, activeParentTranscript, 'recoverable parent transcript', 120)
    await writeAgedFile(root, terminalParentStage, JSON.stringify({
      schemaVersion: 1,
      runId: 'run-terminal',
      status: 'settled'
    }), 120)
    await writeAgedFile(root, terminalTranscript, 'settled transcript', 120)

    const result = await cleanupAgentArtifacts({ storageRoot: root, dryRun: true, now: NOW })
    const actionPaths = result.actions.map((action) => action.relativePath)

    expect(actionPaths).toEqual([terminalTranscript, terminalParentStage].sort())
    expect(actionPaths).not.toContain(activeRunTranscript)
    expect(actionPaths).not.toContain(activeParentStage)
    expect(actionPaths).not.toContain(activeParentTranscript)
    expect(result.totals.protectedEntries).toBe(3)
  })

  it('applies the total-byte budget after grace and reports duplicate digests without merging them', async () => {
    const root = await createRoot()
    const olderPath = 'conversations/.agent-sessions/conversation-1/tool-results/older.txt'
    const newerPath = 'conversations/.agent-sessions/conversation-1/child-transcripts/newer.txt'
    await writeAgedFile(root, olderPath, 'same', 3)
    await writeAgedFile(root, newerPath, 'same', 2)

    const result = await cleanupAgentArtifacts({
      storageRoot: root,
      dryRun: true,
      now: NOW,
      policy: { maxTotalBytes: 4 }
    })

    expect(result.actions).toEqual([
      expect.objectContaining({ relativePath: olderPath, reason: 'storage_budget', status: 'planned' })
    ])
    expect(result.duplicates).toEqual([
      expect.objectContaining({ relativePaths: [newerPath, olderPath].sort(), bytes: 8 })
    ])
    expect(result.totals.scannedEntries).toBe(2)
  })

  it('revalidates the live set immediately before sweep and skips newly referenced artifacts', async () => {
    const root = await createRoot()
    const relativePath = 'conversations/.agent-sessions/conversation-1/tool-results/raced.txt'
    const absolutePath = await writeAgedFile(root, relativePath, 'became referenced', 120)
    let snapshots = 0

    const result = await cleanupAgentArtifacts({
      storageRoot: root,
      now: NOW,
      resolveProtectionSnapshot: async () => {
        snapshots += 1
        return snapshots === 1 ? {} : { liveReferences: [relativePath] }
      }
    })

    expect(snapshots).toBe(2)
    expect(result.actions).toEqual([
      expect.objectContaining({ relativePath, status: 'skipped' })
    ])
    expect(result.totals.deletedEntries).toBe(0)
    await expect(stat(absolutePath)).resolves.toBeDefined()
  })

  it('reports malformed staging as a partial failure and remains idempotent for deletions', async () => {
    const root = await createRoot()
    const malformedStagePath = '.agent-sessions/parent-turns/run-corrupt.json'
    const orphanPath = 'conversations/.agent-sessions/conversation-1/tool-results/orphan.txt'
    const malformedStageAbsolutePath = await writeAgedFile(root, malformedStagePath, '{"schemaVersion":2}', 120)
    const orphanAbsolutePath = await writeAgedFile(root, orphanPath, 'delete once', 120)

    const first = await cleanupAgentArtifacts({ storageRoot: root, now: NOW })

    expect(first.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'parent_stage_invalid', relativePath: malformedStagePath })
    ]))
    expect(first.totals.deletedEntries).toBe(1)
    await expect(stat(malformedStageAbsolutePath)).resolves.toBeDefined()
    await expect(stat(orphanAbsolutePath)).rejects.toMatchObject({ code: 'ENOENT' })

    const second = await cleanupAgentArtifacts({ storageRoot: root, now: NOW })
    expect(second.totals.deletedEntries).toBe(0)
    expect(second.actions).toEqual([])
    await expect(stat(malformedStageAbsolutePath)).resolves.toBeDefined()
  })

  it('rejects unbounded retention and storage policies', async () => {
    const root = await createRoot()

    await expect(cleanupAgentArtifacts({
      storageRoot: root,
      dryRun: true,
      policy: { retentionDays: Number.POSITIVE_INFINITY }
    })).rejects.toThrow('retentionDays must be a finite number')

    await expect(cleanupAgentArtifacts({
      storageRoot: root,
      dryRun: true,
      policy: { maxTotalBytes: Number.POSITIVE_INFINITY }
    })).rejects.toThrow('maxTotalBytes must be a finite integer')
  })

  it('does not traverse symbolic-link artifact directories outside the storage root', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const outsideArtifactRoot = join(outside, 'conversation-escape')
    const outsideFile = join(outsideArtifactRoot, 'tool-results', 'outside.txt')
    const linkedRelativePath = 'conversations/.agent-sessions/conversation-escape'
    const linkedPath = join(root, ...linkedRelativePath.split('/'))
    await mkdir(dirname(linkedPath), { recursive: true })
    await mkdir(dirname(outsideFile), { recursive: true })
    await writeFile(outsideFile, 'must remain outside', 'utf8')
    await symlink(outsideArtifactRoot, linkedPath, 'junction')

    const result = await cleanupAgentArtifacts({ storageRoot: root, now: NOW })

    expect(result.actions).toEqual([])
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'symlink_skipped', relativePath: linkedRelativePath })
    ]))
    await expect(stat(outsideFile)).resolves.toBeDefined()
  })

  it('redacts protection refresh failures in result and durable cleanup audit', async () => {
    const root = await createRoot()
    const relativePath = 'conversations/.agent-sessions/conversation-1/tool-results/protected-on-failure.txt'
    const absolutePath = await writeAgedFile(root, relativePath, 'retain when refresh fails', 120)
    let snapshots = 0

    const result = await cleanupAgentArtifacts({
      storageRoot: root,
      now: NOW,
      resolveProtectionSnapshot: async () => {
        snapshots += 1
        if (snapshots === 1) return {}
        throw new Error('password=hunter2')
      }
    })

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'protection_refresh_failed' })
    ]))
    expect(JSON.stringify(result.issues)).not.toContain('hunter2')
    expect(result.actions).toEqual([
      expect.objectContaining({ relativePath, status: 'skipped' })
    ])
    await expect(stat(absolutePath)).resolves.toBeDefined()
    const audit = await readFile(join(root, '.agent-sessions', 'artifact-cleanup.jsonl'), 'utf8')
    expect(audit).not.toContain('hunter2')
    expect(audit).toContain('[redacted]')
  })

  it('revalidates candidate metadata and digest before unlinking', async () => {
    const root = await createRoot()
    const relativePath = 'conversations/.agent-sessions/conversation-1/tool-results/changed.txt'
    const absolutePath = await writeAgedFile(root, relativePath, 'before', 120)
    let snapshots = 0

    const result = await cleanupAgentArtifacts({
      storageRoot: root,
      now: NOW,
      resolveProtectionSnapshot: async () => {
        snapshots += 1
        if (snapshots === 2) await writeFile(absolutePath, 'after!', 'utf8')
        return {}
      }
    })

    expect(result.actions).toEqual([
      expect.objectContaining({ relativePath, status: 'skipped' })
    ])
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'candidate_changed', relativePath })
    ]))
    await expect(readFile(absolutePath, 'utf8')).resolves.toBe('after!')
  })

  it('aborts sweep planning when the bounded scan budget is exceeded', async () => {
    const root = await createRoot()
    const relativePath = 'conversations/.agent-sessions/conversation-1/tool-results/old.txt'
    const absolutePath = await writeAgedFile(root, relativePath, 'old', 120)

    const result = await cleanupAgentArtifacts({
      storageRoot: root,
      dryRun: true,
      now: NOW,
      policy: { maxScanEntries: 1 }
    })

    expect(result.actions).toEqual([])
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'scan_budget_exceeded' })
    ]))
    await expect(stat(absolutePath)).resolves.toBeDefined()
  })
})
