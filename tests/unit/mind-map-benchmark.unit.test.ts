import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseXmindZip } from '../../src/main/mindmap/xmind-file'
import {
  validateMindMapDocumentV2,
  validateMindMapSheetV2
} from '../../src/shared/mindmap/domain/invariants'
import { mindMapDocumentV2Schema } from '../../src/shared/mindmap/domain/schema'
import type {
  MindMapDocumentV2,
  MindMapSheetV2,
  MindMapTopicV2
} from '../../src/shared/mindmap/domain/types'
import { MindMapUndoRedoStack } from '../../src/shared/mindmap/commands/mind-map-undo-redo'
import type { MindMapCommandResult } from '../../src/shared/mindmap/commands/mind-map-command-types'
import { computeMindMapLayout } from '../../src/renderer/src/views/mindmap/mind-map-layout'
import { xmindContentToDocument } from '../../src/shared/mindmap/xmind-converter'

const FIXTURES_DIR = resolve(process.cwd(), 'docs/mindmap/benchmarks/fixtures')

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), 'utf8'))
}

function readBytes(name: string): Uint8Array {
  const buffer = readFileSync(resolve(FIXTURES_DIR, name))
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

function countTopicTree(root: MindMapTopicV2): number {
  let count = 0
  const stack: MindMapTopicV2[] = [root]
  while (stack.length > 0) {
    const topic = stack.pop()
    if (!topic) continue
    count += 1
    for (const child of topic.children) stack.push(child)
  }
  return count
}

function countDocumentNodes(sheets: MindMapSheetV2[]): number {
  return sheets.reduce((sum, sheet) => sum + countTopicTree(sheet.root), 0)
}

type BuildEntry = {
  parentId: string
  index: number
  topic: MindMapTopicV2
}

/**
 * Convert the fixture tree into a deterministic preorder of insert commands.
 * Parents always precede children, so the sequence models continuous keyboard
 * construction without adding a second generated fixture.
 */
function collectBuildEntries(root: MindMapTopicV2): BuildEntry[] {
  const entries: BuildEntry[] = []
  const visit = (parentId: string, children: MindMapTopicV2[]): void => {
    for (const [index, topic] of children.entries()) {
      entries.push({ parentId, index, topic })
      visit(topic.id, topic.children)
    }
  }
  visit(root.id, root.children)
  return entries
}

function rootOnlyDocument(document: MindMapDocumentV2): MindMapDocumentV2 {
  const next = structuredClone(document)
  const firstSheet = next.sheets[0]
  if (firstSheet === undefined) throw new Error('100-node fixture must contain a sheet')
  firstSheet.root.children = []
  return next
}

type BuildRun = {
  stack: MindMapUndoRedoStack
  applied: number
  layout: ReturnType<typeof computeMindMapLayout> | null
}

/**
 * Test-only cooperative cancellation seam. It checks the signal between
 * commands and before layout; it does not add a runtime quota or production
 * scheduling policy.
 */
function buildAndLayoutFixture(
  start: MindMapDocumentV2,
  entries: readonly BuildEntry[],
  signal: AbortSignal,
  onApplied?: (count: number) => void
): BuildRun {
  const stack = new MindMapUndoRedoStack(start)
  let applied = 0

  for (const entry of entries) {
    if (signal.aborted) break

    const node = structuredClone(entry.topic)
    node.children = []
    const result: MindMapCommandResult = stack.execute(
      {
        type: 'topic.insert',
        sheetId: start.sheets[0]!.id,
        parentId: entry.parentId,
        index: entry.index,
        node
      },
      { label: 'Benchmark build', mergeKey: 'benchmark-build' }
    )
    if (!result.ok) {
      throw new Error(`100-node build failed: ${result.error.code}: ${result.error.message}`)
    }
    applied += 1
    onApplied?.(applied)
  }

  if (signal.aborted) return { stack, applied, layout: null }
  return {
    stack,
    applied,
    layout: computeMindMapLayout(stack.document.sheets[0]!)
  }
}

const V2_DOC_SPECS = [
  { nodes: 10, file: 'doc-10-nodes.v2.json' },
  { nodes: 100, file: 'doc-100-nodes.v2.json' },
  { nodes: 500, file: 'doc-500-nodes.v2.json' },
  { nodes: 2000, file: 'doc-2000-nodes.v2.json' }
] as const

describe('mind map v2 benchmark fixtures', () => {
  for (const spec of V2_DOC_SPECS) {
    it(`${spec.file} passes schema, invariants and has ${spec.nodes} nodes`, () => {
      const raw = readJson(spec.file)
      const parsed = mindMapDocumentV2Schema.safeParse(raw)
      expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues)).toBe(true)
      if (!parsed.success) return

      const doc = parsed.data
      expect(countDocumentNodes(doc.sheets)).toBe(spec.nodes)

      for (const [index, sheet] of doc.sheets.entries()) {
        const invariantErrors = validateMindMapSheetV2(sheet)
        expect(invariantErrors, `sheet ${index} invariant errors`).toEqual([])
      }
      const docInvariant = validateMindMapDocumentV2(doc)
      expect(docInvariant.ok, JSON.stringify(docInvariant.ok ? '' : docInvariant.errors)).toBe(true)
    })
  }

  it('records open + schema + invariants timing for the 2000-node fixture', () => {
    const tRead = performance.now()
    const raw = readJson('doc-2000-nodes.v2.json')
    const tParsed = performance.now()
    const parsed = mindMapDocumentV2Schema.safeParse(raw)
    const tSchema = performance.now()
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const invariant = validateMindMapDocumentV2(parsed.data)
    const tInvariant = performance.now()
    expect(invariant.ok).toBe(true)

    const readMs = tParsed - tRead
    const schemaMs = tSchema - tParsed
    const invariantMs = tInvariant - tSchema
    // 不设硬性阈值；耗时输出到测试日志供基准机回填 benchmarks.md。
    console.log(
      `[mind-map-benchmark] doc-2000 read=${readMs.toFixed(1)}ms ` +
        `schema=${schemaMs.toFixed(1)}ms invariants=${invariantMs.toFixed(1)}ms`
    )
  })

  it('replays a cancellable 100-node command build and layout without a hard timing gate', () => {
    const raw = readJson('doc-100-nodes.v2.json')
    const parsed = mindMapDocumentV2Schema.safeParse(raw)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const source = parsed.data
    const sourceSheet = source.sheets[0]
    expect(sourceSheet).toBeDefined()
    if (sourceSheet === undefined) return

    const entries = collectBuildEntries(sourceSheet.root)
    expect(entries).toHaveLength(99)
    const base = rootOnlyDocument(source)

    const buildStart = performance.now()
    const fullRun = buildAndLayoutFixture(base, entries, new AbortController().signal)
    const elapsedMs = performance.now() - buildStart

    expect(fullRun.applied).toBe(99)
    expect(fullRun.layout).not.toBeNull()
    expect(countDocumentNodes(fullRun.stack.document.sheets)).toBe(100)
    expect(fullRun.layout).toEqual(computeMindMapLayout(sourceSheet))
    expect(fullRun.stack.undoCount).toBe(1)
    expect(fullRun.stack.redoCount).toBe(0)

    const undone = fullRun.stack.undo()
    expect(undone?.ok).toBe(true)
    expect(fullRun.stack.document).toEqual(base)
    expect(fullRun.stack.redoCount).toBe(1)

    const redone = fullRun.stack.redo()
    expect(redone?.ok).toBe(true)
    expect(fullRun.stack.document).toEqual(source)
    // Redo restores a valid 100-node document after the merged continuous-build
    // undo unit is replayed.
    expect(countDocumentNodes(fullRun.stack.document.sheets)).toBe(100)

    const cancelController = new AbortController()
    const partialRun = buildAndLayoutFixture(base, entries, cancelController.signal, (count) => {
      if (count === 24) cancelController.abort()
    })
    expect(partialRun.applied).toBe(24)
    expect(partialRun.layout).toBeNull()
    expect(countDocumentNodes(partialRun.stack.document.sheets)).toBe(25)

    // This is an observational baseline only; it intentionally has no machine-
    // specific threshold so the opt-in benchmark remains lightweight and stable.
    console.log(
      `[mind-map-benchmark] doc-100 command-build+layout=${elapsedMs.toFixed(1)}ms ` +
        `commands=${fullRun.applied} layoutNodes=${fullRun.layout?.nodes.length ?? 0} ` +
        `cancelledAfter=${partialRun.applied}`
    )
  })
})

