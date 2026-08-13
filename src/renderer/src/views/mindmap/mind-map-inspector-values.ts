import type {
  MindMapElementStyle,
  MindMapLayoutSettings,
  MindMapTopicStyleOverride,
  MindMapTopicV2
} from '../../../../shared/mindmap/domain/types'

export type InspectorValue<T> =
  | { state: 'default' }
  | { state: 'inherited' }
  | { state: 'none' }
  | { state: 'concrete'; value: T }
  | { state: 'mixed' }

/**
 * Resolve a field without collapsing inherited, explicit none, and mixed values.
 * The adapter is intentionally UI-only: none/default are never invented as
 * persisted values by this module.
 */
export function resolveInspectorValue<T>(
  values: readonly (T | undefined)[],
  options: {
    absentState?: 'default' | 'inherited'
    isNone?: (value: T) => boolean
  } = {}
): InspectorValue<T> {
  if (values.length === 0) return { state: options.absentState ?? 'default' }

  const first = values[0]
  if (!values.every((value) => Object.is(value, first))) return { state: 'mixed' }
  if (first === undefined) return { state: options.absentState ?? 'inherited' }
  if (options.isNone?.(first) === true) return { state: 'none' }
  return { state: 'concrete', value: first }
}

/**
 * Resolve one element style field for the currently selected element.
 *
 * Element style fields have no theme layer, so `undefined` means
 * "unspecified / theme default" (the inspector displays fallback values).
 * The helper is built on a single-element array so that a future
 * multi-element selection automatically yields `mixed` without changing
 * the call sites: pass several element styles instead of one.
 */
export function resolveElementStyleField<K extends keyof MindMapElementStyle>(
  styles: readonly (MindMapElementStyle | undefined)[] | MindMapElementStyle | undefined,
  field: K
): InspectorValue<NonNullable<MindMapElementStyle[K]>> {
  const entries = Array.isArray(styles)
    ? styles
    : [styles]
  return resolveInspectorValue(
    entries.map((style) => style?.[field] as NonNullable<MindMapElementStyle[K]> | undefined),
    { absentState: 'inherited' }
  )
}

/**
 * Sheet-layout fields that can be inherited from the theme/structure default.
 * `structureClass` and `direction` are intentionally excluded: the structure
 * is a per-sheet concrete identity (not a theme override), and direction is
 * not exposed as an override in the canvas inspector today.
 */
export type MindMapLayoutField =
  | 'lineWidthScale'
  | 'lineStyle'
  | 'linePattern'
  | 'tapered'
  | 'compact'
  | 'spacing'

/**
 * Resolve one sheet-layout field into the five-state adapter.
 *
 * Layout fields have no explicit `none` value: `undefined` means "use the
 * structure/theme default" (inherited) and an explicit value is a sheet
 * override (concrete). The helper accepts one or more layout settings so a
 * future multi-sheet selection yields `mixed` without changing call sites:
 * pass several layout settings instead of one.
 */
export function resolveLayoutField<K extends MindMapLayoutField>(
  settings: readonly MindMapLayoutSettings[] | MindMapLayoutSettings | undefined,
  field: K
): InspectorValue<NonNullable<MindMapLayoutSettings[K]>> {
  const entries = Array.isArray(settings)
    ? settings
    : [settings]
  return resolveInspectorValue(
    entries.map((setting) => setting?.[field] as NonNullable<MindMapLayoutSettings[K]> | undefined),
    { absentState: 'inherited' }
  )
}

export function resolveTopicStyleField<K extends keyof MindMapTopicStyleOverride>(
  topics: readonly MindMapTopicV2[],
  field: K
): InspectorValue<NonNullable<MindMapTopicStyleOverride[K]>> {
  return resolveInspectorValue(
    topics.map((topic) => topic.style?.[field] as NonNullable<MindMapTopicStyleOverride[K]> | undefined),
    {
      absentState: 'inherited',
      isNone: field === 'shape'
        ? (value) => value === 'none'
        : undefined
    }
  )
}
