/**
 * Xmind structure-type presets.
 *
 * Xmind supports eight layout families beyond the basic logic chart: map
 * (radial), org-chart, tree, brace, timeline, fishbone, and matrix. Each
 * family has directional variants (left/right, up/down, horizontal/vertical).
 *
 * This registry centralises the metadata for every supported structure class
 * so the layout algorithm, UI selector, xmind converter and schema all share
 * a single source of truth.
 *
 * The registry keeps the historical base strategy API for compatibility, while
 * `getLayoutGeometry` exposes the family-specific geometry used by the v2
 * renderer. This prevents a timeline, fishbone, or matrix sheet from silently
 * rendering as an ordinary balanced mind map.
 */

import type { MindMapStructureClass } from './mind-map-types'

/** Layout family for grouping in the UI and theme association. */
export type StructureFamily =
  | 'map'
  | 'logic'
  | 'org'
  | 'tree'
  | 'brace'
  | 'timeline'
  | 'matrix'
  | 'fishbone'

/**
 * Legacy base layout strategy retained for persisted documents and older
 * callers. `getLayoutGeometry` refines it for structure families whose node
 * positioning is not a regular tree (timeline, fishbone and matrix).
 */
export type LayoutStrategy =
  | 'horizontal-right' // children stack vertically to the right (logic.right, tree.right, brace.right)
  | 'horizontal-left' // mirror of horizontal-right
  | 'balanced' // children split left/right (logic.balanced, map, timeline.horizontal)
  | 'vertical-down' // children stack horizontally below (logic.down, org-chart.down, timeline.vertical, matrix)
  | 'vertical-up' // mirror of vertical-down

/** Family-specific geometry. The first five values are the legacy strategies. */
export type LayoutGeometry =
  | LayoutStrategy
  | 'timeline-horizontal'
  | 'timeline-vertical'
  | 'fishbone-right'
  | 'fishbone-left'
  | 'matrix-rows'
  | 'matrix-columns'

export type MindMapConnectorStyle =
  | 'curve'
  | 'straight'
  | 'elbow'
  | 'rounded-elbow'
  | 'bight'
  | 'fold'
  | 'rounded-fold'
  | 'brace'
  | 'timeline'
  | 'fishbone'
  | 'matrix'

/** Metadata for a single structure-type preset. */
export interface StructureTypePreset {
  /** The Xmind structureClass value (canonical or legacy alias). */
  id: MindMapStructureClass
  /** English display name (from Xmind locale). */
  name: string
  /** Layout family for UI grouping and theme template association. */
  family: StructureFamily
  /** i18n key suffix under `mindmap.inspector.canvasControls`. */
  labelKey: string
  /** Short glyph for the structure selector button. */
  glyph: string
  /** Which base layout strategy computes positions for this structure. */
  layoutStrategy: LayoutStrategy
}

/**
 * All supported structure-type presets, grouped by family.
 *
 * The first entry in each family is the "primary" variant shown by default
 * in compact selectors.
 */