const XMIND_CONTENT_FIXTURES = [
  'xmind-content-basic.json',
  'xmind-content-right.json',
  'xmind-content-balanced.json',
  'xmind-content-map.json',
  'xmind-content-down.json',
  'xmind-content-up.json',
  'xmind-content-styles.json',
  'xmind-content-relationships.json',
  'xmind-content-summaries.json',
  'xmind-content-attachments.json',
  'xmind-content-unknown-fields.json',
  'xmind-content-unsupported-fields.json',
  'xmind-content-empty.json',
  'xmind-content-multi-sheet.json'
] as const

describe('xmind content fixtures', () => {
  it('converts the basic fixture without crash and preserves the tree', () => {
    const content = readJson('xmind-content-basic.json')
    const doc = xmindContentToDocument(content)
    expect(doc.sheets).toHaveLength(1)
    expect(doc.sheets[0].root.id).toBe('t1')
    expect(doc.sheets[0].root.title).toBe('中心主题')
    expect(doc.sheets[0].root.children).toHaveLength(2)
    expect(doc.sheets[0].root.children.map((child) => child.id)).toEqual(['t2', 't5'])
  })

  it('converts every content.json fixture without crash', () => {
    for (const file of XMIND_CONTENT_FIXTURES) {
      const content = readJson(file)
      const doc = xmindContentToDocument(content)
      expect(doc.sheets.length, file).toBeGreaterThan(0)
    }
  })
})

const CORRUPT_FIXTURES = [
  {
    file: 'xmind-corrupt-not-a-zip.xmind',
    pattern: /Not a valid \.xmind ZIP archive/
  },
  {
    file: 'xmind-corrupt-empty.xmind',
    pattern: /Not a valid \.xmind ZIP archive/
  },
  {
    file: 'xmind-corrupt-missing-content.xmind',
    pattern: /missing content\.json/
  },
  {
    file: 'xmind-corrupt-invalid-json.xmind',
    pattern: /content\.json is not valid JSON/
  },
  {
    file: 'xmind-corrupt-truncated.xmind',
    pattern: /Not a valid \.xmind ZIP archive/
  }
] as const

describe('corrupted .xmind zip fixtures', () => {
  for (const fixture of CORRUPT_FIXTURES) {
    it(`${fixture.file} returns a structured error instead of crashing`, () => {
      const bytes = readBytes(fixture.file)
      expect(() => parseXmindZip(bytes)).toThrow(fixture.pattern)
    })
  }
})
