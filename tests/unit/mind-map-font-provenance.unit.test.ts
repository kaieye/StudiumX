import { describe, expect, it } from 'vitest'
import {
  resolveSelectedTopicFontProvenance,
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
    const importedFont = 'Imported XMind Font, sans-serif'
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
})
