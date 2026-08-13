import { describe, expect, it } from 'vitest'

import {
  mindMapDocumentV2Schema,
  mindMapElementStyleSchema,
  mindMapLayoutSettingsSchema,
  mindMapTopicStyleOverrideSchema,
  mindMapThemeSchema
} from '../../src/shared/mindmap/domain/schema'
import {
  collectTopicIds,
  validateMindMapDocumentV2,
  validateMindMapSheetV2
} from '../../src/shared/mindmap/domain/invariants'
import {
  copySheet,
  deleteSheet,
  MindMapSheetOperationError,
  renameSheet,
  reorderSheet
} from '../../src/shared/mindmap/domain/sheet-operations'
import type {
  MindMapDocumentV2,
  MindMapElement,
  MindMapElementStyle,
  MindMapLayoutSettings,
  MindMapSheetV2,
  MindMapTheme,
  MindMapTopicStyleOverride,
  MindMapTopicV2
} from '../../src/shared/mindmap/domain/types'
import { migrateV1ToV2 } from '../../src/shared/mindmap/migrations/v1-to-v2'
import type { MindMapDocument } from '../../src/shared/mindmap/mind-map-types'
import {
  mindMapElementStyleProposalSchema,
  mindMapLayoutProposalSchema,
  mindMapThemeProposalSchema,
  mindMapTopicStyleProposalSchema
} from '../../src/shared/mindmap/commands/mind-map-proposal'

const NOW = '2026-08-09T00:00:00.000Z'

function exhaustiveKeys<T>() {
  return <Keys extends readonly (keyof T)[]>(
    ...keys: Keys & ([keyof T] extends [Keys[number]] ? unknown : ['Missing keys', Exclude<keyof T, Keys[number]>])
  ): Keys => keys
}

const mindMapThemeFields = exhaustiveKeys<MindMapTheme>()(
  'id',
  'name',
  'background',
  'branchColors',
  'textColor',
  'lineColor',
  'fontFamily',
  'shape',
  'rainbowBranches',
  'colorSchemeId',
  'topicStyles'
)

const mindMapLayoutFields = exhaustiveKeys<MindMapLayoutSettings>()(
  'structureClass',
  'direction',
  'compact',
  'spacing',
  'lineStyle',
  'lineWidthScale',
  'linePattern',
  'tapered'
)

const mindMapTopicStyleFields = exhaustiveKeys<MindMapTopicStyleOverride>()(
  'fill',
  'stroke',
  'borderStyle',
  'borderWidth',
  'textColor',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textDecoration',
  'textTransform',
  'textAlign',
  'shape',
  'fillPattern',
  'widthMode',
  'width',
  'structureClass'
)

const mindMapElementStyleFields = exhaustiveKeys<MindMapElementStyle>()(
  'stroke',
  'strokeWidth',
  'fill',
  'textColor',
  'fontFamily',
  'fontSize',
  'dashed',
  'lineShape',
  'beginArrow',
  'endArrow',
  'linePattern',
  'outlineShape'
)

function topic(
  id: string,
  title: string,
  children: MindMapTopicV2[] = []
): MindMapTopicV2 {
  return { id, title, children }
}

function element(overrides: Partial<MindMapElement> & { id: string; type: MindMapElement['type'] }): MindMapElement {
  return { label: undefined, style: undefined, ...overrides } as MindMapElement
}

function sheet(
  id: string,
  title: string,
  root: MindMapTopicV2,
  elements: MindMapElement[] = []
): MindMapSheetV2 {
  return {
    id,
    title,
    root,
    elements,
    layout: { structureClass: 'org.xmind.ui.logic.right' }
  }
}

function validDocumentV2(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-2',
    revision: 1,
    title: 'v2 doc',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'default', name: 'Default' },
    sheets: [
      sheet('s1', 'Sheet 1', topic('r1', 'Root', [topic('a1', 'A')]), [
        element({
          id: 'e1',
          type: 'relationship',
          from: 'r1',
          to: 'a1'
        })
      ])
    ],
    assets: []
  }
}

function validDocumentV1(): MindMapDocument {
  return {
    schemaVersion: 1,
    id: 'doc-1',
    title: 'Study Plan',
    createdAt: NOW,
    updatedAt: NOW,
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        structureClass: 'org.xmind.ui.logic.right',
        root: {
          id: 'root-1',
          title: '中心主题',
          note: 'a note',
          collapsed: true,
          structureClass: 'org.xmind.ui.logic.balanced',
          children: [
            {
              id: 'branch-1',
              title: 'Branch 1',
              children: [
                { id: 'leaf-1', title: 'Leaf 1', children: [] }
              ]
            }
          ]
        }
      },
      {
        id: 'sheet-2',
        title: 'Sheet 2',
        structureClass: 'org.xmind.ui.logic.map',
        root: { id: 'root-2', title: 'Second Root', children: [] }
      }
    ]
  }
}

