import { describe, expect, it } from 'vitest'

import { mindMapDocumentV2Schema } from '../../src/shared/mindmap/domain/schema'

const baseDocument = {
  schemaVersion: 2,
  id: 'doc-1',
  revision: 1,
  title: 'Interop',
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  theme: { id: 'default' },
  sheets: [],
  assets: []
} as const

describe('mind map XMind extension schema', () => {
  it('accepts bounded JSON-only extension metadata', () => {
    const result = mindMapDocumentV2Schema.safeParse({
      ...baseDocument,
      interop: {
        xmind: {
          extensions: {
            vendor: 'xmind',
            flags: [true, false],
            nested: { count: 2, empty: null }
          }
        }
      }
    })

    expect(result.success).toBe(true)
  })

  it.each([
    ['functions', { execute: () => 'not JSON' }],
    ['class instances', { date: new Date('2026-08-09T00:00:00.000Z') }],
    ['non-finite numbers', { value: Number.NaN }]
  ])('rejects %s in extension metadata', (_label, extensions) => {
    const result = mindMapDocumentV2Schema.safeParse({
      ...baseDocument,
      interop: { xmind: { extensions } }
    })

    expect(result.success).toBe(false)
  })

  it('rejects extension metadata above the serialized byte budget', () => {
    const result = mindMapDocumentV2Schema.safeParse({
      ...baseDocument,
      interop: {
        xmind: { extensions: { payload: 'x'.repeat(64 * 1024) } }
      }
    })

    expect(result.success).toBe(false)
  })

  it('rejects extension metadata with excessive object fan-out', () => {
    const extensions = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [`key-${index}`, index])
    )
    const result = mindMapDocumentV2Schema.safeParse({
      ...baseDocument,
      interop: { xmind: { extensions } }
    })

    expect(result.success).toBe(false)
  })
})
