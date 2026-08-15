import { describe, expect, it } from 'vitest'

import type {
  MindMapAssetRef,
  MindMapDocumentV2,
  MindMapElement,
  MindMapSheetV2,
  MindMapTopicV2
} from '../../src/shared/mindmap/domain/types'
import { validateMindMapDocumentV2 } from '../../src/shared/mindmap/domain/invariants'
import { applyMindMapCommand } from '../../src/shared/mindmap/commands/mind-map-reducer'
import { MindMapUndoRedoStack } from '../../src/shared/mindmap/commands/mind-map-undo-redo'
import {
  buildPasteCommand,
  remapClipboardIds
} from '../../src/shared/mindmap/commands/mind-map-clipboard'
import type {
  MindMapCommand,
  MindMapCommandResult
} from '../../src/shared/mindmap/commands/mind-map-command-types'
import {
  buildInsertAboveCommand,
  buildInsertChildCommand,
  buildInsertSiblingCommand,
  buildRemoveTopicsCommand,
  buildToggleCollapseTopicsCommand
} from '../../src/renderer/src/views/mindmap/mind-map-commands'

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 1,
    title: 'Test',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'theme-1', name: 'Default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        root: {
          id: 'root-1',
          title: 'Root',
          children: [
            { id: 'a', title: 'A', children: [] },
            { id: 'b', title: 'B', children: [] }
          ]
        },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

function expectInvariants(document: MindMapDocumentV2): void {
  const validation = validateMindMapDocumentV2(document)
  expect(validation.ok, validation.ok ? '' : validation.errors.map((e) => e.message).join('; ')).toBe(true)
}

function expectOk(result: MindMapCommandResult): asserts result is Extract<MindMapCommandResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  }
}

function collectTopicIds(root: MindMapTopicV2): string[] {
  const ids: string[] = []
  const stack: MindMapTopicV2[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === undefined) continue
    ids.push(node.id)
    for (const child of node.children) stack.push(child)
  }
  return ids
}