export const STRUCTURE_TYPE_PRESETS: readonly StructureTypePreset[] = [
  // ---- Logic Chart (逻辑图) ----
  {
    id: 'org.xmind.ui.logic.right',
    name: 'Logic Chart (Right)',
    family: 'logic',
    labelKey: 'right',
    glyph: '→',
    layoutStrategy: 'horizontal-right'
  },
  {
    id: 'org.xmind.ui.logic.balanced',
    name: 'Logic Chart (Balanced)',
    family: 'logic',
    labelKey: 'balanced',
    glyph: '↔',
    layoutStrategy: 'balanced'
  },
  {
    id: 'org.xmind.ui.logic.left',
    name: 'Logic Chart (Left)',
    family: 'logic',
    labelKey: 'left',
    glyph: '←',
    layoutStrategy: 'horizontal-left'
  },

  // ---- Mind Map (思维导图 - radial) ----
  {
    id: 'org.xmind.ui.logic.map',
    name: 'Mind Map',
    family: 'map',
    labelKey: 'map',
    glyph: '✦',
    layoutStrategy: 'balanced'
  },
  {
    id: 'org.xmind.ui.map',
    name: 'Mind Map (Map)',
    family: 'map',
    labelKey: 'mapClassic',
    glyph: '✦',
    layoutStrategy: 'balanced'
  },
  {
    id: 'org.xmind.ui.map.clockwise',
    name: 'Mind Map (Clockwise)',
    family: 'map',
    labelKey: 'mapClockwise',
    glyph: '↻',
    layoutStrategy: 'horizontal-right'
  },
  {
    id: 'org.xmind.ui.map.anticlockwise',
    name: 'Mind Map (Anticlockwise)',
    family: 'map',
    labelKey: 'mapAnticlockwise',
    glyph: '↺',
    layoutStrategy: 'horizontal-left'
  },

  // ---- Org Chart (组织结构图) ----
  {
    id: 'org.xmind.ui.logic.down',
    name: 'Org Chart (Down)',
    family: 'org',
    labelKey: 'down',
    glyph: '↓',
    layoutStrategy: 'vertical-down'
  },
  {
    id: 'org.xmind.ui.logic.up',
    name: 'Org Chart (Up)',
    family: 'org',
    labelKey: 'up',
    glyph: '↑',
    layoutStrategy: 'vertical-up'
  },
  {
    id: 'org.xmind.ui.org-chart.down',
    name: 'Org Chart (Down)',
    family: 'org',
    labelKey: 'orgChartDown',
    glyph: '↓',
    layoutStrategy: 'vertical-down'
  },
  {
    id: 'org.xmind.ui.org-chart.up',
    name: 'Org Chart (Up)',
    family: 'org',
    labelKey: 'orgChartUp',
    glyph: '↑',
    layoutStrategy: 'vertical-up'
  },

  // ---- Tree Chart (树形图) ----
  {
    id: 'org.xmind.ui.tree.right',
    name: 'Tree Chart (Right)',
    family: 'tree',
    labelKey: 'treeRight',
    glyph: '⇉',
    layoutStrategy: 'horizontal-right'
  },
  {
    id: 'org.xmind.ui.tree.left',
    name: 'Tree Chart (Left)',
    family: 'tree',
    labelKey: 'treeLeft',
    glyph: '⇇',
    layoutStrategy: 'horizontal-left'
  },

  // ---- Brace Map (括号图) ----
  {
    id: 'org.xmind.ui.brace.right',
    name: 'Brace Map (Right)',
    family: 'brace',
    labelKey: 'braceRight',
    glyph: '⇥',
    layoutStrategy: 'horizontal-right'
  },
  {
    id: 'org.xmind.ui.brace.left',
    name: 'Brace Map (Left)',
    family: 'brace',
    labelKey: 'braceLeft',
    glyph: '⇤',
    layoutStrategy: 'horizontal-left'
  },

  // ---- Timeline (时间轴) ----
  {
    id: 'org.xmind.ui.timeline.horizontal',
    name: 'Timeline (Horizontal)',
    family: 'timeline',
    labelKey: 'timelineHorizontal',
    glyph: '⇢',
    layoutStrategy: 'balanced'
  },
  {
    id: 'org.xmind.ui.timeline.vertical',
    name: 'Timeline (Vertical)',
    family: 'timeline',
    labelKey: 'timelineVertical',
    glyph: '⇣',
    layoutStrategy: 'vertical-down'
  },

  // ---- Matrix (矩阵图) ----
  {
    id: 'org.xmind.ui.spreadsheet',
    name: 'Matrix (Rows)',
    family: 'matrix',
    labelKey: 'matrixRow',
    glyph: '▦',
    layoutStrategy: 'vertical-down'
  },
  {
    id: 'org.xmind.ui.spreadsheet.column',
    name: 'Matrix (Columns)',
    family: 'matrix',
    labelKey: 'matrixColumn',
    glyph: '▦',
    layoutStrategy: 'vertical-down'
  },

  // ---- Fishbone (鱼骨图) ----
  {
    id: 'org.xmind.ui.fishbone.rightHeaded',
    name: 'Fishbone (Right Headed)',
    family: 'fishbone',
    labelKey: 'fishboneRight',
    glyph: '≯',
    layoutStrategy: 'balanced'
  },
  {
    id: 'org.xmind.ui.fishbone.leftHeaded',
    name: 'Fishbone (Left Headed)',
    family: 'fishbone',
    labelKey: 'fishboneLeft',
    glyph: '≮',
    layoutStrategy: 'balanced'
  }
]

