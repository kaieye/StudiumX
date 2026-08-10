import { describe, expect, it } from 'vitest'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import {
  applyMindMapProposal,
  parseMindMapProposalJson,
  resolveMindMapProposal,
  type MindMapProposalItem
} from '../../src/shared/mindmap/commands/mind-map-proposal'

const NOW = '2026-08-09T00:00:00.000Z'

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 1,
    title: 'Study map',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: {
          id: 'root-1',
          title: 'Overview',
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

describe('mind-map AI proposal command adapter', () => {
  it('keeps proposal order and applies only explicitly accepted items', () => {
    const items: MindMapProposalItem[] = [
      {
        id: 'rename-a',
        command: {
          type: 'topic.update',
          sheetId: 'sheet-1',
          topicId: 'a',
          patch: { title: 'Accepted A' }
        }
      },
      {
        id: 'add-relationship',
        command: {
          type: 'element.create',
          sheetId: 'sheet-1',
          element: { id: 'relationship-1', type: 'relationship', from: 'a', to: 'b' }
        }
      },
      {
        id: 'rename-b',
        command: {
          type: 'topic.update',
          sheetId: 'sheet-1',
          topicId: 'b',
          patch: { title: 'Accepted B' }
        }
      }
    ]

    const resolved = resolveMindMapProposal(items, {
      'rename-a': 'accept',
      'add-relationship': 'reject',
      'rename-b': 'accept'
    })

    expect(resolved.acceptedIds).toEqual(['rename-a', 'rename-b'])
    expect(resolved.rejectedIds).toEqual(['add-relationship'])
    expect(resolved.command).toEqual({
      type: 'transaction',
      commands: [items[0]!.command, items[2]!.command]
    })

    const result = applyMindMapProposal(makeDocument(), items, {
      'rename-a': 'accept',
      'add-relationship': 'reject',
      'rename-b': 'accept'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.sheets[0]!.root.children.map((node) => node.title)).toEqual([
      'Accepted A',
      'Accepted B'
    ])
    expect(result.document.sheets[0]!.elements).toEqual([])

    const undone = result.inverse === null
      ? null
      : applyMindMapProposal(result.document, [{ id: 'undo', command: result.inverse }], { undo: 'accept' })
    expect(undone?.ok).toBe(true)
    if (undone?.ok) expect(undone.document).toEqual(makeDocument())
  })

  it('fails closed for unreviewed items and treats an all-rejected review as a no-op', () => {
    const items: MindMapProposalItem[] = [
      {
        id: 'rename-a',
        command: {
          type: 'topic.update',
          sheetId: 'sheet-1',
          topicId: 'a',
          patch: { title: 'Never applied without review' }
        }
      }
    ]
    const document = makeDocument()
    const result = applyMindMapProposal(document, items, {})

    expect(result).toEqual({
      ok: true,
      document,
      inverse: null,
      command: null,
      acceptedIds: [],
      rejectedIds: ['rename-a']
    })
  })

  it('does not evaluate rejected commands and keeps accepted commands atomic', () => {
    const document = makeDocument()
    const rejectedInvalid: MindMapProposalItem = {
      id: 'stale-delete',
      command: {
        type: 'topic.remove',
        sheetId: 'sheet-1',
        topicId: 'no-longer-exists'
      }
    }
    const accepted: MindMapProposalItem = {
      id: 'rename-a',
      command: {
        type: 'topic.update',
        sheetId: 'sheet-1',
        topicId: 'a',
        patch: { title: 'Accepted' }
      }
    }

    const subset = applyMindMapProposal(document, [rejectedInvalid, accepted], {
      'stale-delete': 'reject',
      'rename-a': 'accept'
    })
    expect(subset.ok).toBe(true)
    if (subset.ok) expect(subset.document.sheets[0]!.root.children[0]!.title).toBe('Accepted')

    const atomicFailure = applyMindMapProposal(document, [accepted, rejectedInvalid], {
      'rename-a': 'accept',
      'stale-delete': 'accept'
    })
    expect(atomicFailure.ok).toBe(false)
    expect(document.sheets[0]!.root.children[0]!.title).toBe('A')
  })

  it('rejects duplicate proposal ids before building a transaction', () => {
    const item: MindMapProposalItem = {
      id: 'same',
      command: {
        type: 'topic.update',
        sheetId: 'sheet-1',
        topicId: 'a',
        patch: { title: 'A2' }
      }
    }

    expect(() => resolveMindMapProposal([item, item], { same: 'accept' })).toThrow(
      'Duplicate mind-map proposal item id "same"'
    )
  })
})


describe('mind-map provider proposal parser', () => {
  function validProposal() {
    return {
      schemaVersion: 1,
      proposalId: 'proposal-1',
      scope: 'selection',
      items: [
        {
          id: 'rename-a',
          command: {
            type: 'topic.update',
            sheetId: 'sheet-1',
            topicId: 'a',
            patch: { title: 'Accepted A' }
          }
        }
      ]
    }
  }

  it('parses a strict proposal envelope and preserves commands for review', () => {
    const value = validProposal()
    const result = parseMindMapProposalJson(JSON.stringify(value))

    expect(result).toEqual({ ok: true, proposal: value })
  })

  it('accepts provider JSON wrapped in json or bare markdown fences', () => {
    const serialized = JSON.stringify(validProposal())
    expect(parseMindMapProposalJson('```json\n' + serialized + '\n```').ok).toBe(true)
    expect(parseMindMapProposalJson('```\n' + serialized + '\n```').ok).toBe(true)
  })

  it.each([
    ['root', { unexpected: true }],
    ['item', { itemUnexpected: true }],
    ['command', { commandUnexpected: true }],
    ['nested patch', { patchUnexpected: true }]
  ])('rejects unknown %s fields instead of stripping them', (_label, extra) => {
    const value = validProposal() as {
      schemaVersion: number
      proposalId: string
      scope: string
      items: Array<{
        id: string
        command: { type: string; sheetId: string; topicId: string; patch: Record<string, unknown> }
      }>
    }
    if (_label === 'root') Object.assign(value, extra)
    if (_label === 'item') Object.assign(value.items[0]!, extra)
    if (_label === 'command') Object.assign(value.items[0]!.command, extra)
    if (_label === 'nested patch') Object.assign(value.items[0]!.command.patch, extra)

    const result = parseMindMapProposalJson(JSON.stringify(value))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('schema_invalid')
  })

  it('rejects unsupported scopes and malformed command values fail closed', () => {
    const invalidScope = { ...validProposal(), scope: 'workspace' }
    expect(parseMindMapProposalJson(JSON.stringify(invalidScope)).ok).toBe(false)

    const emptyCommand = {
      ...validProposal(),
      items: [{ id: 'empty', command: {} }]
    }
    expect(parseMindMapProposalJson(JSON.stringify(emptyCommand)).ok).toBe(false)

    const emptyTransaction = {
      ...validProposal(),
      items: [{ id: 'transaction', command: { type: 'transaction', commands: [] } }]
    }
    expect(parseMindMapProposalJson(JSON.stringify(emptyTransaction)).ok).toBe(false)

    const emptySheetCreate = {
      ...validProposal(),
      items: [{ id: 'sheet', command: { type: 'sheet.create' } }]
    }
    expect(parseMindMapProposalJson(JSON.stringify(emptySheetCreate)).ok).toBe(false)
  })

  it('rejects empty proposals, blank ids, duplicate ids, and invalid JSON', () => {
    expect(
      parseMindMapProposalJson(JSON.stringify({ ...validProposal(), items: [] })).ok
    ).toBe(false)
    expect(
      parseMindMapProposalJson(JSON.stringify({ ...validProposal(), proposalId: '   ' })).ok
    ).toBe(false)
    expect(
      parseMindMapProposalJson(
        JSON.stringify({
          ...validProposal(),
          items: [validProposal().items[0], { ...validProposal().items[0], id: 'rename-a' }]
        })
      ).ok
    ).toBe(false)
    expect(parseMindMapProposalJson('{not-json}')).toEqual({
      ok: false,
      code: 'json_parse',
      message: 'mind-map proposal is not valid JSON'
    })
  })
})