describe('applyMindMapCommand — topic commands', () => {
  it('builds one batch command while filtering roots and descendants', () => {
    const doc = makeDocument()
    doc.sheets[0]!.root.children[0]!.children.push({
      id: 'a-child',
      title: 'A child',
      children: []
    })
    const sheet = doc.sheets[0]!

    const command = buildRemoveTopicsCommand(sheet, ['root-1', 'a-child', 'a', 'b'])
    expect(command).toEqual({
      type: 'transaction',
      commands: [
        { type: 'topic.remove', sheetId: 'sheet-1', topicId: 'a' },
        { type: 'topic.remove', sheetId: 'sheet-1', topicId: 'b' }
      ]
    })

    const collapsed = buildToggleCollapseTopicsCommand(sheet, ['a', 'b'], true)
    expect(collapsed).toEqual({
      type: 'transaction',
      commands: [
        { type: 'topic.update', sheetId: 'sheet-1', topicId: 'a', patch: { collapsed: true } },
        { type: 'topic.update', sheetId: 'sheet-1', topicId: 'b', patch: { collapsed: true } }
      ]
    })
  })

  it('applies the per-sheet default shape to every newly inserted topic', () => {
    const sheet = makeDocument().sheets[0]!
    sheet.layout.defaultTopicShape = 'ellipse'

    const child = buildInsertChildCommand(sheet, 'root-1')
    const sibling = buildInsertSiblingCommand(sheet, 'a')
    const above = buildInsertAboveCommand(sheet, 'a')

    expect(child.command).toMatchObject({ node: { style: { shape: 'ellipse' } } })
    expect(sibling?.command).toMatchObject({ node: { style: { shape: 'ellipse' } } })
    expect(above?.command).toMatchObject({ node: { style: { shape: 'ellipse' } } })
  })

  it('applies the global default style (plus shape precedence) to new topics', () => {
    const sheet = makeDocument().sheets[0]!
    sheet.layout.defaultTopicStyle = {
      shape: 'diamond',
      fill: '#112233',
      fontSize: 20,
      fontStyle: 'italic'
    }
    // The global default style's shape takes precedence over the legacy
    // default-shape field when both are set.
    sheet.layout.defaultTopicShape = 'ellipse'

    const child = buildInsertChildCommand(sheet, 'root-1')
    expect(child.command).toMatchObject({
      node: { style: { shape: 'diamond', fill: '#112233', fontSize: 20, fontStyle: 'italic' } }
    })
  })

  it('inserts a topic and the inverse removes it', () => {
    const doc = makeDocument()
    const command: MindMapCommand = {
      type: 'topic.insert',
      sheetId: 'sheet-1',
      parentId: 'root-1',
      index: 0,
      node: { id: 'inserted', title: 'Inserted', children: [] }
    }
    const result = applyMindMapCommand(doc, command)
    expectOk(result)
    expect(result.inverse).toEqual({ type: 'topic.remove', sheetId: 'sheet-1', topicId: 'inserted' })
    expect(result.document.sheets[0]!.root.children[0]!.id).toBe('inserted')
    expectInvariants(result.document)

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document).toEqual(doc)
  })

  it('updates topic fields and the inverse restores them', () => {
    const doc = makeDocument()
    const command: MindMapCommand = {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { title: 'Renamed A', note: 'hello', style: { fill: '#ff0000' } }
    }
    const result = applyMindMapCommand(doc, command)
    expectOk(result)
    expect(result.document.sheets[0]!.root.children[0]!.title).toBe('Renamed A')
    expect(result.document.sheets[0]!.root.children[0]!.note).toBe('hello')
    expect(result.document.sheets[0]!.root.children[0]!.style).toEqual({ fill: '#ff0000' })

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    const restored = undone.document.sheets[0]!.root.children[0]!
    expect(restored.title).toBe('A')
    expect(restored.note).toBeUndefined()
    expect(restored.style).toBeUndefined()
    expectInvariants(undone.document)
  })

  it('stores formula and asset references through the command and undo paths', () => {
    const doc = makeDocument()
    const asset: MindMapAssetRef = {
      id: 'asset-1',
      fileName: 'diagram.png',
      mimeType: 'image/png',
      sizeBytes: 12
    }

    const created = applyMindMapCommand(doc, { type: 'asset.create', asset })
    expectOk(created)
    expect(created.document.assets).toEqual([asset])

    const updated = applyMindMapCommand(created.document, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { formula: 'x^2 + y^2 = z^2', assetIds: [asset.id] }
    })
    expectOk(updated)
    expect(updated.document.sheets[0]!.root.children[0]).toMatchObject({
      formula: 'x^2 + y^2 = z^2',
      assetIds: [asset.id]
    })
    expectInvariants(updated.document)

    const blockedRemove = applyMindMapCommand(updated.document, {
      type: 'asset.remove',
      assetId: asset.id
    })
    expect(blockedRemove.ok).toBe(false)

    const detached = applyMindMapCommand(updated.document, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { formula: null, assetIds: null }
    })
    expectOk(detached)
    const removed = applyMindMapCommand(detached.document, {
      type: 'asset.remove',
      assetId: asset.id
    })
    expectOk(removed)
    expect(removed.document.assets).toEqual([])

    const restored = applyMindMapCommand(removed.document, removed.inverse)
    expectOk(restored)
    expect(restored.document.assets).toEqual([asset])
  })

  it('validates fixed topic width and restores width mode through the inverse', () => {
    const doc = makeDocument()
    const result = applyMindMapCommand(doc, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { style: { widthMode: 'fixed', width: 240 } }
    })
    expectOk(result)
    expect(result.document.sheets[0]!.root.children[0]!.style).toEqual({ widthMode: 'fixed', width: 240 })

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document.sheets[0]!.root.children[0]!.style).toBeUndefined()

    const invalid = applyMindMapCommand(doc, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { style: { widthMode: 'fixed' } }
    })
    expect(invalid.ok).toBe(false)
  })

  it('moves a topic to a new parent and back', () => {
    const doc = makeDocument()
    const command: MindMapCommand = {
      type: 'topic.move',
      sheetId: 'sheet-1',
      topicId: 'a',
      toParentId: 'b',
      toIndex: 0
    }
    const result = applyMindMapCommand(doc, command)
    expectOk(result)
    const movedSheet = result.document.sheets[0]!
    expect(movedSheet.root.children.map((n) => n.id)).toEqual(['b'])
    expect(movedSheet.root.children[0]!.children.map((n) => n.id)).toEqual(['a'])
    expectInvariants(result.document)

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document).toEqual(doc)
  })

  it('inverts a transaction that reparents and reorders multiple topics', () => {
    const doc = makeDocument()
    doc.sheets[0]!.root.children.push({ id: 'c', title: 'C', children: [] })
    const command: MindMapCommand = {
      type: 'transaction',
      commands: [
        {
          type: 'topic.move',
          sheetId: 'sheet-1',
          topicId: 'a',
          toParentId: 'b',
          toIndex: 0
        },
        {
          type: 'topic.move',
          sheetId: 'sheet-1',
          topicId: 'c',
          toParentId: 'b',
          toIndex: 0
        },
        {
          type: 'topic.move',
          sheetId: 'sheet-1',
          topicId: 'a',
          toParentId: 'b',
          toIndex: 1
        }
      ]
    }

    const result = applyMindMapCommand(doc, command)
    expectOk(result)
    expect(result.document.sheets[0]!.root.children.map((topic) => topic.id)).toEqual(['b'])
    expect(result.document.sheets[0]!.root.children[0]!.children.map((topic) => topic.id)).toEqual([
      'c',
      'a'
    ])
    expectInvariants(result.document)

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document).toEqual(doc)
  })

  it('rejects moving a topic into its own descendant', () => {
    const doc = makeDocument()
    const insert = applyMindMapCommand(doc, {
      type: 'topic.insert',
      sheetId: 'sheet-1',
      parentId: 'a',
      node: { id: 'a1', title: 'A1', children: [] }
    })
    expectOk(insert)
    const bad = applyMindMapCommand(insert.document, {
      type: 'topic.move',
      sheetId: 'sheet-1',
      topicId: 'a',
      toParentId: 'a1'
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('CYCLIC_MOVE')

    const self = applyMindMapCommand(insert.document, {
      type: 'topic.move',
      sheetId: 'sheet-1',
      topicId: 'a',
      toParentId: 'a'
    })
    expect(self.ok).toBe(false)
    if (!self.ok) expect(self.error.code).toBe('CYCLIC_MOVE')
  })

  it('removes a topic subtree and the inverse restores it exactly', () => {
    const doc = makeDocument()
    const insert = applyMindMapCommand(doc, {
      type: 'topic.insert',
      sheetId: 'sheet-1',
      parentId: 'a',
      index: 0,
      node: {
        id: 'sub',
        title: 'Sub',
        children: [{ id: 'leaf', title: 'Leaf', children: [] }]
      }
    })
    expectOk(insert)

    const result = applyMindMapCommand(insert.document, {
      type: 'topic.remove',
      sheetId: 'sheet-1',
      topicId: 'sub'
    })
    expectOk(result)
    expect(result.document.sheets[0]!.root.children[0]!.children.map((n) => n.id)).toEqual([])
    expectInvariants(result.document)

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document).toEqual(insert.document)
  })
})

