import { useTranslation } from 'react-i18next'
import type { InspectorValue } from './mind-map-inspector-values'
import type { NodeShape } from './mind-map-node-shapes'
import { fieldStateDescription } from './mind-map-keyboard-navigation'
import {
  MindMapIconPicker,
  type IconPickerOption
} from './MindMapIconPicker'
import { NodeShapeIcon } from './mind-map-shape-icons'

type ShapeCategory = 'basic' | 'annotation' | 'directional' | 'decorative' | 'flow'

type ShapeOption = {
  value: string
  labelKey: string
  category: ShapeCategory
}

export const MIND_MAP_TOPIC_SHAPE_OPTIONS: readonly ShapeOption[] = [
  { value: 'rounded-rect', labelKey: 'shapeRoundedRect', category: 'basic' },
  { value: 'rect', labelKey: 'shapeRect', category: 'basic' },
  { value: 'ellipse', labelKey: 'shapeEllipse', category: 'basic' },
  { value: 'diamond', labelKey: 'shapeDiamond', category: 'basic' },
  { value: 'underline', labelKey: 'shapeUnderline', category: 'basic' },
  { value: 'none', labelKey: 'shapeNone', category: 'basic' },
  { value: 'quote', labelKey: 'shapeQuote', category: 'annotation' },
  { value: 'callout', labelKey: 'shapeCallout', category: 'annotation' },
  { value: 'bracket', labelKey: 'shapeBracket', category: 'annotation' },
  { value: 'arrow-right', labelKey: 'shapeArrowRight', category: 'directional' },
  { value: 'arrow-left', labelKey: 'shapeArrowLeft', category: 'directional' },
  { value: 'heart', labelKey: 'shapeHeart', category: 'decorative' },
  { value: 'cloud', labelKey: 'shapeCloud', category: 'decorative' },
  { value: 'star', labelKey: 'shapeStar', category: 'decorative' },
  { value: 'parallelogram', labelKey: 'shapeParallelogram', category: 'flow' },
  { value: 'hexagon', labelKey: 'shapeHexagon', category: 'flow' }
]

const SHAPE_CATEGORIES: readonly { key: ShapeCategory; labelKey: string }[] = [
  { key: 'basic', labelKey: 'shapeCategories.basic' },
  { key: 'annotation', labelKey: 'shapeCategories.annotation' },
  { key: 'directional', labelKey: 'shapeCategories.directional' },
  { key: 'decorative', labelKey: 'shapeCategories.decorative' },
  { key: 'flow', labelKey: 'shapeCategories.flow' }
]

type MindMapTopicShapePickerProps = {
  value: InspectorValue<string>
  displayValue?: InspectorValue<string>
  onChange: (value: string | undefined) => void
}

/**
 * A compact, searchable shape picker that shows a concrete drawing of each
 * node shape (like Xmind) instead of a bare text label. It owns only transient
 * UI state; callers retain the canonical command/reducer/persistence lane.
 */
export function MindMapTopicShapePicker({
  value,
  displayValue,
  onChange
}: MindMapTopicShapePickerProps) {
  const { t } = useTranslation()

  const display = displayValue ?? value
  const hasLocalOverride = value.state !== 'inherited' && value.state !== 'default'
  const selectedShape = display.state === 'concrete'
    ? display.value
    : display.state === 'none' ? 'none' : undefined
  const isMixed = display.state === 'mixed'

  const shapeIcon = (shape: string): IconPickerOption['icon'] => (
    <NodeShapeIcon shape={shape as NodeShape} />
  )

  const options: IconPickerOption[] = MIND_MAP_TOPIC_SHAPE_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`mindmap.topicStyle.${option.labelKey}`),
    category: option.category,
    icon: shapeIcon(option.value)
  }))

  return (
    <MindMapIconPicker
      label={t('mindmap.topicStyle.shapeLabel')}
      value={selectedShape}
      isMixed={isMixed}
      displayLabel={
        selectedShape && !options.some((o) => o.value === selectedShape)
          ? t('mindmap.topicStyle.shapeImported', { shape: selectedShape })
          : t('mindmap.topicStyle.stateInherited')
      }
      options={options}
      categories={SHAPE_CATEGORIES.map((c) => ({
        key: c.key,
        label: t(`mindmap.topicStyle.${c.labelKey}`)
      }))}
      showClear={hasLocalOverride}
      clearLabel={t('mindmap.topicStyle.clearField')}
      onClear={() => onChange(undefined)}
      dialogLabel={t('mindmap.topicStyle.shapePicker')}
      optionLabelKey={(shapeValue) =>
        t(`mindmap.topicStyle.${MIND_MAP_TOPIC_SHAPE_OPTIONS.find((o) => o.value === shapeValue)?.labelKey ?? 'shapeRoundedRect'}`)
      }
      buildTriggerName={(triggerLabel) => `${t('mindmap.topicStyle.shapeLabel')} ${triggerLabel}`}
      triggerDescription={fieldStateDescription(value.state, {
        inherited: t('mindmap.topicStyle.stateInherited'),
        none: t('mindmap.topicStyle.stateNone'),
        mixed: t('mindmap.topicStyle.mixed')
      })}
      selectedDescription={t('mindmap.topicStyle.selected')}
      onChange={(next) => {
        if (next === undefined) {
          if (hasLocalOverride) onChange(undefined)
        } else if (isMixed || next !== selectedShape) {
          onChange(next)
        }
      }}
    />
  )
}
