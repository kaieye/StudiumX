import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'

export type MindMapCreatePreset = {
  id: string
  structureClass: MindMapStructureClass
  translationKey: string
  thumbnail: 'mindMap' | 'logic' | 'org' | 'tree' | 'brace' | 'timeline' | 'fishbone' | 'matrix'
}

/** The XMind-style radial map offered when a user starts a new document. */
export const DEFAULT_NEW_MIND_MAP_STRUCTURE_CLASS: MindMapStructureClass =
  'org.xmind.ui.logic.map'

/**
 * The primary XMind structures shown in the new-map dialog. Directional variants
 * remain available later from the canvas options panel.
 */
export const MIND_MAP_CREATE_PRESETS: readonly MindMapCreatePreset[] = [
  {
    id: 'mindMap',
    structureClass: 'org.xmind.ui.logic.map',
    translationKey: 'mindMap',
    thumbnail: 'mindMap'
  },
  {
    id: 'logic',
    structureClass: 'org.xmind.ui.logic.right',
    translationKey: 'logic',
    thumbnail: 'logic'
  },
  {
    id: 'org',
    structureClass: 'org.xmind.ui.org-chart.down',
    translationKey: 'org',
    thumbnail: 'org'
  },
  {
    id: 'tree',
    structureClass: 'org.xmind.ui.tree.right',
    translationKey: 'tree',
    thumbnail: 'tree'
  },
  {
    id: 'brace',
    structureClass: 'org.xmind.ui.brace.right',
    translationKey: 'brace',
    thumbnail: 'brace'
  },
  {
    id: 'timeline',
    structureClass: 'org.xmind.ui.timeline.horizontal',
    translationKey: 'timeline',
    thumbnail: 'timeline'
  },
  {
    id: 'fishbone',
    structureClass: 'org.xmind.ui.fishbone.rightHeaded',
    translationKey: 'fishbone',
    thumbnail: 'fishbone'
  },
  {
    id: 'matrix',
    structureClass: 'org.xmind.ui.spreadsheet',
    translationKey: 'matrix',
    thumbnail: 'matrix'
  }
]
