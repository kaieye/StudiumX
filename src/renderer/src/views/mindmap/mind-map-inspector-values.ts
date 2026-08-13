import type { MindMapTopicStyleOverride, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'

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
