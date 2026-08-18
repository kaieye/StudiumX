import { describe, expect, it } from 'vitest'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import {
  effectiveDocumentFontStack,
  resolveDocumentDegradations,
  resolveSelectedTopicFontProvenance,
  resolveSheetDegradations,
  resolveTopicFontProvenance
} from '../../src/renderer/src/views/mindmap/mind-map-font-provenance'

const THEME_FONT = 'Inter, system-ui, sans-serif'
const LAYER_FONT = 'Arial, Helvetica, sans-serif'
const LOCAL_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

describe('mind-map font provenance', () => {
  it('reports the exact local > document > theme-layer > app fallback precedence used by the canvas', () => {
    const theme = {
      id: 'test',
      fontFamily: THEME_FONT,
      topicStyles: { central: { fontFamily: LAYER_FONT } }
    }

    expect(resolveTopicFontProvenance({ fontFamily: LOCAL_FONT }, theme, 0)).toMatchObject({
      source: 'local', fontFamily: LOCAL_FONT, mayFallback: false
    })
    expect(resolveTopicFontProvenance(undefined, theme, 0)).toMatchObject({
      source: 'document', fontFamily: THEME_FONT, mayFallback: false
    })
    expect(resolveTopicFontProvenance(undefined, { ...theme, fontFamily: undefined }, 0)).toMatchObject({
      source: 'theme-layer', fontFamily: LAYER_FONT, mayFallback: false
    })
    expect(resolveTopicFontProvenance(undefined, { id: 'test' }, 0)).toEqual({
      source: 'app-fallback', mayFallback: false
    })
  })

  it('does not pretend to know installed fonts, but warns for unmanaged imported/custom stacks', () => {
    const importedFont = 'Imported native Font, sans-serif'
    expect(resolveTopicFontProvenance({ fontFamily: importedFont }, { id: 'test' }, 0)).toEqual({
      source: 'local', fontFamily: importedFont, mayFallback: true
    })
  })

  it('keeps multi-selection provenance mixed instead of reporting the primary topic source', () => {
    const resolved = resolveSelectedTopicFontProvenance([
      { nodeStyle: { fontFamily: LOCAL_FONT }, depth: 0 },
      { nodeStyle: undefined, depth: 1 }
    ], { id: 'test', fontFamily: THEME_FONT })

    expect(resolved).toEqual({ source: 'mixed', mayFallback: false })
  })

  it('resolves the effective document font stack without claiming OS detection', () => {
    expect(effectiveDocumentFontStack({ id: 'test' })).toEqual({ mayFallback: false })
    expect(effectiveDocumentFontStack({ id: 'test', fontFamily: THEME_FONT })).toEqual({
      fontFamily: THEME_FONT,
      mayFallback: false
    })
    expect(effectiveDocumentFontStack({
      id: 'test',
      fontFamily: 'Imported native Font, sans-serif'
    })).toEqual({
      fontFamily: 'Imported native Font, sans-serif',
      mayFallback: true
    })
  })
})

describe('mind map document degradation report', () => {
  function pathologicalDocument(): MindMapDocumentV2 {
    return {
      schemaVersion: 2,
      id: 'degraded-1',
      revision: 1,
      title: 'Degraded',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
      theme: {
        id: 'custom',
        shape: 'zigzag-marker',
        fontFamily: 'Mystery Font X, sans-serif',
        topicStyles: {
          main: { shape: 'spiral-swirl' }
        }
      },
      sheets: [
        {
          id: 'sheet-1',
          title: 'S',
          root: {
            id: 'root',
            title: 'Root',
            children: [
              {
                id: 'c1',
                title: 'C1',
                children: [],
                style: {
                  shape: 'fishbone',
                  fontFamily: 'Some Other Unmanaged Stack, sans-serif'
                }
              }
            ]
          },
          elements: [],
          layout: {
            structureClass: 'studiumx.layout.logic.right',
            linePattern: 'dotted-wavy' as never
          }
        }
      ],
      assets: []
    }
  }

  it('resolves a pathological document without throwing and reports value-free degradations', () => {
    const findings = resolveDocumentDegradations(pathologicalDocument())
    const paths = findings.map((f) => f.path).sort()

    // Every unknown token is reported against a stable index-based path.
    expect(paths).toContain('sheets[0].layout.linePattern')
    expect(paths).toContain('sheets[0].root.children[0].style.shape')
    expect(paths).toContain('sheets[0].root.children[0].style.fontFamily')
    expect(paths).toContain('sheets[0].theme.topicStyles.main.shape')
    expect(paths).toContain('sheets[0].theme.shape')
    expect(paths).toContain('sheets[0].theme.fontFamily')

    // Findings are value-free: they never leak the unknown token strings.
    const serialized = JSON.stringify(findings)
    expect(serialized).not.toContain('zigzag-marker')
    expect(serialized).not.toContain('spiral-swirl')
    expect(serialized).not.toContain('dotted-wavy')
    expect(serialized).not.toContain('Mystery Font X')
    expect(serialized).not.toContain('Some Other Unmanaged Stack')
  })

  it('marks the report stable across repeated calls', () => {
    const first = resolveDocumentDegradations(pathologicalDocument())
    const second = resolveDocumentDegradations(pathologicalDocument())
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('reports a clean document with no degradations', () => {
    const doc: MindMapDocumentV2 = {
      schemaVersion: 2,
      id: 'clean-1',
      revision: 1,
      title: 'Clean',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
      theme: { id: 'default' },
      sheets: [
        {
          id: 'sheet-1',
          title: 'S',
          root: { id: 'root', title: 'Root', children: [] },
          elements: [],
          layout: { structureClass: 'studiumx.layout.logic.right' }
        }
      ],
      assets: []
    }
    expect(resolveDocumentDegradations(doc)).toEqual([])
  })

  it('supports per-sheet degradation resolution with the sheet index', () => {
    const doc = pathologicalDocument()
    const sheet = doc.sheets[0]!
    const findings = resolveSheetDegradations(sheet, doc.theme, 0)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((f) => f.path.startsWith('sheets[0].'))).toBe(true)
  })
})