describe('applyMindMapCommand — elements', () => {
  it('creates, updates and removes a relationship element', () => {
    const doc = makeDocument()
    const relationship: MindMapElement = {
      id: 'rel-1',
      type: 'relationship',
      from: 'a',
      to: 'b',
      label: 'connects'
    }
    const inverses: MindMapCommand[] = []
    let result = applyMindMapCommand(doc, { type: 'element.create', sheetId: 'sheet-1', element: relationship })
    expectOk(result)
    inverses.push(result.inverse)
    expect(result.document.sheets[0]!.elements).toHaveLength(1)
    expectInvariants(result.document)

    result = applyMindMapCommand(result.document, {
      type: 'element.update',
      sheetId: 'sheet-1',
      elementId: 'rel-1',
      patch: { label: 'updated', style: { strokeWidth: 2 } }
    })
    expectOk(result)
    inverses.push(result.inverse)
    const element = result.document.sheets[0]!.elements[0]!
    expect(element.type).toBe('relationship')
    if (element.type === 'relationship') {
      expect(element.label).toBe('updated')
      expect(element.style).toEqual({ strokeWidth: 2 })
    }
    expectInvariants(result.document)

    result = applyMindMapCommand(result.document, { type: 'element.remove', sheetId: 'sheet-1', elementId: 'rel-1' })
    expectOk(result)
    inverses.push(result.inverse)
    expect(result.document.sheets[0]!.elements).toHaveLength(0)

    for (const inverse of inverses.reverse()) {
      result = applyMindMapCommand(result.document, inverse)
      expectOk(result)
    }
    expect(result.document).toEqual(doc)
  })

  it('rejects an element that references a missing topic', () => {
    const bad: MindMapElement = { id: 'rel-bad', type: 'relationship', from: 'missing', to: 'b' }
    const result = applyMindMapCommand(makeDocument(), {
      type: 'element.create',
      sheetId: 'sheet-1',
      element: bad
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_PATCH')
  })
})

describe('applyMindMapCommand — topic numbering', () => {
  it('applies a numbering patch and the inverse clears it', () => {
    const doc = makeDocument()
    const result = applyMindMapCommand(doc, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { numbering: { pattern: 'arabic', tiered: true, restartAt: 3 } }
    })
    expectOk(result)
    expect(result.document.sheets[0]!.root.children[0]!.numbering).toEqual({
      pattern: 'arabic',
      tiered: true,
      restartAt: 3
    })
    expectInvariants(result.document)

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document.sheets[0]!.root.children[0]!.numbering).toBeUndefined()
    expect(undone.document).toEqual(doc)
  })

  it('updates an existing numbering and undo restores the previous value', () => {
    const doc = makeDocument()
    const first = applyMindMapCommand(doc, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { numbering: { pattern: 'arabic' } }
    })
    expectOk(first)

    const second = applyMindMapCommand(first.document, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { numbering: { pattern: 'roman', tiered: true } }
    })
    expectOk(second)
    expect(second.document.sheets[0]!.root.children[0]!.numbering).toEqual({
      pattern: 'roman',
      tiered: true
    })

    const undone = applyMindMapCommand(second.document, second.inverse)
    expectOk(undone)
    expect(undone.document.sheets[0]!.root.children[0]!.numbering).toEqual({
      pattern: 'arabic'
    })
  })

  it('clears numbering with a null patch', () => {
    const doc = makeDocument()
    const set = applyMindMapCommand(doc, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { numbering: { pattern: 'uppercase' } }
    })
    expectOk(set)
    const cleared = applyMindMapCommand(set.document, {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { numbering: null }
    })
    expectOk(cleared)
    expect(cleared.document.sheets[0]!.root.children[0]!.numbering).toBeUndefined()
    expect(cleared.inverse).toEqual({
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { numbering: { pattern: 'uppercase' } }
    })
  })

  it('rejects an invalid numbering pattern with INVALID_NUMBERING', () => {
    const result = applyMindMapCommand(makeDocument(), {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { numbering: { pattern: 'hexadecimal' as never } }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_NUMBERING')
  })

  it('rejects out-of-range or non-integer restartAt values', () => {
    const doc = makeDocument()
    const cases = [
      { pattern: 'arabic', restartAt: 0 },
      { pattern: 'arabic', restartAt: 10000 },
      { pattern: 'arabic', restartAt: 2.5 },
      { pattern: 'arabic', restartAt: Number.NaN }
    ]
    for (const numbering of cases) {
      const result = applyMindMapCommand(doc, {
        type: 'topic.update',
        sheetId: 'sheet-1',
        topicId: 'a',
        patch: { numbering }
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('INVALID_NUMBERING')
    }
  })

  it('accepts a valid restartAt at the schema bounds', () => {
    const result = applyMindMapCommand(makeDocument(), {
      type: 'topic.update',
      sheetId: 'sheet-1',
      topicId: 'a',
      patch: { numbering: { pattern: 'arabic', restartAt: 9999 } }
    })
    expectOk(result)
  })
})

describe('applyMindMapCommand — selection style', () => {
  it('sets style on multiple selected topics and undo restores each', () => {
    const doc = makeDocument()
    const result = applyMindMapCommand(doc, {
      type: 'selection.set-style',
      sheetId: 'sheet-1',
      topicIds: ['a', 'b'],
      style: { fill: '#00ff00' }
    })
    expectOk(result)
    const sheet = result.document.sheets[0]!
    expect(sheet.root.children[0]!.style).toEqual({ fill: '#00ff00' })
    expect(sheet.root.children[1]!.style).toEqual({ fill: '#00ff00' })
    expectInvariants(result.document)

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document).toEqual(doc)
  })
})

describe('applyMindMapCommand — document rename', () => {
  it('renames the document and the inverse restores the old title', () => {
    const doc = makeDocument()
    const result = applyMindMapCommand(doc, { type: 'document.rename', title: 'New title' })
    expectOk(result)
    expect(result.document.title).toBe('New title')
    expect(result.inverse).toEqual({ type: 'document.rename', title: 'Test' })

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document).toEqual(doc)
  })
})

