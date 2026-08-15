import { describe, expect, it } from 'vitest'

import { applyMindMapCommand } from '../../src/shared/mindmap/commands/mind-map-reducer'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import {
  buildAddSummaryCommand,
  buildDuplicateCommand,
  buildRemoveCommand,
  buildRemoveTopicsCommand,
  canAddSummaryToTopics
} from '../../src/renderer/src/views/mindmap/mind-map-commands'

const NOW = '2026-08-15T00:00:00.000Z'

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-summary',
    revision: 1,
    title: 'Summary',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet',
        root: {
          id: 'root',
          title: 'Root',
          children: [
            { id: 'a', title: 'A', children: [] },
            { id: 'b', title: 'B', children: [] },
            { id: 'c', title: 'C', children: [] }
          ]
        },
        elements: [],
        layout: { structureClass: 'org.xmind.ui.logic.right' }
      }
    ],
    assets: []
  }
}

function sheetOf(document: MindMapDocumentV2) {
  return document.sheets[0]
}

describe('canAddSummaryToTopics', () => {
  it('returns true for two or more siblings', () => {
    const sheet = sheetOf(makeDocument())
    expect(canAddSummaryToTopics(sheet, ['a', 'b'])).toBe(true)
    expect(canAddSummaryToTopics(sheet, ['a', 'b', 'c'])).toBe(true)
  })

  it('returns false for a single topic', () => {
    const sheet = sheetOf(makeDocument())
    expect(canAddSummaryToTopics(sheet, ['a'])).toBe(false)
  })

  it('allows multiple topics selected in different branches', () => {
    const sheet = sheetOf(makeDocument())
    sheet.root.children[0].children.push({ id: 'a1', title: 'A1', children: [] })
    sheet.root.children[1].children.push({ id: 'b1', title: 'B1', children: [] })
    sheet.root.children[2].children.push({ id: 'c1', title: 'C1', children: [] })

    expect(canAddSummaryToTopics(sheet, ['a1', 'b1', 'c1'])).toBe(true)
  })

  it('ignores an incidental root hit when a marquee selects multiple branch topics', () => {
    const sheet = sheetOf(makeDocument())
    sheet.root.children[0].children.push({ id: 'a1', title: 'A1', children: [] })
    sheet.root.children[1].children.push({ id: 'b1', title: 'B1', children: [] })
    sheet.root.children[2].children.push({ id: 'c1', title: 'C1', children: [] })

    expect(canAddSummaryToTopics(sheet, ['root', 'a1', 'b1', 'c1'])).toBe(true)
  })

  it('returns false when the root is the only non-source selection', () => {
    const sheet = sheetOf(makeDocument())
    expect(canAddSummaryToTopics(sheet, ['root', 'a'])).toBe(false)
  })
})

