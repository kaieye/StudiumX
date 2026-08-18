import { useTranslation } from 'react-i18next'
import type {
  MindMapElementArrowShape,
  MindMapElementLinePattern,
  MindMapElementLineShape,
  MindMapElementOutlineShape,
  MindMapElementStyle
} from '../../../../shared/mindmap/domain/types'
import { useMindMapViewStore } from './mind-map-view-store'
import {
  getElementInspectorFieldCapability,
  type MindMapElementInspectorField
} from './mind-map-inspector-capabilities'
import {
  resolveElementStyleField,
  type InspectorValue
} from './mind-map-inspector-values'
import {
  MindMapIconPicker,
  type IconPickerOption
} from './MindMapIconPicker'
import {
  ArrowShapeIcon,
  LinePatternIcon,
  LineShapeIcon,
  OutlineShapeIcon
} from './mind-map-shape-icons'
import { MindMapTopicColorPicker, MindMapTopicStyleMenu } from './MindMapTopicStyleMenu'

export { ELEMENT_STYLE_CAPABILITIES } from './mind-map-inspector-capabilities'

const MIXED_VALUE = '__mixed__'

// Managed font stacks offered by the element font control. There is no
// "inherit" entry: the control always shows the effective stack the canvas
// will render (element override > document theme > application default).
const FONT_OPTIONS = [
  { value: 'system-ui, sans-serif', key: 'fontSystem' },
  { value: 'Inter, system-ui, sans-serif', key: 'fontSans' },
  {
    value: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    key: 'fontCjkSans'
  },
  {
    value: '"Noto Serif CJK SC", "Songti SC", SimSun, serif',
    key: 'fontCjkSerif'
  },
  { value: 'Georgia, serif', key: 'fontSerif' },
  { value: 'ui-monospace, SFMono-Regular, monospace', key: 'fontMono' }
] as const

/** Font stack the canvas uses when neither the element nor the theme sets one. */
const ELEMENT_DEFAULT_FONT = 'system-ui, sans-serif'

/**
 * Render defaults for the picker fields. When a field is inherited, the
 * control still shows the actual shape the canvas draws instead of a generic
 * "default/inherit" placeholder.
 */
const ELEMENT_FIELD_DEFAULTS: Record<
  'lineShape' | 'beginArrow' | 'endArrow' | 'linePattern' | 'outlineShape',
  string
> = {
  lineShape: 'curved',
  beginArrow: 'none',
  endArrow: 'none',
  linePattern: 'solid',
  outlineShape: 'rounded-rectangle'
}

export const MIND_MAP_ELEMENT_LINE_SHAPES: readonly MindMapElementLineShape[] = [
  'curved', 'straight', 'angled', 'zigzag',
  'flexible-curved', 'flexible-angled', 'flexible-zigzag'
] as const

export const MIND_MAP_ELEMENT_ARROW_SHAPES: readonly MindMapElementArrowShape[] = [
  'none', 'dot', 'triangle', 'spearhead', 'square', 'diamond',
  'herringbone', 'double-arrow', 'anti-triangle', 'attached', 'hook'
] as const

export const MIND_MAP_ELEMENT_LINE_PATTERNS: readonly MindMapElementLinePattern[] = [
  'solid', 'dash', 'dot', 'dash-dot', 'dash-dot-dot'
] as const

export const MIND_MAP_ELEMENT_OUTLINE_SHAPES: readonly MindMapElementOutlineShape[] = [
  'rectangle', 'rounded-rectangle', 'ellipse', 'polygon',
  'scallops', 'waves', 'tension', 'bracket'
] as const

// Fallback values shown while a field is inherited (unspecified) so controls
// stay usable without inventing a persisted override.
const FALLBACK = {
  stroke: '#438EFF',
  fill: '#FFFFFF',
  textColor: '#333333',
  strokeWidth: 1.5,
  fontSize: 11
} as const

const ELEMENT_COLOR_PRESETS = [
  '#4A90D9', '#50C878', '#F5A623', '#E74C3C', '#9B59B6',
  '#1ABC9C', '#E67E22', '#34495E', '#ECF0F1', '#F39C12'
] as const