describe('applyMindMapCommand — sheets and theme', () => {
  it('creates, renames, reorders, and removes a sheet', () => {
    const doc = makeDocument()
    const inverses: MindMapCommand[] = []
    let result = applyMindMapCommand(doc, { type: 'sheet.create', sheetId: 'sheet-2', title: 'Sheet 2' })
    expectOk(result)
    inverses.push(result.inverse)
    expect(result.document.sheets.map((s) => s.id)).toEqual(['sheet-1', 'sheet-2'])
    expect(result.document.sheets[1]!.layout).toMatchObject({
      structureClass: 'org.xmind.ui.logic.right',
      defaultTopicShape: 'rounded-rect'
    })
    expectInvariants(result.document)

    result = applyMindMapCommand(result.document, { type: 'sheet.rename', sheetId: 'sheet-2', title: 'Renamed' })
    expectOk(result)
    inverses.push(result.inverse)
    expect(result.document.sheets[1]!.title).toBe('Renamed')

    result = applyMindMapCommand(result.document, { type: 'sheet.reorder', sheetId: 'sheet-2', toIndex: 0 })
    expectOk(result)
    inverses.push(result.inverse)
    expect(result.document.sheets.map((s) => s.id)).toEqual(['sheet-2', 'sheet-1'])

    result = applyMindMapCommand(result.document, { type: 'sheet.remove', sheetId: 'sheet-2' })
    expectOk(result)
    inverses.push(result.inverse)
    expect(result.document.sheets.map((s) => s.id)).toEqual(['sheet-1'])

    for (const inverse of inverses.reverse()) {
      result = applyMindMapCommand(result.document, inverse)
      expectOk(result)
    }
    expect(result.document).toEqual(doc)
  })

  it('applies a theme and restores the previous one', () => {
    const doc = makeDocument()
    const command: MindMapCommand = {
      type: 'document.apply-theme',
      theme: { id: 'theme-2', name: 'Dark', background: '#111111' }
    }
    const result = applyMindMapCommand(doc, command)
    expectOk(result)
    expect(result.document.theme.id).toBe('theme-2')
    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document).toEqual(doc)
  })

  it('updates per-sheet layout settings and restores optional values exactly', () => {
    const doc = makeDocument()
    const result = applyMindMapCommand(doc, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: {
        structureClass: 'org.xmind.ui.logic.balanced',
        direction: 'rtl',
        compact: true,
        spacing: 28,
        lineStyle: 'elbow'
      }
    })
    expectOk(result)
    expect(result.document.sheets[0]!.layout).toEqual({
      structureClass: 'org.xmind.ui.logic.balanced',
      direction: 'rtl',
      compact: true,
      spacing: 28,
      lineStyle: 'elbow'
    })
    expectInvariants(result.document)

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document).toEqual(doc)
  })

  it('keeps an explicit connector override independent from structure defaults', () => {
    const doc = makeDocument()
    const overridden = applyMindMapCommand(doc, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { lineStyle: 'curve' }
    })
    expectOk(overridden)

    const changedStructure = applyMindMapCommand(overridden.document, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { structureClass: 'org.xmind.ui.timeline.horizontal' }
    })
    expectOk(changedStructure)
    expect(changedStructure.document.sheets[0]!.layout).toMatchObject({
      structureClass: 'org.xmind.ui.timeline.horizontal',
      lineStyle: 'curve'
    })

    const reset = applyMindMapCommand(changedStructure.document, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { lineStyle: null }
    })
    expectOk(reset)
    expect(reset.document.sheets[0]!.layout.lineStyle).toBeUndefined()
    expect(reset.inverse).toEqual({
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: {
        structureClass: 'org.xmind.ui.timeline.horizontal',
        direction: null,
        compact: null,
        spacing: null,
        lineStyle: 'curve',
        lineWidthScale: null,
        linePattern: null,
        tapered: null,
        defaultTopicShape: null,
        defaultTopicStyle: null
      }
    })
  })

  it('persists, clears, and validates the default topic shape', () => {
    const doc = makeDocument()
    const updated = applyMindMapCommand(doc, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { defaultTopicShape: 'hexagon' }
    })
    expectOk(updated)
    expect(updated.document.sheets[0]!.layout.defaultTopicShape).toBe('hexagon')

    const cleared = applyMindMapCommand(updated.document, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { defaultTopicShape: null }
    })
    expectOk(cleared)
    expect(cleared.document.sheets[0]!.layout.defaultTopicShape).toBeUndefined()

    const invalid = applyMindMapCommand(doc, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { defaultTopicShape: 'not-a-shape' as never }
    })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.code).toBe('INVALID_PATCH')
  })

  it('persists, clears, and validates the global default topic style', () => {
    const doc = makeDocument()
    const updated = applyMindMapCommand(doc, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: {
        defaultTopicStyle: { fill: '#112233', fontSize: 20, fontStyle: 'italic' }
      }
    })
    expectOk(updated)
    expect(updated.document.sheets[0]!.layout.defaultTopicStyle).toEqual({
      fill: '#112233',
      fontSize: 20,
      fontStyle: 'italic'
    })

    const cleared = applyMindMapCommand(updated.document, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { defaultTopicStyle: null }
    })
    expectOk(cleared)
    expect(cleared.document.sheets[0]!.layout.defaultTopicStyle).toBeUndefined()

    const invalid = applyMindMapCommand(doc, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { defaultTopicStyle: { fontSize: -1 } }
    })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.code).toBe('INVALID_PATCH')
  })

  it('rejects invalid sheet layout spacing and connector style', () => {
    const doc = makeDocument()
    const invalidSpacing = applyMindMapCommand(doc, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { spacing: -1 }
    })
    expect(invalidSpacing.ok).toBe(false)
    if (!invalidSpacing.ok) expect(invalidSpacing.error.code).toBe('INVALID_PATCH')

    const invalidLineStyle = applyMindMapCommand(doc, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { lineStyle: 'dashed' as never }
    })
    expect(invalidLineStyle.ok).toBe(false)
    if (!invalidLineStyle.ok) expect(invalidLineStyle.error.code).toBe('INVALID_PATCH')
  })

  it('applies, inverts, and validates the per-sheet branch line-width scale', () => {
    const doc = makeDocument()
    const result = applyMindMapCommand(doc, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { lineWidthScale: 1.5 }
    })
    expectOk(result)
    expect(result.document.sheets[0]!.layout.lineWidthScale).toBe(1.5)

    // Undo restores the default (no field).
    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document).toEqual(doc)

    // Clearing via null removes the field.
    const cleared = applyMindMapCommand(result.document, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { lineWidthScale: null }
    })
    expectOk(cleared)
    expect(cleared.document.sheets[0]!.layout.lineWidthScale).toBeUndefined()

    // Non-positive scales are rejected.
    const invalid = applyMindMapCommand(doc, {
      type: 'sheet.update-layout',
      sheetId: 'sheet-1',
      patch: { lineWidthScale: 0 }
    })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.code).toBe('INVALID_PATCH')
  })
})

