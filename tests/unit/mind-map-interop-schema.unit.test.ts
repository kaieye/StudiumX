import { describe, expect, it } from 'vitest'

import { mindMapDocumentV2Schema } from '../../src/shared/mindmap/domain/schema'

const baseDocument = {
  schemaVersion: 2,
  id: 'doc-1',
  revision: 1,
  title: 'Migration metadata',
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  theme: { id: 'default' },
  sheets: [],
  assets: []
} as const

describe('mind map migration metadata schema', () => {
  it('accepts the native schema-version migration marker', () => {
    const result = mindMapDocumentV2Schema.safeParse({
      ...baseDocument,
      interop: { migratedFrom: { schemaVersion: 1 } }
    })

    expect(result.success).toBe(true)
  })

  it('does not retain unknown foreign metadata fields', () => {
    const result = mindMapDocumentV2Schema.safeParse({
      ...baseDocument,
      interop: { external: { extension: 'ignored' } }
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.interop).toEqual({})
  })
})