describe('buildAddSummaryCommand', () => {
  it('spans the contiguous sibling range from the earliest to latest selected', () => {
    const document = makeDocument()
    const built = buildAddSummaryCommand(sheetOf(document), ['c', 'a'])
    expect(built).not.toBeNull()
    const result = applyMindMapCommand(document, built!.command)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const element = result.document.sheets[0].elements[0]
    expect(element.type).toBe('summary')
    if (element.type !== 'summary') return
    expect(element.from).toBe('a')
    expect(element.to).toBe('c')
    expect(element.summaryTopicId).toBe(built!.summaryTopicId)
    expect(result.document.sheets[0].root.children).toContainEqual(expect.objectContaining({
      id: built!.summaryTopicId,
      title: '',
      children: []
    }))
  })

  it('creates a cross-branch summary beneath the selected topics’ lowest common ancestor', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.children.push({ id: 'a1', title: 'A1', children: [] })
    document.sheets[0]!.root.children[1]!.children.push({ id: 'b1', title: 'B1', children: [] })
    document.sheets[0]!.root.children[2]!.children.push({ id: 'c1', title: 'C1', children: [] })

    const built = buildAddSummaryCommand(sheetOf(document), ['a1', 'b1', 'c1'], '跨分支总结')
    expect(built).not.toBeNull()
    const created = applyMindMapCommand(document, built!.command)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(created.document.sheets[0]!.elements).toContainEqual(expect.objectContaining({
      type: 'summary',
      from: 'a1',
      to: 'c1',
      sourceTopicIds: ['a1', 'b1', 'c1'],
      summaryTopicId: built!.summaryTopicId
    }))
    expect(created.document.sheets[0]!.root.children).toContainEqual(expect.objectContaining({
      id: built!.summaryTopicId,
      title: '跨分支总结'
    }))
  })

  it('creates a multi-branch summary from a marquee selection that also intersects the root', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.children.push({ id: 'a1', title: 'A1', children: [] })
    document.sheets[0]!.root.children[1]!.children.push({ id: 'b1', title: 'B1', children: [] })
    document.sheets[0]!.root.children[2]!.children.push({ id: 'c1', title: 'C1', children: [] })

    const built = buildAddSummaryCommand(sheetOf(document), ['root', 'a1', 'b1', 'c1'], '跨分支总结')
    expect(built).not.toBeNull()
    const created = applyMindMapCommand(document, built!.command)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(created.document.sheets[0]!.elements).toContainEqual(expect.objectContaining({
      type: 'summary',
      from: 'a1',
      to: 'c1',
      sourceTopicIds: ['a1', 'b1', 'c1'],
      summaryTopicId: built!.summaryTopicId
    }))
  })

  it('retargets a multi-branch summary and then nests its output under the final source', () => {
    const document = makeDocument()
    document.sheets[0]!.root.children[0]!.children.push({ id: 'a1', title: 'A1', children: [] })
    document.sheets[0]!.root.children[1]!.children.push({ id: 'b1', title: 'B1', children: [] })
    document.sheets[0]!.root.children[2]!.children.push({ id: 'c1', title: 'C1', children: [] })
    const built = buildAddSummaryCommand(sheetOf(document), ['a1', 'b1', 'c1'], '跨分支总结')
    expect(built).not.toBeNull()
    const created = applyMindMapCommand(document, built!.command)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const firstRemove = buildRemoveCommand(created.document.sheets[0]!, 'c1')
    expect(firstRemove).not.toBeNull()
    const afterFirstRemove = applyMindMapCommand(created.document, firstRemove!)
    expect(afterFirstRemove.ok).toBe(true)
    if (!afterFirstRemove.ok) return
    expect(afterFirstRemove.document.sheets[0]!.elements).toContainEqual(expect.objectContaining({
      type: 'summary',
      from: 'a1',
      to: 'b1',
      sourceTopicIds: ['a1', 'b1']
    }))

    const secondRemove = buildRemoveCommand(afterFirstRemove.document.sheets[0]!, 'a1')
    expect(secondRemove).not.toBeNull()
    const deleted = applyMindMapCommand(afterFirstRemove.document, secondRemove!)
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return

    expect(deleted.document.sheets[0]!.elements).toHaveLength(0)
    expect(deleted.document.sheets[0]!.root.children[1]!.children[0]!.children).toContainEqual(expect.objectContaining({
      id: built!.summaryTopicId,
      title: '跨分支总结'
    }))
  })

  it('returns null when selection is invalid', () => {
    const document = makeDocument()
    expect(buildAddSummaryCommand(sheetOf(document), ['a'])).toBeNull()
    expect(buildAddSummaryCommand(sheetOf(document), ['root', 'a'])).toBeNull()
  })

  it('seeds the ordinary output topic with the requested title', () => {
    const document = makeDocument()
    const built = buildAddSummaryCommand(sheetOf(document), ['a', 'b'], '节点总结')
    expect(built).not.toBeNull()
    const result = applyMindMapCommand(document, built!.command)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const outputTopic = result.document.sheets[0].root.children.find(
      (topic) => topic.id === built!.summaryTopicId
    )
    expect(outputTopic).toMatchObject({
      id: built!.summaryTopicId,
      title: '节点总结',
      children: []
    })
  })

  it('creates a topic and brace whose inverse removes both', () => {
    const document = makeDocument()
    const built = buildAddSummaryCommand(sheetOf(document), ['a', 'b'])
    expect(built).not.toBeNull()
    const result = applyMindMapCommand(document, built!.command)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const inverse = applyMindMapCommand(result.document, result.inverse)
    expect(inverse.ok).toBe(true)
    if (!inverse.ok) return
    expect(inverse.document.sheets[0].elements).toHaveLength(0)
    expect(inverse.document.sheets[0].root.children.map((topic) => topic.id)).toEqual(['a', 'b', 'c'])
  })

  it('duplicates the output as a normal topic without a dangling brace', () => {
    const document = makeDocument()
    const built = buildAddSummaryCommand(sheetOf(document), ['a', 'b'], '节点总结')
    expect(built).not.toBeNull()
    const created = applyMindMapCommand(document, built!.command)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const duplicate = buildDuplicateCommand(created.document, 'sheet-1', built!.summaryTopicId)
    expect(duplicate).not.toBeNull()
    const duplicated = applyMindMapCommand(created.document, duplicate!.command)
    expect(duplicated.ok).toBe(true)
    if (!duplicated.ok) return
    expect(duplicated.document.sheets[0].elements).toHaveLength(1)
    expect(duplicated.document.sheets[0].root.children).toContainEqual(expect.objectContaining({
      id: duplicate!.pastedRootId,
      title: '节点总结',
      children: []
    }))
  })

  it('removes the linked output topic when the whole summarized range is deleted together', () => {
    const document = makeDocument()
    const built = buildAddSummaryCommand(sheetOf(document), ['a', 'b'], '节点总结')
    expect(built).not.toBeNull()
    const created = applyMindMapCommand(document, built!.command)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const remove = buildRemoveTopicsCommand(created.document.sheets[0], ['a', 'b'])
    expect(remove).not.toBeNull()
    const deleted = applyMindMapCommand(created.document, remove!)
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.document.sheets[0].elements).toHaveLength(0)
    expect(deleted.document.sheets[0].root.children.map((topic) => topic.id)).toEqual(['c'])

    const restored = applyMindMapCommand(deleted.document, deleted.inverse)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.document).toEqual(created.document)
  })

  it('moves the output beneath the sole remaining source topic', () => {
    const document = makeDocument()
    const built = buildAddSummaryCommand(sheetOf(document), ['a', 'b'], '节点总结')
    expect(built).not.toBeNull()
    const created = applyMindMapCommand(document, built!.command)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // The single-node command follows the same lifecycle as box-select delete.
    const remove = buildRemoveCommand(created.document.sheets[0], 'a')
    expect(remove).not.toBeNull()
    const deleted = applyMindMapCommand(created.document, remove!)
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.document.sheets[0].elements).toHaveLength(0)
    expect(deleted.document.sheets[0].root.children.map((topic) => topic.id)).toEqual(['b', 'c'])
    expect(deleted.document.sheets[0].root.children[0].children).toContainEqual(expect.objectContaining({
      id: built!.summaryTopicId,
      title: '节点总结'
    }))

    const restored = applyMindMapCommand(deleted.document, deleted.inverse)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.document).toEqual(created.document)
  })

  it('keeps retargeting the brace until a sequential deletion leaves one source', () => {
    const document = makeDocument()
    const built = buildAddSummaryCommand(sheetOf(document), ['a', 'b', 'c'], '节点总结')
    expect(built).not.toBeNull()
    const created = applyMindMapCommand(document, built!.command)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const firstRemove = buildRemoveCommand(created.document.sheets[0], 'c')
    expect(firstRemove).not.toBeNull()
    const afterFirstRemove = applyMindMapCommand(created.document, firstRemove!)
    expect(afterFirstRemove.ok).toBe(true)
    if (!afterFirstRemove.ok) return
    const retainedSummary = afterFirstRemove.document.sheets[0].elements[0]
    expect(retainedSummary).toMatchObject({ type: 'summary', from: 'a', to: 'b' })

    const secondRemove = buildRemoveCommand(afterFirstRemove.document.sheets[0], 'a')
    expect(secondRemove).not.toBeNull()
    const afterSecondRemove = applyMindMapCommand(afterFirstRemove.document, secondRemove!)
    expect(afterSecondRemove.ok).toBe(true)
    if (!afterSecondRemove.ok) return
    expect(afterSecondRemove.document.sheets[0].elements).toHaveLength(0)
    expect(afterSecondRemove.document.sheets[0].root.children.map((topic) => topic.id)).toEqual(['b'])
    expect(afterSecondRemove.document.sheets[0].root.children[0].children).toContainEqual(expect.objectContaining({
      id: built!.summaryTopicId,
      title: '节点总结'
    }))
  })

  it('removes the brace when its ordinary output topic is deleted', () => {
    const document = makeDocument()
    const built = buildAddSummaryCommand(sheetOf(document), ['a', 'b'], '节点总结')
    expect(built).not.toBeNull()
    const created = applyMindMapCommand(document, built!.command)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const remove = buildRemoveCommand(created.document.sheets[0], built!.summaryTopicId)
    expect(remove).not.toBeNull()
    const deleted = applyMindMapCommand(created.document, remove!)
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.document.sheets[0].elements).toHaveLength(0)
    expect(deleted.document.sheets[0].root.children.map((topic) => topic.id)).toEqual(['a', 'b', 'c'])

    const restored = applyMindMapCommand(deleted.document, deleted.inverse)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.document).toEqual(created.document)
  })
})
