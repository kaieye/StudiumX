import { describe, expect, it } from 'vitest'

import {
  mindMapDocumentSchema,
  mindMapNodeSchema,
  mindMapSheetSchema
} from '../../src/shared/mindmap/mind-map-schema'
import type { MindMapDocument } from '../../src/shared/mindmap/mind-map-types'
import { MIND_MAP_DOCUMENT_SCHEMA_VERSION } from '../../src/shared/mindmap/mind-map-types'

function validDocument(): MindMapDocument {
  return {
    schemaVersion: 1,
    id: 'doc-1',
    title: 'Study Plan',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        structureClass: 'org.xmind.ui.logic.right',
        root: {
          id: 'root-1',
          title: 'Chemistry',
          children: [
            {
              id: 'child-1',
              title: 'Acids',
              children: [
                {
                  id: 'grandchild-1',
                  title: 'pH',
                  children: []
                }
              ]
            }
          ]
        }
      }
    ]
  }
}

describe('mindMapNodesSchema', () => {
  it('accepts a valid nested node', () => {
    const result = mindMapNodeSchema.safeParse({
      id: 'n1',
      title: 'Root',
      children: [
        { id: 'n2', title: 'Child', children: [] }
      ]
    })
    expect(result.success).toBe(true)
  })

  it('defaults missing children to []', () => {
    const result = mindMapNodeSchema.safeParse({ id: 'n1', title: 'Leaf' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.children).toEqual([])
  })

  it('rejects invalid structureClass', () => {
    const result = mindMapNodeSchema.safeParse({
      id: 'n1',
      title: 'Root',
      structureClass: 'org.xmind.ui.logic.bogus',
      children: []
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty id', () => {
    const result = mindMapNodeSchema.safeParse({ id: '', title: 'x', children: [] })
    expect(result.success).toBe(false)
  })

  it('validates arbitrary-depth recursive nesting', () => {
    const deep = { id: 'd0', title: '0', children: [] as MindMapNodeLike[] }
    let cursor = deep
    for (let i = 1; i <= 50; i += 1) {
      const next = { id: `d${i}`, title: String(i), children: [] as MindMapNodeLike[] }
      cursor.children = [next]
      cursor = next
    }
    const result = mindMapNodeSchema.safeParse(deep)
    expect(result.success).toBe(true)
  })
})

type MindMapNodeLike = { id: string; title: string; children: MindMapNodeLike[] }

describe('mindMapSheetSchema', () => {
  it('defaults missing sheet structureClass to right', () => {
    const result = mindMapSheetSchema.safeParse({
      id: 'sheet-1',
      title: 'Sheet 1',
      root: { id: 'root-1', title: 'Root', children: [] }
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.structureClass).toBe('org.xmind.ui.logic.right')
    }
  })

  it('rejects a missing root', () => {
    const result = mindMapSheetSchema.safeParse({
      id: 'sheet-1',
      title: 'Sheet 1',
      structureClass: 'org.xmind.ui.logic.right'
    })
    expect(result.success).toBe(false)
  })
})

describe('mindMapDocumentSchema', () => {
  it('accepts a valid document', () => {
    const result = mindMapDocumentSchema.safeParse(validDocument())
    expect(result.success).toBe(true)
  })

  it('rejects an invalid schemaVersion', () => {
    const doc = validDocument()
    const result = mindMapDocumentSchema.safeParse({
      ...doc,
      schemaVersion: 99
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-literal schemaVersion of the wrong type', () => {
    const doc = validDocument()
    const result = mindMapDocumentSchema.safeParse({
      ...doc,
      schemaVersion: '1'
    })
    expect(result.success).toBe(false)
  })

  it('defaults missing sheets to []', () => {
    const doc = validDocument()
    const result = mindMapDocumentSchema.safeParse({ ...doc, sheets: undefined })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.sheets).toEqual([])
  })

  it('matches the exported schema version constant', () => {
    expect(MIND_MAP_DOCUMENT_SCHEMA_VERSION).toBe(1)
    const result = mindMapDocumentSchema.safeParse(validDocument())
    if (result.success) expect(result.data.schemaVersion).toBe(1)
  })
})