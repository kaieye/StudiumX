import { describe, expect, it } from 'vitest'

import { migrateV1ToV2 } from '../../src/shared/mindmap/migrations/v1-to-v2'
import { convertV2ToV1 } from '../../src/shared/mindmap/v2-to-v1'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-09T00:00:00.000Z'

function documentV2(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-v2',
    revision: 7,
    title: 'Study map',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'dark', background: '#111827' },
    assets: [{ id: 'asset-1', fileName: 'diagram.png', mimeType: 'image/png' }],
    interop: { migratedFrom: { schemaVersion: 1 } },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Main sheet',
        layout: { structureClass: 'org.xmind.ui.logic.balanced', compact: true },
        viewport: { x: 10, y: 20, zoom: 1.5 },
        elements: [
          {
            id: 'relationship-1',
            type: 'relationship',
            from: 'root-1',
            to: 'child-1',
            label: 'depends on'
          }
        ],
        root: {
          id: 'root-1',
          title: 'Root',
          note: 'Keep this note',
          collapsed: true,
          labels: ['exam'],
          manualPosition: { x: 100, y: 200 },
          children: [
            {
              id: 'child-1',
              title: 'Child',
              style: { structureClass: 'org.xmind.ui.logic.left' },
              planning: { taskStatus: 'done' },
              children: []
            }
          ]
        }
      },
      {
        id: 'sheet-2',
        title: 'Empty sheet',
        layout: { structureClass: 'org.xmind.ui.logic.down' },
        elements: [],
        root: { id: 'root-2', title: 'Second root', children: [] }
      }
    ]
  }
}

describe('convertV2ToV1', () => {
  it('projects every sheet and preserves v1-compatible topic fields', () => {
    expect(convertV2ToV1(documentV2())).toEqual({
      schemaVersion: 1,
      id: 'doc-v2',
      title: 'Study map',
      createdAt: NOW,
      updatedAt: NOW,
      sheets: [
        {
          id: 'sheet-1',
          title: 'Main sheet',
          structureClass: 'org.xmind.ui.logic.balanced',
          relationships: [
            {
              id: 'relationship-1',
              from: 'root-1',
              to: 'child-1',
              label: 'depends on'
            }
          ],
          root: {
            id: 'root-1',
            title: 'Root',
            note: 'Keep this note',
            collapsed: true,
            children: [
              {
                id: 'child-1',
                title: 'Child',
                structureClass: 'org.xmind.ui.logic.left',
                children: []
              }
            ]
          }
        },
        {
          id: 'sheet-2',
          title: 'Empty sheet',
          structureClass: 'org.xmind.ui.logic.down',
          root: { id: 'root-2', title: 'Second root', children: [] }
        }
      ]
    })
  })

  it('drops v2-only fields instead of leaking them into the v1 shape', () => {
    const projected = convertV2ToV1(documentV2())
    const firstTopic = projected.sheets[0].root

    expect(projected).not.toHaveProperty('revision')
    expect(projected).not.toHaveProperty('theme')
    expect(projected).not.toHaveProperty('assets')
    expect(projected.sheets[0]).not.toHaveProperty('elements')
    expect(projected.sheets[0]).not.toHaveProperty('viewport')
    expect(firstTopic).not.toHaveProperty('labels')
    expect(firstTopic).not.toHaveProperty('manualPosition')
    expect(firstTopic.children[0]).not.toHaveProperty('planning')
  })

  it('does not mutate the v2 document while projecting it', () => {
    const source = documentV2()
    const before = structuredClone(source)

    convertV2ToV1(source)

    expect(source).toEqual(before)
  })
})

describe('migrateV1ToV2', () => {
  it('migrates a v1 projection idempotently without mutating the source', () => {
    const legacy = convertV2ToV1(documentV2())
    const before = structuredClone(legacy)

    const migrated = migrateV1ToV2(legacy)

    expect(migrated).toMatchObject({ ok: true })
    expect(legacy).toEqual(before)
    if (!migrated.ok) return

    expect(migrated.value).toMatchObject({
      schemaVersion: 2,
      revision: 1,
      theme: { id: 'studiumx-default', name: 'StudiumX Default' },
      assets: [],
      interop: { migratedFrom: { schemaVersion: 1 } }
    })
    expect(migrated.value.sheets[0]).toMatchObject({
      id: 'sheet-1',
      layout: { structureClass: 'org.xmind.ui.logic.balanced' },
      elements: [
        {
          id: 'relationship-1',
          type: 'relationship',
          from: 'root-1',
          to: 'child-1',
          label: 'depends on'
        }
      ],
      root: {
        id: 'root-1',
        collapsed: true,
        children: [
          {
            id: 'child-1',
            style: { structureClass: 'org.xmind.ui.logic.left' }
          }
        ]
      }
    })

    expect(migrateV1ToV2(migrated.value)).toEqual(migrated)
  })

  it('fails closed for malformed and unsupported schema versions', () => {
    expect(migrateV1ToV2(null)).toMatchObject({
      ok: false,
      error: { code: 'NOT_A_DOCUMENT' }
    })
    expect(migrateV1ToV2({ schemaVersion: 3 })).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_SCHEMA_VERSION' }
    })
    expect(migrateV1ToV2({ schemaVersion: 2 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_V2_DOCUMENT' }
    })
  })
})