describe('mind-map persisted style field drift detector', () => {
  it('keeps every persisted theme, layout, topic-style, and element-style field in the runtime schema', () => {
    expect(Object.keys(mindMapThemeSchema.shape).sort()).toEqual([...mindMapThemeFields].sort())
    expect(Object.keys(mindMapLayoutSettingsSchema.shape).sort()).toEqual([...mindMapLayoutFields].sort())
    expect(Object.keys(mindMapTopicStyleOverrideSchema.shape).sort()).toEqual([...mindMapTopicStyleFields].sort())
    expect(Object.keys(mindMapElementStyleSchema.shape).sort()).toEqual([...mindMapElementStyleFields].sort())
  })

  it('keeps provider proposal style fields aligned with their persisted counterparts', () => {
    expect(Object.keys(mindMapThemeProposalSchema.shape).sort()).toEqual([...mindMapThemeFields].sort())
    expect(Object.keys(mindMapLayoutProposalSchema.shape).sort()).toEqual([...mindMapLayoutFields].sort())
    expect(Object.keys(mindMapTopicStyleProposalSchema.shape).sort()).toEqual([...mindMapTopicStyleFields].sort())
    expect(Object.keys(mindMapElementStyleProposalSchema.shape).sort()).toEqual([...mindMapElementStyleFields].sort())
  })
})