const ELEMENT_STROKE_WIDTH_OPTIONS = [0.5, 1, 1.5, 2, 3, 5] as const

// Inline styles keep the ✕ reset affordance on the same row as its control;
// the style inspector has no dedicated CSS for element clear buttons.
const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6
}
const CLEAR_BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  fontSize: 11,
  lineHeight: 1,
  color: 'var(--text-faint)',
  background: 'none',
  border: '1px solid var(--line-muted)',
  borderRadius: 4,
  cursor: 'pointer',
  flexShrink: 0
}

// The fields each inspector renders (and therefore reports as unsupported when
// the selected element type cannot consume them). Relationship elements get
// line/arrow fields; boxed elements (shape/boundary/summary/callout/free-topic)
// get a line pattern and outline shape; connectors get line/arrow fields only.
const RELATIONSHIP_INSPECTOR_FIELDS = [
  'textColor', 'fontFamily', 'fontSize',
  'stroke', 'strokeWidth', 'fill', 'lineShape', 'beginArrow', 'endArrow', 'linePattern'
] as const satisfies readonly MindMapElementInspectorField[]

const BOXED_ELEMENT_INSPECTOR_FIELDS = [
  'textColor', 'fontFamily', 'fontSize',
  'stroke', 'strokeWidth', 'fill', 'linePattern', 'outlineShape'
] as const satisfies readonly MindMapElementInspectorField[]

const CONNECTOR_INSPECTOR_FIELDS = [
  'textColor', 'fontFamily', 'fontSize',
  'stroke', 'strokeWidth', 'lineShape', 'beginArrow', 'endArrow', 'linePattern'
] as const satisfies readonly MindMapElementInspectorField[]

function concreteValue<T>(value: InspectorValue<T>): T | undefined {
  return value.state === 'concrete' ? value.value : undefined
}

