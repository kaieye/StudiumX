import { useEffect, useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  MindMapElement,
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

export { ELEMENT_STYLE_CAPABILITIES } from './mind-map-inspector-capabilities'

const MIXED_VALUE = '__mixed__'

const FONT_OPTIONS = [
  { value: '', key: 'inherit' },
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

function elementDisplayText(element: MindMapElement): string {
  if (element.type === 'callout') return element.text
  return element.label ?? ''
}

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
  const dashedRef = useRef<HTMLInputElement>(null)

  const activeSheet = current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0]
  const element = selection.kind === 'element'
    ? activeSheet?.elements.find((candidate) => candidate.id === selection.elementId)
    : undefined
  const style = element?.style ?? {}
  // Resolved once here (before the early return) so the dashed checkbox can
  // render indeterminate via an effect without violating hook order.
  const dashedValue = resolveElementStyleField(style, 'dashed')

  // The "Dashed line" checkbox only reflects an explicit (concrete) value;
  // inherited/mixed render indeterminate so it reads as "not specified",
  // while toggling always writes an explicit value.
  useEffect(() => {
    if (dashedRef.current) dashedRef.current.indeterminate = dashedValue.state !== 'concrete'
  }, [dashedValue.state])

  if (!activeSheet || !element) return null

  const fieldCapability = (field: MindMapElementInspectorField) =>
    getElementInspectorFieldCapability(element.type, field)
  const disabledFields = ([
    'text', 'stroke', 'strokeWidth', 'fill', 'textColor', 'fontFamily', 'fontSize', 'dashed',
    'lineShape', 'beginArrow', 'endArrow', 'linePattern', 'outlineShape'
  ] as const).filter((field) => fieldCapability(field).disabled)
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
  const updateText = (value: string): void => {
    dispatchCommand({
      type: 'element.update',
      sheetId: activeSheet.id,
      elementId: element.id,
      patch: element.type === 'callout' ? { text: value } : { label: value || null }
    }, { label: 'Update element text' })
  }

  const fieldValue = <K extends keyof MindMapElementStyle>(field: K) =>
    resolveElementStyleField(style, field)
  const selectValue = <T extends string | number>(value: InspectorValue<T>): string => {
    if (value.state === 'mixed') return MIXED_VALUE
    if (value.state === 'concrete') return String(value.value)
    return ''
  }
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

  const renderEnumSelect = (
    field: 'lineShape' | 'beginArrow' | 'endArrow' | 'linePattern' | 'outlineShape',
    options: readonly string[],
    labelKey: string,
    optionPrefix: string
  ) => {
    const value = fieldValue(field)
    return (
      <label className="mindmap-element-style__field">
        <span>{t(labelKey)}</span>
        <select
          value={selectValue(value)}
          disabled={fieldCapability(field).disabled}
          aria-label={labelFor(labelKey, value)}
          aria-describedby={describeField(field)}
          onChange={(event) => {
            const next = event.currentTarget.value
            if (next === MIXED_VALUE) return
            updateStyle({ [field]: next ? next as never : undefined })
          }}
        >
          {value.state === 'mixed' ? (
            <option value={MIXED_VALUE} disabled>{mixedLabel}</option>
          ) : null}
          <option value="">{t('mindmap.elementStyle.inherit')}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {t(`${optionPrefix}.${option}`)}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <section className="mindmap-element-style mm-section" aria-labelledby="mindmap-element-style-title">
      <div className="mm-section__head">
        <div>
          <strong id="mindmap-element-style-title">{t('mindmap.elementStyle.title')}</strong>
          <span className="mindmap-element-style__type">{t(`mindmap.elementStyle.types.${element.type}`)}</span>
        </div>
        <button
          type="button"
          className="icon-button"
          title={t('mindmap.elementStyle.reset')}
          aria-label={t('mindmap.elementStyle.reset')}
          disabled={!element.style}
          onClick={() => dispatchCommand({ type: 'element.update', sheetId: activeSheet.id, elementId: element.id, patch: { style: null } }, { label: 'Reset element style' })}
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      </div>

      <label className="mindmap-element-style__field">
        <span>{t('mindmap.elementStyle.text')}</span>
        <input
          value={elementDisplayText(element)}
          disabled={fieldCapability('text').disabled}
          aria-describedby={describeField('text')}
          onChange={(event) => updateText(event.currentTarget.value)}
        />
      </label>

      <div className="mindmap-element-style__grid">
        {(['stroke', 'fill', 'textColor'] as const).map((field) => {
          const value = fieldValue(field)
          return (
            <label key={field} className="mindmap-element-style__field">
              <span>{t(`mindmap.elementStyle.${field}`)}</span>
              <span style={ROW_STYLE}>
                <input
                  type="color"
                  value={concreteValue(value) ?? FALLBACK[field]}
                  style={{ flex: '1 1 0', minWidth: 0 }}
                  disabled={fieldCapability(field).disabled}
                  aria-label={labelFor(`mindmap.elementStyle.${field}`, value)}
                  aria-describedby={describeField(field)}
                  onChange={(event) => updateStyle({ [field]: event.currentTarget.value })}
                />
                {clearButton(field, value, `mindmap.elementStyle.${field}`)}
              </span>
            </label>
          )
        })}
      </div>

      <label className="mindmap-element-style__field">
        <span>{t('mindmap.elementStyle.strokeWidth')}</span>
        <span style={ROW_STYLE}>
          <input
            type="range"
            min="0"
            max="8"
            step="0.5"
            value={concreteValue(fieldValue('strokeWidth')) ?? FALLBACK.strokeWidth}
            style={{ flex: '1 1 0', minWidth: 0 }}
            disabled={fieldCapability('strokeWidth').disabled}
            aria-label={labelFor('mindmap.elementStyle.strokeWidth', fieldValue('strokeWidth'))}
            aria-describedby={describeField('strokeWidth')}
            onChange={(event) => updateStyle({ strokeWidth: Number(event.currentTarget.value) })}
          />
          {clearButton('strokeWidth', fieldValue('strokeWidth'), 'mindmap.elementStyle.strokeWidth')}
        </span>
      </label>

      <label className="mindmap-element-style__toggle">
        <span>{t('mindmap.elementStyle.dashed')}</span>
        <span style={ROW_STYLE}>
          <input
            ref={dashedRef}
            type="checkbox"
            checked={dashedValue.state === 'concrete' && dashedValue.value === true}
            disabled={fieldCapability('dashed').disabled}
            aria-label={labelFor('mindmap.elementStyle.dashed', dashedValue)}
            aria-describedby={describeField('dashed')}
            onChange={(event) => updateStyle({ dashed: event.currentTarget.checked })}
          />
          {clearButton('dashed', dashedValue, 'mindmap.elementStyle.dashed')}
        </span>
      </label>

      {renderEnumSelect('lineShape', MIND_MAP_ELEMENT_LINE_SHAPES, 'mindmap.elementStyle.lineShape', 'mindmap.elementStyle.lineShapes')}
      <div className="mindmap-element-style__grid">
        {renderEnumSelect('beginArrow', MIND_MAP_ELEMENT_ARROW_SHAPES, 'mindmap.elementStyle.beginArrow', 'mindmap.elementStyle.arrowShapes')}
        {renderEnumSelect('endArrow', MIND_MAP_ELEMENT_ARROW_SHAPES, 'mindmap.elementStyle.endArrow', 'mindmap.elementStyle.arrowShapes')}
      </div>
      {renderEnumSelect('linePattern', MIND_MAP_ELEMENT_LINE_PATTERNS, 'mindmap.elementStyle.linePattern', 'mindmap.elementStyle.linePatterns')}
      {renderEnumSelect('outlineShape', MIND_MAP_ELEMENT_OUTLINE_SHAPES, 'mindmap.elementStyle.outlineShape', 'mindmap.elementStyle.outlineShapes')}

      <label className="mindmap-element-style__field">
        <span>{t('mindmap.elementStyle.fontFamily')}</span>
        <select
          value={selectValue(fieldValue('fontFamily'))}
          disabled={fieldCapability('fontFamily').disabled}
          aria-label={labelFor('mindmap.elementStyle.fontFamily', fieldValue('fontFamily'))}
          aria-describedby={describeField('fontFamily')}
          onChange={(event) => {
            const next = event.currentTarget.value
            if (next === MIXED_VALUE) return
            updateStyle({ fontFamily: next || undefined })
          }}
        >
          {fieldValue('fontFamily').state === 'mixed' ? (
            <option value={MIXED_VALUE} disabled>{mixedLabel}</option>
          ) : null}
          {FONT_OPTIONS.map((option) => <option key={option.key} value={option.value}>{t(`mindmap.topicStyle.${option.key}`)}</option>)}
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