import type {
  MindMapElementStyle,
  MindMapElementType,
  MindMapTopicStyleOverride
} from '../../../../shared/mindmap/domain/types'
import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'

/** A renderer-only field capability. The reason key is resolved at the UI edge. */
export type MindMapInspectorFieldCapability = {
  supported: boolean
  disabled: boolean
  reasonKey?: 'borderDisabled' | 'balancedMapUnavailable' | 'unsupportedElementField' | 'freeTopicCanvasUnavailable'
}

export type MindMapElementStyleField = keyof MindMapElementStyle
export type MindMapElementInspectorField = 'text' | MindMapElementStyleField
export type MindMapCanvasInspectorField =
  | 'structureClass'
  | 'spacing'
  | 'compact'
  | 'lineStyle'
  | 'lineWidthScale'
  | 'linePattern'
  | 'tapered'
  | 'autoBalance'

const ENABLED: MindMapInspectorFieldCapability = { supported: true, disabled: false }
const BORDER_DEPENDENT_TOPIC_FIELDS = new Set<keyof MindMapTopicStyleOverride>(['stroke', 'borderWidth'])

/**
 * The native element-style fields each renderer element can consume today.
 * Keep this registry separate from components so unavailable fields have one
 * auditable source of truth instead of being conditionally omitted in JSX.
 */
const COMMON_ELEMENT_FIELDS = ['stroke', 'strokeWidth', 'textColor', 'fontFamily', 'fontSize'] as const
const RELATIONSHIP_FIELDS: readonly MindMapElementStyleField[] = [
  ...COMMON_ELEMENT_FIELDS, 'fill', 'dashed', 'lineShape', 'beginArrow', 'endArrow', 'linePattern'
]
const BOUNDARY_FIELDS: readonly MindMapElementStyleField[] = [
  ...COMMON_ELEMENT_FIELDS, 'fill', 'dashed', 'linePattern', 'outlineShape'
]
const SUMMARY_FIELDS: readonly MindMapElementStyleField[] = [
  ...COMMON_ELEMENT_FIELDS, 'dashed', 'linePattern', 'outlineShape'
]
const CALLOUT_FIELDS: readonly MindMapElementStyleField[] = [
  ...COMMON_ELEMENT_FIELDS, 'fill', 'dashed', 'linePattern', 'outlineShape'
]

/** The native element-style fields each renderer element can consume today. */
export const ELEMENT_STYLE_CAPABILITIES: Readonly<Record<
  MindMapElementType,
  ReadonlySet<MindMapElementStyleField>
>> = {
  relationship: new Set(RELATIONSHIP_FIELDS),
  boundary: new Set(BOUNDARY_FIELDS),
  summary: new Set(SUMMARY_FIELDS),
  callout: new Set(CALLOUT_FIELDS),
  'free-topic': new Set()
}

/** Resolve capability for one topic field without collapsing other fields. */
export function getTopicStyleFieldCapability(
  field: keyof MindMapTopicStyleOverride,
  options: { borderEnabled: boolean }
): MindMapInspectorFieldCapability {
  if (BORDER_DEPENDENT_TOPIC_FIELDS.has(field) && !options.borderEnabled) {
    return { supported: true, disabled: true, reasonKey: 'borderDisabled' }
  }
  return ENABLED
}

/** Resolve capability for a single map/canvas layout control. */
export function getCanvasInspectorFieldCapability(
  field: MindMapCanvasInspectorField,
  structureClass: MindMapStructureClass
): MindMapInspectorFieldCapability {
  if (field === 'autoBalance' && !structureClass.startsWith('org.xmind.ui.logic.')) {
    return { supported: false, disabled: true, reasonKey: 'balancedMapUnavailable' }
  }
  return ENABLED
}

/** Resolve capability for every element inspector field, including its text/label editor. */
export function getElementInspectorFieldCapability(
  elementType: MindMapElementType,
  field: MindMapElementInspectorField
): MindMapInspectorFieldCapability {
  if (elementType === 'free-topic') {
    return { supported: false, disabled: true, reasonKey: 'freeTopicCanvasUnavailable' }
  }
  if (field === 'text' || ELEMENT_STYLE_CAPABILITIES[elementType].has(field)) return ENABLED
  return { supported: false, disabled: true, reasonKey: 'unsupportedElementField' }
}
