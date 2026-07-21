import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_TOOL_RESULT_PREVIEW_CHARS,
  DEFAULT_TURN_TOOL_RESULT_BUDGET_CHARS,
  SPILLED_OUTPUT_OPEN,
  enforceToolResultTurnBudget,
  generateToolResultPreview,
  isSpilledToolResultContent,
  isTurnBudgetPinnedTool,
  resolveSpillAbsolutePath,
  toolResultSpillDirectory,
  toolResultSpillRelativePath
} from '../../src/main/ai/tools/tool-result-budget'
import { isPathInsideRoot } from '../../src/main/path-access'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-tool-result-budget-'))
  roots.push(root)
  await mkdir(join(root, 'notes'), { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('tool result turn budget', () => {
  it('passes under-budget results through unchanged', async () => {
    const root = await workspace()
    const entries = [
      { toolCallId: 'c1', name: 'web_search', content: 'small-one' },
      { toolCallId: 'c2', name: 'list_workspace', content: 'small-two' }
    ]
    const outcome = await enforceToolResultTurnBudget(entries, {
      workspaceRoot: root,
      runId: 'run-under',
      config: { turnBudgetChars: 10_000, perResultPersistChars: 5_000 }
    })
    expect(outcome.spilled).toHaveLength(0)
    expect(outcome.entries.map((e) => e.content)).toEqual(['small-one', 'small-two'])
    expect(outcome.totalCharsBefore).toBe(outcome.totalCharsAfter)
  })

  it('spills over-budget results to sandbox path and returns preview + relative pointer', async () => {
    const root = await workspace()
    const huge = 'H'.repeat(8_000)
    const medium = 'M'.repeat(4_000)
    const outcome = await enforceToolResultTurnBudget(
      [
        { toolCallId: 'call-huge', name: 'web_fetch', content: huge },
        { toolCallId: 'call-medium', name: 'search_workspace', content: medium }
      ],
      {
        workspaceRoot: root,
        runId: 'run-over-1',
        config: {
          turnBudgetChars: 5_000,
          perResultPersistChars: 50_000,
          previewChars: 100
        }
      }
    )

    expect(outcome.spilled.length).toBeGreaterThanOrEqual(1)
    expect(outcome.totalCharsAfter).toBeLessThanOrEqual(5_000)
    const spilledEntry = outcome.entries.find((e) => e.toolCallId === 'call-huge')
    expect(spilledEntry?.content).toContain(SPILLED_OUTPUT_OPEN)
    expect(spilledEntry?.content).toContain('.studiumx/tool-results/')
    expect(spilledEntry?.content).not.toMatch(/[A-Za-z]:\\/)
    expect(spilledEntry?.content).not.toContain(root)

    const relative = toolResultSpillRelativePath('run-over-1', 'call-huge')
    expect(spilledEntry?.content).toContain(relative)
    const absolute = resolveSpillAbsolutePath(root, 'run-over-1', 'call-huge')
    expect(absolute).toBeTruthy()
    expect(isPathInsideRoot(root, absolute!)).toBe(true)
    expect(await readFile(absolute!, 'utf8')).toBe(huge)
  })

  it('spills per-result soft threshold even when turn is under aggregate budget', async () => {
    const root = await workspace()
    const body = 'P'.repeat(3_000)
    const outcome = await enforceToolResultTurnBudget(
      [{ toolCallId: 'soft-1', name: 'web_search', content: body }],
      {
        workspaceRoot: root,
        runId: 'run-soft',
        config: {
          turnBudgetChars: 100_000,
          perResultPersistChars: 1_000,
          previewChars: 80
        }
      }
    )
    expect(outcome.spilled).toHaveLength(1)
    expect(isSpilledToolResultContent(outcome.entries[0].content)).toBe(true)
    expect(outcome.entries[0].content.length).toBeLessThan(body.length)
  })

  it('never spills pinned read tools (persist→read loop guard)', async () => {
    expect(isTurnBudgetPinnedTool('read_workspace_file')).toBe(true)
    const root = await workspace()
    const body = 'R'.repeat(6_000)
    const outcome = await enforceToolResultTurnBudget(
      [{ toolCallId: 'read-1', name: 'read_workspace_file', content: body }],
      {
        workspaceRoot: root,
        runId: 'run-pin',
        config: {
          turnBudgetChars: 1_000,
          perResultPersistChars: 500,
          previewChars: 50
        }
      }
    )
    expect(outcome.spilled).toHaveLength(0)
    expect(outcome.entries[0].content).toBe(body)
  })

  it('skips error results and already-spilled content', async () => {
    const root = await workspace()
    const already = `${SPILLED_OUTPUT_OPEN}\npreview\n</spilled-tool-result>`
    const outcome = await enforceToolResultTurnBudget(
      [
        { toolCallId: 'err', name: 'web_fetch', content: 'E'.repeat(5_000), isError: true },
        { toolCallId: 'prev', name: 'web_search', content: already }
      ],
      {
        workspaceRoot: root,
        runId: 'run-skip',
        config: { turnBudgetChars: 100, perResultPersistChars: 100 }
      }
    )
    expect(outcome.spilled).toHaveLength(0)
    expect(outcome.entries[0].content.startsWith('E')).toBe(true)
    expect(outcome.entries[1].content).toBe(already)
  })

  it('falls back to inline preview when sandbox context is missing', async () => {
    const body = 'X'.repeat(4_000)
    const outcome = await enforceToolResultTurnBudget(
      [{ toolCallId: 'no-root', name: 'web_search', content: body }],
      {
        workspaceRoot: '',
        runId: '',
        config: { turnBudgetChars: 500, perResultPersistChars: 500, previewChars: 60 }
      }
    )
    expect(outcome.spillUnavailable).toBe(true)
    expect(outcome.entries[0].content).toContain('Full output could not be spilled')
    expect(outcome.entries[0].content.length).toBeLessThan(body.length)
    expect(outcome.entries[0].content).not.toMatch(/[A-Za-z]:\\/)
  })

  it('preview generation prefers newline boundaries', () => {
    const content = `${'line\n'.repeat(40)}TAIL`
    const { preview, hasMore } = generateToolResultPreview(content, 40)
    expect(hasMore).toBe(true)
    expect(preview.length).toBeLessThanOrEqual(40)
    expect(preview.endsWith('\n') || preview.length < 40).toBe(true)
  })

  it('exports hermes-aligned defaults', () => {
    expect(DEFAULT_TURN_TOOL_RESULT_BUDGET_CHARS).toBe(200_000)
    expect(DEFAULT_TOOL_RESULT_PREVIEW_CHARS).toBe(1_500)
    const dir = toolResultSpillDirectory('C:/ws', 'run/../evil')
    const normalized = dir.replace(/\\/g, '/')
    expect(normalized).toMatch(/\.studiumx\/tool-results\//)
    // sanitizeRunId replaces '/' so the leaf is not a parent traversal segment
    expect(normalized.split('/').pop()).not.toBe('..')
    expect(normalized.split('/').pop()).not.toBe('evil')
  })
})
