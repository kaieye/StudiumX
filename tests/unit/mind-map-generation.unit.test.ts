import { describe, expect, it } from 'vitest'

import {
  MindMapGenerationError,
  parseMindMapOutput
} from '../../src/main/mindmap/mind-map-generation'
import type { MindMapDocument } from '../../src/shared/mindmap/mind-map-types'

function validRawDocument(): MindMapDocument {
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
                { id: 'grandchild-1', title: 'pH', children: [] }
              ]
            }
          ]
        }
      }
    ]
  }
}

describe('parseMindMapOutput', () => {
  it('parses a valid document from raw JSON', () => {
    const doc = parseMindMapOutput(JSON.stringify(validRawDocument()))
    expect(doc).toEqual(validRawDocument())
  })

  it('parses JSON wrapped in a ```json fence', () => {
    const fenced = '```json\n' + JSON.stringify(validRawDocument()) + '\n```'
    const doc = parseMindMapOutput(fenced)
    expect(doc).toEqual(validRawDocument())
  })

  it('parses JSON wrapped in a bare ``` fence', () => {
    const fenced = '```\n' + JSON.stringify(validRawDocument()) + '\n```'
    const doc = parseMindMapOutput(fenced)
    expect(doc).toEqual(validRawDocument())
  })

  it('throws invalid_output on non-JSON text', () => {
    expect(() => parseMindMapOutput('this is not json')).toThrow(MindMapGenerationError)
    try {
      parseMindMapOutput('not json')
    } catch (error) {
      expect(error).toBeInstanceOf(MindMapGenerationError)
      expect((error as MindMapGenerationError).kind).toBe('invalid_output')
    }
  })

  it('throws invalid_output on invalid JSON inside a fence', () => {
    try {
      parseMindMapOutput('```json\n{"sheets": [}\n```')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MindMapGenerationError)
      expect((error as MindMapGenerationError).kind).toBe('invalid_output')
    }
  })

  it('throws invalid_output when schemaVersion is wrong', () => {
    const doc = validRawDocument()
    const bad = { ...doc, schemaVersion: 99 }
    try {
      parseMindMapOutput(JSON.stringify(bad))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MindMapGenerationError)
      expect((error as MindMapGenerationError).kind).toBe('invalid_output')
    }
  })

  it('throws invalid_output when sheets is not an array', () => {
    const doc = validRawDocument()
    const bad = { ...doc, sheets: 'not-an-array' as unknown }
    try {
      parseMindMapOutput(JSON.stringify(bad))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MindMapGenerationError)
      expect((error as MindMapGenerationError).kind).toBe('invalid_output')
    }
  })

  it('throws invalid_output when a sheet lacks a root', () => {
    const doc = validRawDocument()
    const bad = {
      ...doc,
      sheets: [{ id: 's1', title: 'S', structureClass: 'org.xmind.ui.logic.right' }]
    }
    try {
      parseMindMapOutput(JSON.stringify(bad))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MindMapGenerationError)
      expect((error as MindMapGenerationError).kind).toBe('invalid_output')
    }
  })

  it('accepts a minimal empty document', () => {
    const empty = {
      schemaVersion: 1,
      id: 'doc-empty',
      title: '',
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
      sheets: []
    }
    const doc = parseMindMapOutput(JSON.stringify(empty))
    expect(doc.sheets).toEqual([])
  })
})