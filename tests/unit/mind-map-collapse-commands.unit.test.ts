import { describe, expect, it } from 'vitest'

import { applyMindMapCommand } from '../../src/shared/mindmap/commands/mind-map-reducer'
import type { MindMapCommand } from '../../src/shared/mindmap/commands/mind-map-command-types'
import type { MindMapDocumentV2, MindMapTopicV2 } from '../../src/shared/mindmap/domain/types'
import {
  buildCollapseLastLevelCommand,
  buildExpandNextLevelCommand,
  buildSetSiblingTopicsCollapsedCommand,
  buildSetTopicChildrenCollapsedCommand
} from '../../src/renderer/src/views/mindmap/mind-map-commands'

const NOW = '2026-08-15T00:00:00.000Z'

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-collapse-levels',
    revision: 1,
    title: 'Collapse levels',
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
            {
              id: 'a',
              title: 'A',
              children: [
                {
                  id: 'a1',
                  title: 'A1',
                  children: [{ id: 'a2', title: 'A2', children: [] }]
                }
              ]
            },
            {
              id: 'b',
              title: 'B',
              children: [{ id: 'b1', title: 'B1', children: [] }]
            }
          ]
        },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

function apply(document: MindMapDocumentV2, command: MindMapCommand | null): MindMapDocumentV2 {
  expect(command).not.toBeNull()
  const result = applyMindMapCommand(document, command!)
  if (!result.ok) throw new Error(result.error.message)
  return result.document
}

function collapsedIds(root: MindMapTopicV2): string[] {
  const ids: string[] = []
  const visit = (topic: MindMapTopicV2): void => {
    if (topic.collapsed === true) ids.push(topic.id)
    topic.children.forEach(visit)
  }
  visit(root)
  return ids.sort()
}

describe('mind-map recursive child visibility commands', () => {
  it('collapses the deepest visible branch layer and expands one visible frontier per command', () => {
    let document = makeDocument()

    document = apply(document, buildCollapseLastLevelCommand(document.sheets[0]!))
    expect(collapsedIds(document.sheets[0]!.root)).toEqual(['a1'])

    document = apply(document, buildCollapseLastLevelCommand(document.sheets[0]!))
    expect(collapsedIds(document.sheets[0]!.root)).toEqual(['a', 'a1', 'b'])

    document = apply(document, buildCollapseLastLevelCommand(document.sheets[0]!))
    expect(collapsedIds(document.sheets[0]!.root)).toEqual(['a', 'a1', 'b', 'root'])
    expect(buildCollapseLastLevelCommand(document.sheets[0]!)).toBeNull()

    document = apply(document, buildExpandNextLevelCommand(document.sheets[0]!))
    expect(collapsedIds(document.sheets[0]!.root)).toEqual(['a', 'a1', 'b'])

    document = apply(document, buildExpandNextLevelCommand(document.sheets[0]!))
    expect(collapsedIds(document.sheets[0]!.root)).toEqual(['a1'])

    document = apply(document, buildExpandNextLevelCommand(document.sheets[0]!))
    expect(collapsedIds(document.sheets[0]!.root)).toEqual([])
    expect(buildExpandNextLevelCommand(document.sheets[0]!)).toBeNull()
  })

  it('sets current and same-level branch visibility without marking leaf topics collapsed', () => {
    let document = makeDocument()

    document = apply(
      document,
      buildSetTopicChildrenCollapsedCommand(document.sheets[0]!, 'a', true)
    )
    expect(collapsedIds(document.sheets[0]!.root)).toEqual(['a'])

    document = apply(
      document,
      buildSetSiblingTopicsCollapsedCommand(document.sheets[0]!, 'a', true)
    )
    expect(collapsedIds(document.sheets[0]!.root)).toEqual(['a', 'b'])
    expect(document.sheets[0]!.root.children[1]!.children[0]!.collapsed).toBeUndefined()
  })
})