describe('transactions', () => {
  it('applies all-or-nothing and undo restores the whole group', () => {
    const doc = makeDocument()
    const command: MindMapCommand = {
      type: 'transaction',
      commands: [
        { type: 'topic.insert', sheetId: 'sheet-1', parentId: 'root-1', node: { id: 'x', title: 'X', children: [] } },
        { type: 'topic.insert', sheetId: 'sheet-1', parentId: 'root-1', node: { id: 'y', title: 'Y', children: [] } },
        { type: 'topic.update', sheetId: 'sheet-1', topicId: 'a', patch: { title: 'Updated A' } }
      ]
    }
    const result = applyMindMapCommand(doc, command)
    expectOk(result)
    const sheet = result.document.sheets[0]!
    expect(sheet.root.children.map((n) => n.id)).toEqual(['a', 'b', 'x', 'y'])
    expect(sheet.root.children.find((n) => n.id === 'a')!.title).toBe('Updated A')
    expectInvariants(result.document)

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document).toEqual(doc)
  })

  it('keeps a 100-topic continuous insert transaction atomic and reversible', () => {
    const doc = makeDocument()
    const insertedIds = Array.from({ length: 100 }, (_, index) => `keyboard-${index + 1}`)
    const command: MindMapCommand = {
      type: 'transaction',
      commands: insertedIds.map((id) => ({
        type: 'topic.insert',
        sheetId: 'sheet-1',
        parentId: 'root-1',
        node: { id, title: `Topic ${id}`, children: [] }
      }))
    }

    const result = applyMindMapCommand(doc, command)
    expectOk(result)
    const children = result.document.sheets[0]!.root.children
    expect(children).toHaveLength(102)
    expect(children.slice(-100).map((topic) => topic.id)).toEqual(insertedIds)
    expectInvariants(result.document)

    const undone = applyMindMapCommand(result.document, result.inverse)
    expectOk(undone)
    expect(undone.document).toEqual(doc)
  })

  it('rejects the whole transaction when one inner command fails', () => {
    const doc = makeDocument()
    const command: MindMapCommand = {
      type: 'transaction',
      commands: [
        { type: 'topic.insert', sheetId: 'sheet-1', parentId: 'root-1', node: { id: 'x', title: 'X', children: [] } },
        { type: 'topic.insert', sheetId: 'sheet-1', parentId: 'root-1', node: { id: 'x', title: 'duplicate', children: [] } }
      ]
    }
    const result = applyMindMapCommand(doc, command)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_TRANSACTION')
    expect(doc.sheets[0]!.root.children.map((n) => n.id)).toEqual(['a', 'b'])
  })
})