/** Map of structure class id -> preset for O(1) lookup. */
const PRESET_BY_ID = new Map(
  STRUCTURE_TYPE_PRESETS.map((p) => [p.id, p] as const)
)

/** Look up a structure-type preset by its structureClass id. */
export function getStructureTypePreset(
  id: MindMapStructureClass
): StructureTypePreset | undefined {
  return PRESET_BY_ID.get(id)
}

/**
 * Get the base layout strategy for a structure class.
 * Falls back to `balanced` for any unrecognised value (forward-compatible).
 */
export function getLayoutStrategy(
  id: MindMapStructureClass
): LayoutStrategy {
  return PRESET_BY_ID.get(id)?.layoutStrategy ?? 'balanced'
}

/** Resolve the actual family geometry without breaking the legacy strategy API. */
export function getLayoutGeometry(id: MindMapStructureClass): LayoutGeometry {
  switch (id) {
    case 'org.xmind.ui.timeline.horizontal':
      return 'timeline-horizontal'
    case 'org.xmind.ui.timeline.vertical':
      return 'timeline-vertical'
    case 'org.xmind.ui.fishbone.rightHeaded':
      return 'fishbone-right'
    case 'org.xmind.ui.fishbone.leftHeaded':
      return 'fishbone-left'
    case 'org.xmind.ui.spreadsheet':
      return 'matrix-rows'
    case 'org.xmind.ui.spreadsheet.column':
      return 'matrix-columns'
    default:
      return getLayoutStrategy(id)
  }
}

/** The default connector language for each XMind structure family. */
export function getConnectorStyle(id: MindMapStructureClass): MindMapConnectorStyle {
  const preset = PRESET_BY_ID.get(id)
  switch (preset?.family) {
    case 'org':
    case 'tree':
      return 'elbow'
    case 'brace':
      return 'brace'
    case 'timeline':
      return 'timeline'
    case 'matrix':
      return 'matrix'
    case 'fishbone':
      return 'fishbone'
    default:
      return 'curve'
  }
}

/** All structure families, in display order. */
export const STRUCTURE_FAMILIES: readonly StructureFamily[] = [
  'map',
  'logic',
  'org',
  'tree',
  'brace',
  'timeline',
  'matrix',
  'fishbone'
]

/** Human-readable family names (used as UI group labels). */
export const STRUCTURE_FAMILY_LABELS: Record<StructureFamily, string> = {
  map: 'Mind Map',
  logic: 'Logic Chart',
  org: 'Org Chart',
  tree: 'Tree Chart',
  brace: 'Brace Map',
  timeline: 'Timeline',
  matrix: 'Matrix',
  fishbone: 'Fishbone'
}

/**
 * Map an Xmind `template` value (from themes.json) to the primary
 * structure class for that family. Used when applying a theme to
 * optionally suggest the matching layout.
 */
export function templateToStructureClass(
  template: string
): MindMapStructureClass | undefined {
  const map: Record<string, MindMapStructureClass> = {
    map: 'org.xmind.ui.logic.map',
    logic: 'org.xmind.ui.logic.right',
    brace: 'org.xmind.ui.brace.right',
    org: 'org.xmind.ui.org-chart.down',
    tree: 'org.xmind.ui.tree.right',
    timeline: 'org.xmind.ui.timeline.horizontal',
    fishbone: 'org.xmind.ui.fishbone.rightHeaded',
    matrix: 'org.xmind.ui.spreadsheet'
  }
  return map[template]
}
