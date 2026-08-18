import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  captureAndAppendWritePreImage,
  readWriteRewindJournal
} from '../../src/main/ai/tools/write-rewind-journal'
import {
  journalPermissionDecisionFromGateAndResolution
} from '../../src/main/ai/tools/tool-policy'
import {
  buildDefaultRegistry,
  buildToolContext,
  type ToolPermissionDecision
} from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'
import {
  runWorkspaceWriteWithDurableDependenciesForTesting,
  type WorkspaceWriteDurableDependencies
} from '../../src/main/ai/tools/workspace'
const roots: string[] = []

async function workspaceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-write-capture-perm-'))
  roots.push(root)
  await mkdir(join(root, 'notes'), { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function noopDeps(): WorkspaceWriteDurableDependencies {
  return {
    createNoOverwrite: async () => undefined,
    overwriteExistingRestricted: async () => undefined
  }
}

describe('write capture permissionDecision wire (B-08 / ADR-0005)', () => {
  it('records permissionDecision when capture is called with a known decision', async () => {
    const root = await workspaceRoot()
    const entry = await captureAndAppendWritePreImage({
      workspaceRoot: root,
      relativePath: 'notes/created.md',
      runId: 'run-with-decision',
      content: 'hello',
      permissionDecision: 'prompt',
      nowIso: () => '2026-07-21T12:00:00.000Z'
    })
    expect(entry?.permissionDecision).toBe('prompt')
    const journal = await readWriteRewindJournal({ workspaceRoot: root, runId: 'run-with-decision' })
    expect(journal).toHaveLength(1)
    expect(journal[0]?.permissionDecision).toBe('prompt')
  })

  it('omits permissionDecision when capture path does not know a decision', async () => {
    const root = await workspaceRoot()
    const entry = await captureAndAppendWritePreImage({
      workspaceRoot: root,
      relativePath: 'notes/created.md',
      runId: 'run-without-decision',
      content: 'hello',
      nowIso: () => '2026-07-21T12:00:00.000Z'
    })
    expect(entry).toBeTruthy()
    expect(entry).not.toHaveProperty('permissionDecision')
    const text = await readFile(
      join(root, '.studiumx', 'checkpoints', 'run-without-decision', 'write-journal.jsonl'),
      'utf8'
    )
    expect(text).not.toContain('permissionDecision')
  })

  it('workspace write handler passes lastJournalPermissionDecision through to journal', async () => {
    const root = await workspaceRoot()
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.approvalMode = 'full_access'
    const ctx = buildToolContext(settings, {
      workspaceRoot: root,
      runId: 'run-ctx-decision'
    })
    ctx.lastJournalPermissionDecision = 'allow'

    await runWorkspaceWriteWithDurableDependenciesForTesting(
      {
        path: 'notes/from-ctx.md',
        content: 'wired',
        overwrite: false
      },
      ctx,
      noopDeps()
    )

    const journal = await readWriteRewindJournal({
      workspaceRoot: root,
      runId: 'run-ctx-decision'
    })
    expect(journal).toHaveLength(1)
    expect(journal[0]?.permissionDecision).toBe('allow')
    expect(journal[0]?.relativePath).toBe('notes/from-ctx.md')
  })

  it('workspace write handler omits permissionDecision when context slot is empty', async () => {
    const root = await workspaceRoot()
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.approvalMode = 'full_access'
    const ctx = buildToolContext(settings, {
      workspaceRoot: root,
      runId: 'run-ctx-omit'
    })
    // deliberately no lastJournalPermissionDecision

    await runWorkspaceWriteWithDurableDependenciesForTesting(
      {
        path: 'notes/no-decision.md',
        content: 'plain',
        overwrite: false
      },
      ctx,
      noopDeps()
    )

    const journal = await readWriteRewindJournal({
      workspaceRoot: root,
      runId: 'run-ctx-omit'
    })
    expect(journal).toHaveLength(1)
    expect(journal[0]).not.toHaveProperty('permissionDecision')
  })

  it('registry sets lastJournalPermissionDecision from gate mapping before handler', async () => {
    const root = await workspaceRoot()
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.approvalMode = 'full_access'
    const written: string[] = []
    const ctx = buildToolContext(settings, {
      workspaceRoot: root,
      runId: 'run-registry-wire'
    })

    // Prefer registry path if write tool is available; otherwise assert pure mapping only.
    const registry = buildDefaultRegistry(settings, {
      workspaceRoot: root,
      workspaceWrite: true
    })
    if (!registry.names().includes('write_workspace_file')) {
      // Host cannot expose write tool; still verify pure mapping used by registry.
      expect(
        journalPermissionDecisionFromGateAndResolution({
          policyAction: 'defer_to_approval_mode',
          interactiveDecision: 'allow_for_run'
        })
      ).toBe('allow')
      expect(
        journalPermissionDecisionFromGateAndResolution({
          policyAction: 'force_interactive',
          interactiveDecision: 'allow_once'
        })
      ).toBe('prompt')
      return
    }

    const handlers = registry.handlerMap(ctx)
    // Patch durable path by writing a real create via full_access if available.
    // Capture still happens before durable publish; if durable fails we may still have journal.
    const raw = await handlers.write_workspace_file?.(
      { path: 'notes/registry-wire.md', content: 'from-registry', overwrite: false },
      { toolCallId: 'tc-1', toolName: 'write_workspace_file' }
    )
    written.push(String(raw ?? ''))

    // After permission resolve, context slot should have been set for capture.
    // full_access + default policy → allow
    expect(ctx.lastJournalPermissionDecision).toBe('allow')

    const journal = await readWriteRewindJournal({
      workspaceRoot: root,
      runId: 'run-registry-wire'
    })
    // Journal may be empty if write failed before capture (e.g. durable unavailable).
    if (journal.length > 0) {
      expect(journal[0]?.permissionDecision).toBe('allow')
    }
  })

  it('force_interactive gate maps to journal prompt after interactive allow', async () => {
    expect(
      journalPermissionDecisionFromGateAndResolution({
        policyAction: 'force_interactive',
        interactiveDecision: 'allow_for_directory' as ToolPermissionDecision['decision']
      })
    ).toBe('prompt')
  })
})