describe('MindMapUndoRedoStack', () => {
  it('undo/redo round-trips a sequence of commands', () => {
    const stack = new MindMapUndoRedoStack(makeDocument())
    const commands: MindMapCommand[] = [
      { type: 'topic.insert', sheetId: 'sheet-1', parentId: 'root-1', node: { id: 'x', title: 'X', children: [] } },
      { type: 'element.create', sheetId: 'sheet-1', element: { id: 'rel-x', type: 'relationship', from: 'x', to: 'a' } },
      { type: 'topic.update', sheetId: 'sheet-1', topicId: 'a', patch: { title: 'A2' } },
      { type: 'sheet.create', sheetId: 'sheet-2', title: 'Sheet 2' },
      { type: 'document.apply-theme', theme: { id: 'theme-2', name: 'Dark' } }
    ]
    const initial = stack.document
    for (const command of commands) {
      const result = stack.execute(command)
      expectOk(result)
    }
    const final = stack.document
    expect(stack.undoCount).toBe(commands.length)
    expect(stack.canUndo()).toBe(true)

    for (let i = 0; i < commands.length; i += 1) {
      const result = stack.undo()
      expect(result).not.toBeNull()
      expectOk(result as MindMapCommandResult)
    }
    expect(stack.document).toEqual(initial)
    expect(stack.canRedo()).toBe(true)

    for (let i = 0; i < commands.length; i += 1) {
      const result = stack.redo()
      expect(result).not.toBeNull()
      expectOk(result as MindMapCommandResult)
    }
    expect(stack.document).toEqual(final)
    expect(stack.canUndo()).toBe(true)
    expect(stack.canRedo()).toBe(false)
  })

  it('merges consecutive inputs sharing a mergeKey into one undo unit', () => {
    const stack = new MindMapUndoRedoStack(makeDocument())
    const insertOne: MindMapCommand = { type: 'topic.insert', sheetId: 'sheet-1', parentId: 'root-1', node: { id: 'typing-1', title: 'T1', children: [] } }
    const insertTwo: MindMapCommand = { type: 'topic.insert', sheetId: 'sheet-1', parentId: 'root-1', node: { id: 'typing-2', title: 'T2', children: [] } }

    expectOk(stack.execute(insertOne, { label: 'Type', mergeKey: 'typing' }))
    expectOk(stack.execute(insertTwo, { label: 'Type', mergeKey: 'typing' }))
    expect(stack.undoCount).toBe(1)

    const afterTyping = stack.document
    const undone = stack.undo()
    expectOk(undone as MindMapCommandResult)
    expect(stack.document.sheets[0]!.root.children.map((n) => n.id)).toEqual(['a', 'b'])
    expect(stack.canRedo()).toBe(true)

    const redone = stack.redo()
    expectOk(redone as MindMapCommandResult)
    expect(stack.document).toEqual(afterTyping)
  })

  it('clears redo history after a fresh command', () => {
    const stack = new MindMapUndoRedoStack(makeDocument())
    expectOk(stack.execute({ type: 'topic.insert', sheetId: 'sheet-1', parentId: 'root-1', node: { id: 'x', title: 'X', children: [] } }))
    expectOk(stack.undo() as MindMapCommandResult)
    expect(stack.canRedo()).toBe(true)
    expectOk(stack.execute({ type: 'topic.insert', sheetId: 'sheet-1', parentId: 'root-1', node: { id: 'y', title: 'Y', children: [] } }))
    expect(stack.canRedo()).toBe(false)
  })
})