describe('mind map v2 schemas', () => {
  it('accepts a valid v2 document', () => {
    const result = mindMapDocumentV2Schema.safeParse(validDocumentV2())
    expect(result.success).toBe(true)
  })

  it('validates the fixed width mode contract', () => {
    expect(mindMapTopicStyleOverrideSchema.safeParse({ widthMode: 'fixed', width: 240 }).success).toBe(true)
    expect(mindMapTopicStyleOverrideSchema.safeParse({ widthMode: 'fixed', width: 721 }).success).toBe(false)
  })

  it('accepts a valid v2 document without assets/interop/viewport', () => {
    const doc = validDocumentV2()
    doc.assets = []
    doc.interop = undefined
    doc.sheets[0].viewport = undefined
    const result = mindMapDocumentV2Schema.safeParse({
      ...doc,
      sheets: [
        {
          ...doc.sheets[0],
          viewport: undefined,
          elements: []
        }
      ]
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-v2 schemaVersion', () => {
    const doc = validDocumentV2()
    const result = mindMapDocumentV2Schema.safeParse({
      ...doc,
      schemaVersion: 1
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing revision', () => {
    const doc = validDocumentV2()
    const { revision: _revision, ...withoutRevision } = doc
    const result = mindMapDocumentV2Schema.safeParse(withoutRevision)
    expect(result.success).toBe(false)
  })

  it('rejects an unknown element type', () => {
    const doc = validDocumentV2()
    doc.sheets[0].elements = [
      { id: 'bad', type: 'nonsense' } as unknown as MindMapElement
    ]
    const result = mindMapDocumentV2Schema.safeParse(doc)
    expect(result.success).toBe(false)
  })

  it('rejects an element with an empty node reference', () => {
    const doc = validDocumentV2()
    doc.sheets[0].elements = [
      element({ id: 'e1', type: 'free-topic', topicId: '', position: { x: 0, y: 0 } })
    ]
    const result = mindMapDocumentV2Schema.safeParse(doc)
    expect(result.success).toBe(false)
  })
  it('validates persisted topic font style and decoration as controlled enums', () => {
    const doc = validDocumentV2()
    doc.sheets[0].root.style = {
      fontWeight: '700',
      fontStyle: 'italic',
      textDecoration: 'line-through underline',
      textTransform: 'uppercase',
      textAlign: 'right'
    }
    expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(true)

    doc.sheets[0].root.style = { fontStyle: 'oblique' as 'italic' }
    expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(false)

    doc.sheets[0].root.style = { textDecoration: 'blink' as 'underline' }
    expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(false)

    doc.sheets[0].root.style = { textTransform: 'sentence-case' as 'uppercase' }
    expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(false)

    doc.sheets[0].root.style = { textAlign: 'justify' as 'left' }
    expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(false)
  })

  it('validates persisted topic border style and width as controlled values', () => {
    const doc = validDocumentV2()
    doc.sheets[0].root.style = {
      stroke: '#123456',
      borderStyle: 'hand-drawn-dash',
      borderWidth: 5
    }
    expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(true)

    for (const style of [
      { borderStyle: 'dot' },
      { borderWidth: 0 },
      { borderWidth: 33 },
      { borderWidth: Number.NaN }
    ]) {
      doc.sheets[0].root.style = style as MindMapTopicStyleOverride
      expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(false)
    }
  })

  it('validates topic shape and fill pattern as controlled values', () => {
    const doc = validDocumentV2()
    for (const shape of [
      'rounded-rect', 'rect', 'ellipse', 'diamond', 'underline', 'none',
      'quote', 'callout', 'bracket', 'arrow-right', 'arrow-left',
      'heart', 'cloud', 'star', 'parallelogram', 'hexagon'
    ]) {
      doc.sheets[0].root.style = { shape }
      expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(true)
    }
    for (const fillPattern of ['solid', 'hand-drawn', 'diagonal', 'horizontal']) {
      doc.sheets[0].root.style = { fillPattern }
      expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(true)
    }

    doc.sheets[0].root.style = { shape: 'triangle' }
    expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(false)
    doc.sheets[0].root.style = { fillPattern: 'dots' as 'solid' }
    expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(false)
  })

  it('validates persisted element style line/arrow/pattern/outline enums as controlled values', () => {
    const doc = validDocumentV2()
    for (const lineShape of [
      'curved', 'straight', 'angled', 'zigzag',
      'flexible-curved', 'flexible-angled', 'flexible-zigzag'
    ]) {
      doc.sheets[0].elements = [
        element({
          id: 'shaped', type: 'relationship', from: 'r1', to: 'a1',
          style: { lineShape } as MindMapElementStyle
        })
      ]
      expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(true)
    }
    for (const arrowShape of [
      'none', 'dot', 'triangle', 'spearhead', 'square', 'diamond',
      'herringbone', 'double-arrow', 'anti-triangle', 'attached', 'hook'
    ]) {
      doc.sheets[0].elements = [
        element({
          id: 'arrowed', type: 'relationship', from: 'r1', to: 'a1',
          style: { beginArrow: arrowShape, endArrow: arrowShape } as MindMapElementStyle
        })
      ]
      expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(true)
    }
    for (const linePattern of ['solid', 'dash', 'dot', 'dash-dot', 'dash-dot-dot']) {
      doc.sheets[0].elements = [
        element({
          id: 'patterned', type: 'boundary', topicId: 'a1',
          style: { linePattern } as MindMapElementStyle
        })
      ]
      expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(true)
    }
    for (const outlineShape of [
      'rectangle', 'rounded-rectangle', 'ellipse', 'polygon',
      'scallops', 'waves', 'tension', 'bracket'
    ]) {
      doc.sheets[0].elements = [
        element({
          id: 'outlined', type: 'callout', topicId: 'a1', text: 'note',
          style: { outlineShape } as MindMapElementStyle
        })
      ]
      expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(true)
    }

    for (const style of [
      { lineShape: 'squiggle' },
      { beginArrow: 'arrow' },
      { endArrow: 'circle' },
      { linePattern: 'dashed-triple' },
      { outlineShape: 'star' }
    ]) {
      doc.sheets[0].elements = [
        element({ id: 'bad-enum', type: 'relationship', from: 'r1', to: 'a1', style: style as MindMapElementStyle })
      ]
      expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(false)
    }
  })

  it('validates persisted element style colors, fonts and numeric bounds', () => {
    const doc = validDocumentV2()
    doc.sheets[0].elements = [
      element({
        id: 'styled', type: 'relationship', from: 'root-1', to: 'main-1',
        style: { stroke: '#123456', fill: '#abcdef', textColor: '#334455',
          strokeWidth: 8, fontFamily: 'system-ui, sans-serif', fontSize: 24, dashed: true }
      })
    ]
    expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(true)

    for (const style of [
      { stroke: 'red' }, { fill: '#zzzzzz' }, { textColor: 'rgb(1, 2, 3)' },
      { strokeWidth: 65 }, { fontFamily: '' }, { fontSize: 513 }
    ]) {
      doc.sheets[0].elements = [
        element({ id: 'invalid', type: 'relationship', from: 'root-1', to: 'main-1', style })
      ]
      expect(mindMapDocumentV2Schema.safeParse(doc).success).toBe(false)
    }
  })

})

describe('mind map v2 invariants', () => {
  it('validates a well-formed document', () => {
    expect(validateMindMapDocumentV2(validDocumentV2())).toEqual({ ok: true })
  })

  it('collects every topic id in the tree', () => {
    const tree = topic('r1', 'R', [topic('a1', 'A', [topic('a1a', 'A1')]), topic('b1', 'B')])
    expect(collectTopicIds(sheet('s1', 'S', tree))).toEqual(['r1', 'a1', 'a1a', 'b1'])
  })

  it('reports duplicate sheet ids', () => {
    const doc = validDocumentV2()
    doc.sheets = [doc.sheets[0], { ...doc.sheets[0], title: 'dup' }]
    const result = validateMindMapDocumentV2(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain('DUPLICATE_SHEET_ID')
    }
  })

  it('reports duplicate topic ids within a sheet', () => {
    const doc = validDocumentV2()
    doc.sheets[0].root = topic('r1', 'R', [topic('dup', 'A'), topic('dup', 'B')])
    const result = validateMindMapDocumentV2(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain('DUPLICATE_TOPIC_ID')
    }
  })

  it('reports a topic cycle', () => {
    const cyclic: MindMapTopicV2 = topic('r1', 'R')
    cyclic.children = [cyclic]
    const result = validateMindMapSheetV2(sheet('s1', 'S', cyclic))
    expect(result.map((e) => e.code)).toContain('CYCLE_DETECTED')
  })

  it('rejects element references to missing node ids', () => {
    const doc = validDocumentV2()
    doc.sheets[0].elements = [
      element({ id: 'e1', type: 'relationship', from: 'ghost', to: 'r1' })
    ]
    const result = validateMindMapDocumentV2(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain('ELEMENT_REF_MISSING')
    }
  })

  it('rejects a boundary children list with a missing node id', () => {
    const doc = validDocumentV2()
    doc.sheets[0].elements = [
      element({ id: 'e1', type: 'boundary', topicId: 'r1', children: ['missing'] })
    ]
    const result = validateMindMapDocumentV2(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain('ELEMENT_REF_MISSING')
    }
  })

  it('reports duplicate element ids', () => {
    const doc = validDocumentV2()
    doc.sheets[0].elements = [
      element({ id: 'e1', type: 'relationship', from: 'r1', to: 'a1' }),
      element({ id: 'e1', type: 'relationship', from: 'a1', to: 'r1' })
    ]
    const result = validateMindMapDocumentV2(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain('DUPLICATE_ELEMENT_ID')
    }
  })

  it('reports an invalid revision', () => {
    const doc = validDocumentV2()
    doc.revision = -1
    const result = validateMindMapDocumentV2(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain('INVALID_REVISION')
    }
  })
})

describe('v1 → v2 migration', () => {
  it('migrates a v1 document preserving title/note/collapsed/structure/multi-sheet', () => {
    const result = migrateV1ToV2(validDocumentV1())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const v2 = result.value
    expect(v2.schemaVersion).toBe(2)
    expect(v2.revision).toBe(1)
    expect(v2.id).toBe('doc-1')
    expect(v2.title).toBe('Study Plan')
    expect(v2.createdAt).toBe(NOW)
    expect(v2.updatedAt).toBe(NOW)
    expect(v2.theme.id).toBe('studiumx-default')
    expect(v2.assets).toEqual([])
    expect(v2.interop).toEqual({ migratedFrom: { schemaVersion: 1 } })
    expect(v2.sheets).toHaveLength(2)

    const s1 = v2.sheets[0]
    expect(s1.id).toBe('sheet-1')
    expect(s1.title).toBe('Sheet 1')
    expect(s1.layout.structureClass).toBe('org.xmind.ui.logic.right')
    expect(s1.elements).toEqual([])
    expect(s1.root).toMatchObject({
      id: 'root-1',
      title: '中心主题',
      note: 'a note',
      collapsed: true,
      style: { structureClass: 'org.xmind.ui.logic.balanced' }
    })
    expect(s1.root.children).toHaveLength(1)
    expect(s1.root.children[0]).toMatchObject({
      id: 'branch-1',
      title: 'Branch 1',
      children: [{ id: 'leaf-1', title: 'Leaf 1', children: [] }]
    })

    const s2 = v2.sheets[1]
    expect(s2.layout.structureClass).toBe('org.xmind.ui.logic.map')
    expect(s2.root.id).toBe('root-2')
  })

  it('is idempotent: migrating a v2 document returns it unchanged', () => {
    const once = migrateV1ToV2(validDocumentV1())
    expect(once.ok).toBe(true)
    if (!once.ok) return

    const twice = migrateV1ToV2(once.value)
    expect(twice.ok).toBe(true)
    if (!twice.ok) return
    expect(twice.value).toEqual(once.value)
  })

  it('is deterministic for the same v1 input', () => {
    const a = migrateV1ToV2(validDocumentV1())
    const b = migrateV1ToV2(validDocumentV1())
    expect(a).toEqual(b)
  })

  it('does not mutate the input document', () => {
    const input = validDocumentV1()
    const snapshot = JSON.parse(JSON.stringify(input))
    migrateV1ToV2(input)
    expect(input).toEqual(snapshot)
  })

  it('returns a structured error for an unsupported schema version', () => {
    const result = migrateV1ToV2({ ...validDocumentV1(), schemaVersion: 99 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED_SCHEMA_VERSION')
    }
  })

  it('returns a structured error for a non-document payload', () => {
    const result = migrateV1ToV2(null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_A_DOCUMENT')
    }
  })

  it('returns a structured error for an invalid v1 document', () => {
    const result = migrateV1ToV2({ ...validDocumentV1(), sheets: 'nope' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_V1_DOCUMENT')
    }
  })
})

describe('sheet operations', () => {
  it('renames a sheet immutably', () => {
    const doc = validDocumentV2()
    const renamed = renameSheet(doc, 's1', 'Renamed')
    expect(renamed.sheets[0].title).toBe('Renamed')
    expect(doc.sheets[0].title).toBe('Sheet 1')
  })

  it('rename throws for a missing sheet', () => {
    expect(() => renameSheet(validDocumentV2(), 'missing', 'x')).toThrow(
      MindMapSheetOperationError
    )
  })

  it('deletes a sheet immutably', () => {
    const doc = validDocumentV2()
    doc.sheets.push(sheet('s2', 'Two', topic('r2', 'R2')))
    const deleted = deleteSheet(doc, 's1')
    expect(deleted.sheets.map((s) => s.id)).toEqual(['s2'])
    expect(doc.sheets).toHaveLength(2)
  })

  it('delete throws for a missing sheet', () => {
    expect(() => deleteSheet(validDocumentV2(), 'missing')).toThrow(
      MindMapSheetOperationError
    )
  })

  it('reorders a sheet to a target index', () => {
    const doc = validDocumentV2()
    doc.sheets = [sheet('s1', 'One', topic('r1', 'R1')), sheet('s2', 'Two', topic('r2', 'R2')), sheet('s3', 'Three', topic('r3', 'R3'))]
    const reordered = reorderSheet(doc, 's3', 0)
    expect(reordered.sheets.map((s) => s.id)).toEqual(['s3', 's1', 's2'])
  })

  it('keeps final-index semantics when moving a sheet forward', () => {
    const doc = validDocumentV2()
    doc.sheets = [
      sheet('s1', 'One', topic('r1', 'R1')),
      sheet('s2', 'Two', topic('r2', 'R2')),
      sheet('s3', 'Three', topic('r3', 'R3'))
    ]
    const reordered = reorderSheet(doc, 's1', 2)
    expect(reordered.sheets.map((s) => s.id)).toEqual(['s2', 's3', 's1'])
    expect(doc.sheets.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('reorder throws for an out-of-range index', () => {
    const doc = validDocumentV2()
    expect(() => reorderSheet(doc, 's1', 5)).toThrow(MindMapSheetOperationError)
  })

  it('copies a sheet with deterministic remapped ids and preserves invariants', () => {
    const doc = validDocumentV2()
    doc.sheets[0].root = topic('r1', 'Root', [topic('a1', 'A')])
    doc.sheets[0].elements = [
      element({ id: 'e1', type: 'relationship', from: 'r1', to: 'a1' }),
      element({ id: 'e2', type: 'boundary', topicId: 'r1', children: ['a1'] })
    ]

    const copied = copySheet(doc, 's1')
    expect(copied.sheets).toHaveLength(2)
    expect(copied.sheets[1].id).toBe('s1__copy')
    expect(copied.sheets[1].root.id).toBe('r1__copy')
    expect(copied.sheets[1].root.children[0].id).toBe('a1__copy')
    expect(copied.sheets[1].elements[0]).toMatchObject({
      id: 'e1__copy',
      from: 'r1__copy',
      to: 'a1__copy'
    })
    expect(copied.sheets[1].elements[1]).toMatchObject({
      id: 'e2__copy',
      topicId: 'r1__copy',
      children: ['a1__copy']
    })

    expect(doc.sheets).toHaveLength(1)
    expect(validateMindMapDocumentV2(copied).ok).toBe(true)
  })

  it('copy is deterministic', () => {
    const doc = validDocumentV2()
    expect(copySheet(doc, 's1')).toEqual(copySheet(doc, 's1'))
  })

  it('copy throws for a missing sheet', () => {
    expect(() => copySheet(validDocumentV2(), 'missing')).toThrow(
      MindMapSheetOperationError
    )
  })
})
