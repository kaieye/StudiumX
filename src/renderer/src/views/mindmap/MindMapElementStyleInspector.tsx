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

export { ELEMENT_STYLE_CAPABILITIES } from './mind-map-inspector-capabilities'

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

function elementDisplayText(element: MindMapElement): string {
  if (element.type === 'callout') return element.text
  return element.label ?? ''
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
  const style = element.style ?? {}
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

  const renderEnumSelect = (
    field: 'lineShape' | 'beginArrow' | 'endArrow' | 'linePattern' | 'outlineShape',
    options: readonly string[],
    labelKey: string,
    optionPrefix: string
  ) => {
    const value = style[field]
    return (
      <label className="mindmap-element-style__field">
        <span>{t(labelKey)}</span>
        <select
          value={value ?? ''}
          disabled={fieldCapability(field).disabled}
          aria-describedby={describeField(field)}
          onChange={(event) => {
            const next = event.currentTarget.value
            updateStyle({ [field]: next ? next as never : undefined })
          }}
        >
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
        <label className="mindmap-element-style__field">
          <span>{t('mindmap.elementStyle.stroke')}</span>
          <input
            type="color"
            value={style.stroke ?? '#438EFF'}
            disabled={fieldCapability('stroke').disabled}
            aria-describedby={describeField('stroke')}
            onChange={(event) => updateStyle({ stroke: event.currentTarget.value })}
          />
        </label>
        <label className="mindmap-element-style__field">
          <span>{t('mindmap.elementStyle.fill')}</span>
          <input
            type="color"
            value={style.fill ?? '#FFFFFF'}
            disabled={fieldCapability('fill').disabled}
            aria-describedby={describeField('fill')}
            onChange={(event) => updateStyle({ fill: event.currentTarget.value })}
          />
        </label>
        <label className="mindmap-element-style__field">
          <span>{t('mindmap.elementStyle.textColor')}</span>
          <input
            type="color"
            value={style.textColor ?? '#333333'}
            disabled={fieldCapability('textColor').disabled}
            aria-describedby={describeField('textColor')}
            onChange={(event) => updateStyle({ textColor: event.currentTarget.value })}
          />
        </label>
      </div>

      <label className="mindmap-element-style__field">
        <span>{t('mindmap.elementStyle.strokeWidth')}</span>
        <input
          type="range"
          min="0"
          max="8"
          step="0.5"
          value={style.strokeWidth ?? 1.5}
          disabled={fieldCapability('strokeWidth').disabled}
          aria-describedby={describeField('strokeWidth')}
          onChange={(event) => updateStyle({ strokeWidth: Number(event.currentTarget.value) })}
        />
      </label>

      <label className="mindmap-element-style__toggle">
        <span>{t('mindmap.elementStyle.dashed')}</span>
        <input
          type="checkbox"
          checked={style.dashed ?? false}
          disabled={fieldCapability('dashed').disabled}
          aria-describedby={describeField('dashed')}
          onChange={(event) => updateStyle({ dashed: event.currentTarget.checked })}
        />
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
          value={style.fontFamily ?? ''}
          disabled={fieldCapability('fontFamily').disabled}
          aria-describedby={describeField('fontFamily')}
          onChange={(event) => updateStyle({ fontFamily: event.currentTarget.value || undefined })}
        >
          {FONT_OPTIONS.map((option) => <option key={option.key} value={option.value}>{t(`mindmap.topicStyle.${option.key}`)}</option>)}
        </select>
      </label>

      <label className="mindmap-element-style__field">
        <span>{t('mindmap.elementStyle.fontSize')}</span>
        <input
          type="number"
          min="8"
          max="72"
          value={style.fontSize ?? 11}
          disabled={fieldCapability('fontSize').disabled}
          aria-describedby={describeField('fontSize')}
          onChange={(event) => updateStyle({ fontSize: Number(event.currentTarget.value) })}
        />
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