describe('clipboard', () => {
  it('builds an all-or-nothing paste transaction with remapped ids', () => {
    const doc = makeDocument()
    const data = {
      documentId: 'doc-1',
      sheetId: 'sheet-1',
      branches: [
        { id: 'branch', title: 'Branch', children: [{ id: 'child', title: 'Child', children: [] }] }
      ],
      elements: [{ id: 'rel-branch', type: 'relationship' as const, from: 'branch', to: 'child', label: 'x' }],
      capturedAt: '2026-08-09T00:00:00.000Z'
    }
    const remap = (id: string): string => `copy-${id}`
    const payload = { kind: 'paste' as const, data, targetSheetId: 'sheet-1', targetParentId: 'root-1', index: 0 }
    const command = buildPasteCommand(payload, remap)
    expect(command.type).toBe('transaction')
    if (command.type !== 'transaction') return
    expect(command.commands).toHaveLength(2)

    const result = applyMindMapCommand(doc, command)
    expectOk(result)
    const sheet = result.document.sheets[0]!
    expect(sheet.root.children[0]!.id).toBe('copy-branch')
    expect(sheet.root.children[0]!.children[0]!.id).toBe('copy-child')
    expect(sheet.elements[0]!.type).toBe('relationship')
    if (sheet.elements[0]!.type === 'relationship') {
      expect(sheet.elements[0]!.from).toBe('copy-branch')
      expect(sheet.elements[0]!.to).toBe('copy-child')
    }
    expectInvariants(result.document)
  })

  it('remapClipboardIds remaps branches and element refs consistently', () => {
    const data = {
      documentId: 'doc-1',
      sheetId: 'sheet-1',
      branches: [{ id: 'a', title: 'A', children: [] }],
      elements: [{ id: 'rel', type: 'relationship' as const, from: 'a', to: 'a' }],
      capturedAt: '2026-08-09T00:00:00.000Z'
    }
    const { branches, elements } = remapClipboardIds(data, (id) => `${id}-new`)
    expect(branches[0]!.id).toBe('a-new')
    expect(elements[0]!.type).toBe('relationship')
    if (elements[0]!.type === 'relationship') {
      expect(elements[0]!.from).toBe('a-new')
      expect(elements[0]!.to).toBe('a-new')
    }
  })

  it('remaps a linked summary output topic with the copied branch', () => {
    const data = {
      documentId: 'doc-1',
      sheetId: 'sheet-1',
      branches: [{ id: 'output', title: 'Node summary', children: [] }],
      elements: [{
        id: 'summary',
        type: 'summary' as const,
        from: 'output',
        to: 'output',
        summaryTopicId: 'output'
      }],
      capturedAt: '2026-08-09T00:00:00.000Z'
    }
    const { elements } = remapClipboardIds(data, (id) => `${id}-copy`)

    expect(elements[0]).toEqual({
      id: 'summary',
      type: 'summary',
      from: 'output-copy',
      to: 'output-copy',
      summaryTopicId: 'output-copy'
    })
  })
})

// Deterministic PRNG so the random-command test is reproducible.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomTopic(sheet: MindMapSheetV2): MindMapTopicV2[] {
  return collectTopicIds(sheet.root).map((id) => {
    const stack: MindMapTopicV2[] = [sheet.root]
    while (stack.length > 0) {
      const node = stack.pop()
      if (node === undefined) continue
      if (node.id === id) return node
      for (const child of node.children) stack.push(child)
    }
    throw new Error(`topic ${id} not found`)
  })
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!
}

