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
 * Layout positions for the new families (tree, brace, timeline, fishbone) are
 * approximated by mapping to one of the five base layout strategies that the
 * existing `mind-map-layout.ts` already computes. Connector rendering can be
 * enhanced later without changing the position model.
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
  | 'fishbone'

/**
 * Base layout strategy - the position model used by `mind-map-layout.ts`.
 * New structure classes map to one of these five; they differ only in
 * connector style, not in node positioning.
 */
export type LayoutStrategy =
  | 'horizontal-right' // children stack vertically to the right (logic.right, tree.right, brace.right)
  | 'horizontal-left' // mirror of horizontal-right
  | 'balanced' // children split left/right (logic.balanced, map, timeline.horizontal)
  | 'vertical-down' // children stack horizontally below (logic.down, org-chart.down, timeline.vertical)
  | 'vertical-up' // mirror of vertical-down

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

/** All structure families, in display order. */
export const STRUCTURE_FAMILIES: readonly StructureFamily[] = [
  'map',
  'logic',
  'org',
  'tree',
  'brace',
  'timeline',
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
    matrix: 'org.xmind.ui.map'
  }
  return map[template]
}