/** Contextual style inspector for non-topic map elements. */
export function MindMapElementStyleInspector() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const selection = useMindMapViewStore((state) => state.selection)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)

  const activeSheet = current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0]
  const element = selection.kind === 'element'
    ? activeSheet?.elements.find((candidate) => candidate.id === selection.elementId)
    : undefined
  const style = element?.style ?? {}

  if (!activeSheet || !element) return null

  const fieldCapability = (field: MindMapElementInspectorField) =>
    getElementInspectorFieldCapability(element.type, field)
  const isConnector = element.type === 'connector'
  const isRelationship = element.type === 'relationship'
  const visibleFields = isConnector
    ? CONNECTOR_INSPECTOR_FIELDS
    : isRelationship
      ? RELATIONSHIP_INSPECTOR_FIELDS
      : BOXED_ELEMENT_INSPECTOR_FIELDS
  const disabledFields = visibleFields.filter((field) => fieldCapability(field).disabled)
  const disabledReason = disabledFields.length > 0
    ? fieldCapability(disabledFields[0]!).reasonKey
    : undefined
  const capabilityNoteId = 'mindmap-element-style-capability-note'
  const describeField = (field: MindMapElementInspectorField): string | undefined =>
    fieldCapability(field).disabled ? capabilityNoteId : undefined
  const updateStyle = (patch: Partial<MindMapElementStyle>): void => {
    const next = { ...style, ...patch }
    for (const key of Object.keys(next) as (keyof MindMapElementStyle)[]) {
      if (next[key] === undefined) delete next[key]
    }
    dispatchCommand({
      type: 'element.update',
      sheetId: activeSheet.id,
      elementId: element.id,
      patch: { style: Object.keys(next).length ? next : null }
    }, { label: 'Update element style' })
  }
  const fieldValue = <K extends keyof MindMapElementStyle>(field: K) =>
    resolveElementStyleField(style, field)
  const inheritedLabel = t('mindmap.elementStyle.stateInherited')
  const mixedLabel = t('mindmap.elementStyle.mixed')

  // Accessible naming: mixed fields append " — Mixed" so the control still has
  // a valid label that communicates the mixed state (mirrors the topic
  // inspector's toggles); inherited/concrete keep the plain label.
  const labelFor = (labelKey: string, value: InspectorValue<unknown>): string => {
    const label = t(labelKey)
    return value.state === 'mixed' ? `${label} — ${mixedLabel}` : label
  }

  /** Reset one field to inherit; only meaningful while the field is concrete. */
  const clearField = (field: keyof MindMapElementStyle): void => {
    updateStyle({ [field]: undefined })
  }
  const clearButton = (field: keyof MindMapElementStyle, value: InspectorValue<unknown>, labelKey: string) => {
    if (value.state !== 'concrete') return null
    return (
      <button
        type="button"
        className="mindmap-element-style__clear"
        style={CLEAR_BUTTON_STYLE}
        aria-label={`${t(labelKey)} — ${inheritedLabel}`}
        title={t('mindmap.topicStyle.clearField')}
        disabled={fieldCapability(field).disabled}
        onClick={() => clearField(field)}
      >
        ✕
      </button>
    )
  }

  const renderIconSelect = (
    field: 'lineShape' | 'beginArrow' | 'endArrow' | 'linePattern' | 'outlineShape',
    options: IconPickerOption[],
    labelKey: string,
    dialogLabel: string
  ) => {
    const value = fieldValue(field)
    const concrete = value.state === 'concrete' ? String(value.value) : undefined
    const isMixed = value.state === 'mixed'
    // Show the value the canvas actually draws: the explicit override when set,
    // otherwise the field's render default (no "default/inherit" placeholder).
    const effective = concrete ?? ELEMENT_FIELD_DEFAULTS[field]
    return (
      <MindMapIconPicker
        label={t(labelKey)}
        value={effective}
        isMixed={isMixed}
        options={options}
        searchable={false}
        showClear={concrete !== undefined}
        clearLabel={t('mindmap.elementStyle.inherit')}
        onClear={() => updateStyle({ [field]: undefined })}
        dialogLabel={dialogLabel}
        triggerDescription={isMixed ? t('mindmap.elementStyle.mixed') : undefined}
        disabled={fieldCapability(field).disabled}
        onChange={(next) => {
          if (next === MIXED_VALUE) return
          updateStyle({ [field]: next ? (next as never) : undefined })
        }}
      />
    )
  }
  const renderColorField = (field: 'stroke' | 'fill' | 'textColor') => {
    const value = fieldValue(field)
    const color = concreteValue(value) ?? FALLBACK[field]
    return (
      <div key={field} className="mindmap-element-style__picker-row">
        <MindMapTopicColorPicker
          id={`mindmap-element-style-${field}`}
          label={t(`mindmap.elementStyle.${field}`)}
          value={value}
          displayValue={{ state: 'concrete', value: color }}
          presets={ELEMENT_COLOR_PRESETS}
          fallback={FALLBACK[field]}
          disabled={fieldCapability(field).disabled}
          onChange={(next) => updateStyle({ [field]: next })}
        />
        {clearButton(field, value, `mindmap.elementStyle.${field}`)}
        {/* Keep a narrow native seam for keyboard automation and older WebView
         * shims; the visible control is the shared topic-style swatch above. */}
        <input
          className="mindmap-element-style__compat-color"
          type="color"
          value={color.slice(0, 7)}
          aria-label={labelFor(`mindmap.elementStyle.${field}`, value)}
          disabled={fieldCapability(field).disabled}
          aria-describedby={describeField(field)}
          onChange={(event) => updateStyle({ [field]: event.currentTarget.value })}
        />
      </div>
    )
  }
  const renderStrokeWidthField = () => {
    const value = fieldValue('strokeWidth')
    const concrete = concreteValue(value) ?? FALLBACK.strokeWidth
    return (
      <div className="mindmap-element-style__picker-row">
        <MindMapTopicStyleMenu
          id="mindmap-element-style-stroke-width"
          label={t('mindmap.elementStyle.strokeWidth')}
          value={value}
          displayValue={{ state: 'concrete', value: concrete }}
          options={ELEMENT_STROKE_WIDTH_OPTIONS.map((width) => ({ value: width, label: String(width) }))}
          disabled={fieldCapability('strokeWidth').disabled}
          onChange={(next) => updateStyle({ strokeWidth: next })}
          className="mindmap-topic-style-menu--border-width"
          optionsClassName="mindmap-topic-style-menu__options--border-width"
          optionClassName="mindmap-topic-style-menu__option--border-width"
          renderPreview={(selected) => (
            <span
              className="mindmap-topic-style-menu__width-preview"
              style={{ '--mindmap-topic-style-width': `${selected ?? concrete}px` } as React.CSSProperties}
            />
          )}
          renderOption={(option) => (
            <>
              <span
                className="mindmap-topic-style-menu__width-preview"
                style={{ '--mindmap-topic-style-width': `${option.value}px` } as React.CSSProperties}
                aria-hidden="true"
              />
              <span>{option.label}</span>
            </>
          )}
        />
        {clearButton('strokeWidth', value, 'mindmap.elementStyle.strokeWidth')}
        <input
          className="mindmap-element-style__compat-range"
          type="range"
          min="0"
          max="8"
          step="0.5"
          value={concrete}
          aria-label={labelFor('mindmap.elementStyle.strokeWidth', value)}
          disabled={fieldCapability('strokeWidth').disabled}
          aria-describedby={describeField('strokeWidth')}
          onChange={(event) => updateStyle({ strokeWidth: Number(event.currentTarget.value) })}
        />
      </div>
    )
  }
  // Effective font stack the canvas will render: explicit element override,
  // otherwise the document theme font, otherwise the application default.
  const fontFamilyValue = fieldValue('fontFamily')
  const effectiveFontFamily = fontFamilyValue.state === 'mixed'
    ? MIXED_VALUE
    : fontFamilyValue.state === 'concrete'
      ? String(fontFamilyValue.value)
      : current?.theme.fontFamily ?? ELEMENT_DEFAULT_FONT
  const fontOptions = [
    ...(fontFamilyValue.state !== 'mixed' &&
      !FONT_OPTIONS.some((option) => option.value === effectiveFontFamily)
      ? [{
        value: effectiveFontFamily,
        key: `effective-${effectiveFontFamily}`,
        label: t('mindmap.topicStyle.importedFont', { font: effectiveFontFamily })
      }]
      : []),
    // Only meaningful while an explicit override is set: reset the field back
    // to following the document theme (never labeled "default").
    ...(fontFamilyValue.state === 'concrete'
      ? [{ value: '', key: 'follow-theme', label: t('mindmap.elementStyle.inherit') }]
      : []),
    ...FONT_OPTIONS.map((option) => ({
      value: option.value,
      key: option.key,
      label: t(`mindmap.topicStyle.${option.key}`)
    }))
  ]

  const renderLineAndArrowFields = () => (
    <>
      {renderIconSelect(
        'lineShape',
        MIND_MAP_ELEMENT_LINE_SHAPES.map((shape) => ({
          value: shape,
          label: t(`mindmap.elementStyle.lineShapes.${shape}`),
          icon: <LineShapeIcon shape={shape} />
        })),
        'mindmap.elementStyle.lineShape',
        t('mindmap.elementStyle.lineShape')
      )}
      <div className="mindmap-element-style__grid">
        {renderIconSelect(
          'beginArrow',
          MIND_MAP_ELEMENT_ARROW_SHAPES.map((arrow) => ({
            value: arrow,
            label: t(`mindmap.elementStyle.arrowShapes.${arrow}`),
            icon: <ArrowShapeIcon shape={arrow} />
          })),
          'mindmap.elementStyle.beginArrow',
          t('mindmap.elementStyle.beginArrow')
        )}
        {renderIconSelect(
          'endArrow',
          MIND_MAP_ELEMENT_ARROW_SHAPES.map((arrow) => ({
            value: arrow,
            label: t(`mindmap.elementStyle.arrowShapes.${arrow}`),
            icon: <ArrowShapeIcon shape={arrow} />
          })),
          'mindmap.elementStyle.endArrow',
          t('mindmap.elementStyle.endArrow')
        )}
      </div>
      {renderIconSelect(
        'linePattern',
        MIND_MAP_ELEMENT_LINE_PATTERNS.map((pattern) => ({
          value: pattern,
          label: t(`mindmap.elementStyle.linePatterns.${pattern}`),
          icon: <LinePatternIcon pattern={pattern} />
        })),
        'mindmap.elementStyle.linePattern',
        t('mindmap.elementStyle.linePattern')
      )}
    </>
  )

  return (
    <section
      className="mindmap-element-style mm-section"
      aria-label={t(`mindmap.elementStyle.types.${element.type}`)}
    >
      <div
        className="mindmap-element-style__subsection"
        role="group"
        aria-labelledby="mindmap-element-style-text-title"
      >
        <strong id="mindmap-element-style-text-title" className="mindmap-element-style__subsection-title">
          {t('mindmap.elementStyle.textSection')}
        </strong>
        {renderColorField('textColor')}
        <label className="mindmap-element-style__field">
          <span>{t('mindmap.elementStyle.fontFamily')}</span>
          <select
            value={effectiveFontFamily}
            disabled={fieldCapability('fontFamily').disabled}
            aria-label={labelFor('mindmap.elementStyle.fontFamily', fontFamilyValue)}
            aria-describedby={describeField('fontFamily')}
            onChange={(event) => {
              const next = event.currentTarget.value
              if (next === MIXED_VALUE) return
              updateStyle({ fontFamily: next || undefined })
            }}
          >
            {fontFamilyValue.state === 'mixed' ? (
              <option value={MIXED_VALUE} disabled>{mixedLabel}</option>
            ) : null}
            {fontOptions.map((option) => <option key={option.key} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="mindmap-element-style__field">
          <span>{t('mindmap.elementStyle.fontSize')}</span>
          <span style={ROW_STYLE}>
            <input
              type="number"
              min="8"
              max="72"
              value={concreteValue(fieldValue('fontSize')) ?? FALLBACK.fontSize}
              style={{ flex: '1 1 0', minWidth: 0 }}
              disabled={fieldCapability('fontSize').disabled}
              aria-label={labelFor('mindmap.elementStyle.fontSize', fieldValue('fontSize'))}
              aria-describedby={describeField('fontSize')}
              onChange={(event) => updateStyle({ fontSize: Number(event.currentTarget.value) })}
            />
            {clearButton('fontSize', fieldValue('fontSize'), 'mindmap.elementStyle.fontSize')}
          </span>
        </label>
      </div>

      <div
        className="mindmap-element-style__subsection"
        role="group"
        aria-labelledby="mindmap-element-style-shape-title"
      >
        <strong id="mindmap-element-style-shape-title" className="mindmap-element-style__subsection-title">
          {t('mindmap.elementStyle.shapeSection')}
        </strong>
        {renderColorField('stroke')}
        {isConnector ? null : renderColorField('fill')}
        {renderStrokeWidthField()}
        {isConnector || isRelationship ? (
          renderLineAndArrowFields()
        ) : renderIconSelect(
          'linePattern',
          MIND_MAP_ELEMENT_LINE_PATTERNS.map((pattern) => ({
            value: pattern,
            label: t(`mindmap.elementStyle.linePatterns.${pattern}`),
            icon: <LinePatternIcon pattern={pattern} />
          })),
          'mindmap.elementStyle.linePattern',
          t('mindmap.elementStyle.linePattern')
        )}
        {isConnector || isRelationship ? null : renderIconSelect(
          'outlineShape',
          MIND_MAP_ELEMENT_OUTLINE_SHAPES.map((shape) => ({
            value: shape,
            label: t(`mindmap.elementStyle.outlineShapes.${shape}`),
            icon: <OutlineShapeIcon shape={shape} />
          })),
          'mindmap.elementStyle.outlineShape',
          t('mindmap.elementStyle.outlineShape')
        )}
      </div>

      {disabledReason ? (
        <p id={capabilityNoteId} className="mindmap-element-style__notice">
          {t(`mindmap.elementStyle.capability.${disabledReason}`, {
            element: t(`mindmap.elementStyle.types.${element.type}`)
          })}
        </p>
      ) : null}
    </section>
  )
}