function randomCommand(doc: MindMapDocumentV2, rng: () => number, counter: { n: number }): MindMapCommand {
  const sheet = pick(doc.sheets, rng)
  const topics = randomTopic(sheet)
  const nonRootTopics = topics.slice(1)
  const kindRoll = rng()

  if (kindRoll < 0.12 && topics.length > 0) {
    const parent = pick(topics, rng)
    const id = `t${counter.n++}`
    return {
      type: 'topic.insert',
      sheetId: sheet.id,
      parentId: parent.id,
      index: Math.floor(rng() * (parent.children.length + 1)),
      node: { id, title: `Topic ${id}`, children: [] }
    }
  }

  if (kindRoll < 0.22 && topics.length > 0) {
    const topic = pick(topics, rng)
    return {
      type: 'topic.update',
      sheetId: sheet.id,
      topicId: topic.id,
      patch: { title: `${topic.title}-updated`, style: { fill: '#123456' } }
    }
  }

  if (kindRoll < 0.32 && nonRootTopics.length > 0 && topics.length > 1) {
    const topic = pick(nonRootTopics, rng)
    const candidates = topics.filter((candidate) => candidate.id !== topic.id && !containsInTree(topic, candidate.id))
    if (candidates.length === 0) return randomCommand(doc, rng, counter)
    const toParent = pick(candidates, rng)
    return {
      type: 'topic.move',
      sheetId: sheet.id,
      topicId: topic.id,
      toParentId: toParent.id,
      toIndex: Math.floor(rng() * (toParent.children.length + 1))
    }
  }

  if (kindRoll < 0.42 && nonRootTopics.length > 0) {
    const topic = pick(nonRootTopics, rng)
    return { type: 'topic.remove', sheetId: sheet.id, topicId: topic.id }
  }

  if (kindRoll < 0.52 && topics.length > 1) {
    const from = pick(topics, rng)
    const to = pick(topics, rng)
    return {
      type: 'element.create',
      sheetId: sheet.id,
      element: { id: `rel-${counter.n++}`, type: 'relationship', from: from.id, to: to.id }
    }
  }

  if (kindRoll < 0.58 && sheet.elements.length > 0) {
    const element = pick(sheet.elements, rng)
    return { type: 'element.remove', sheetId: sheet.id, elementId: element.id }
  }

  if (kindRoll < 0.66) {
    const sheetId = `sheet-${counter.n++}`
    return { type: 'sheet.create', sheetId, title: `Sheet ${sheetId}` }
  }

  if (kindRoll < 0.72) {
    const target = pick(doc.sheets, rng)
    return { type: 'sheet.rename', sheetId: target.id, title: `${target.title}-r` }
  }

  if (kindRoll < 0.78 && doc.sheets.length > 1) {
    const target = pick(doc.sheets, rng)
    return { type: 'sheet.reorder', sheetId: target.id, toIndex: Math.floor(rng() * doc.sheets.length) }
  }

  if (kindRoll < 0.84 && doc.sheets.length > 1) {
    const target = pick(doc.sheets, rng)
    return { type: 'sheet.remove', sheetId: target.id }
  }

  if (kindRoll < 0.9) {
    const selected = topics.slice(0, Math.max(1, Math.floor(rng() * topics.length)))
    return {
      type: 'selection.set-style',
      sheetId: sheet.id,
      topicIds: selected.map((topic) => topic.id),
      style: { fill: `#${Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0')}` }
    }
  }

  if (kindRoll < 0.95) {
    return { type: 'document.apply-theme', theme: { id: `theme-${counter.n++}`, name: `Theme ${counter.n}` } }
  }

  // transaction: a pair of safe commands (insert + update)
  const parent = pick(topics, rng)
  const id = `tx-${counter.n++}`
  return {
    type: 'transaction',
    commands: [
      { type: 'topic.insert', sheetId: sheet.id, parentId: parent.id, node: { id, title: 'Tx', children: [] } },
      { type: 'topic.update', sheetId: sheet.id, topicId: id, patch: { note: 'from transaction' } }
    ]
  }
}

function containsInTree(node: MindMapTopicV2, targetId: string): boolean {
  if (node.id === targetId) return true
  return node.children.some((child) => containsInTree(child, targetId))
}

describe('random command sequences', () => {
  it('runs a random sequence, keeps invariants, and undo/redo round-trips', () => {
    const rng = mulberry32(20260809)
    const counter = { n: 100 }
    const initial = makeDocument()
    const stack = new MindMapUndoRedoStack(initial)

    const steps = 300
    for (let i = 0; i < steps; i += 1) {
      const command = randomCommand(stack.document, rng, counter)
      const result = stack.execute(command)
      expectOk(result)
      expectInvariants(stack.document)
    }

    const final = stack.document
    expect(final).not.toEqual(initial)
    expect(stack.canUndo()).toBe(true)

    let guard = 0
    while (stack.canUndo() && guard < steps + 10) {
      const result = stack.undo()
      expect(result).not.toBeNull()
      expectOk(result as MindMapCommandResult)
      expectInvariants(stack.document)
      guard += 1
    }
    expect(stack.document).toEqual(initial)

    guard = 0
    while (stack.canRedo() && guard < steps + 10) {
      const result = stack.redo()
      expect(result).not.toBeNull()
      expectOk(result as MindMapCommandResult)
      expectInvariants(stack.document)
      guard += 1
    }
    expect(stack.document).toEqual(final)
  })
})
