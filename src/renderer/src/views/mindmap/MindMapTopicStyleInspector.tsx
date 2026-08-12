import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'
import type { MindMapLayoutSettings, MindMapTopicStyleOverride, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import type { MindMapSheetLayoutUpdatePatch } from '../../../../shared/mindmap/commands'
import { useMindMapViewStore } from './mind-map-view-store'

type MindMapTopicStyleLayoutOption = {
  value: MindMapStructureClass
  labelKey:
    | 'right'
    | 'balanced'
    | 'left'
    | 'map'
    | 'down'
    | 'up'
}

const MIND_MAP_TOPIC_STYLE_LAYOUT_OPTIONS: readonly MindMapTopicStyleLayoutOption[] = [
  { value: 'org.xmind.ui.logic.right', labelKey: 'right' },
  { value: 'org.xmind.ui.logic.balanced', labelKey: 'balanced' },
  { value: 'org.xmind.ui.logic.left', labelKey: 'left' },
  { value: 'org.xmind.ui.logic.map', labelKey: 'map' },
  { value: 'org.xmind.ui.logic.down', labelKey: 'down' },
  { value: 'org.xmind.ui.logic.up', labelKey: 'up' }
]

const BRANCH_LINE_STYLE_OPTIONS: Array<{
  value: NonNullable<MindMapLayoutSettings['lineStyle']>
  labelKey: 'curve' | 'elbow' | 'straight'
}> = [
  { value: 'curve', labelKey: 'curve' },
  { value: 'elbow', labelKey: 'elbow' },
  { value: 'straight', labelKey: 'straight' }
]

const SHAPE_OPTIONS: readonly { value: string; labelKey: string }[] = [
  { value: 'rounded-rect', labelKey: 'shapeRoundedRect' },
  { value: 'rect', labelKey: 'shapeRect' },
  { value: 'ellipse', labelKey: 'shapeEllipse' },
  { value: 'diamond', labelKey: 'shapeDiamond' },
  { value: 'underline', labelKey: 'shapeUnderline' },
  { value: 'none', labelKey: 'shapeNone' }
]

const FILL_COLOR_PRESETS: readonly string[] = [
  '#4A90D9', '#50C878', '#F5A623', '#E74C3C', '#9B59B6',
  '#1ABC9C', '#E67E22', '#34495E', '#ECF0F1', '#F39C12'
]

const TEXT_COLOR_PRESETS: readonly string[] = [
  '#FFFFFF', '#333333', '#4A90D9', '#E74C3C', '#50C878',
  '#F5A623', '#9B59B6', '#1ABC9C'
]

/**
 * Enhanced topic style inspector (Xmind-style).
 *
 * Edits fill colour, stroke colour, text colour, font family/size/weight,
 * node shape, and per-topic structure-class layout override.
 * All changes funnel through the normal undo/redo and revisioned persistence path.
 */
export function MindMapTopicStyleInspector() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const selectedNodeId = useMindMapViewStore((state) => state.selectedNodeId)
  const updateNode = useMindMapViewStore((state) => state.updateNode)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)

  const activeSheet =
    current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0] ?? null
  const selectedTopic =
    activeSheet && selectedNodeId ? findMindMapTopic(activeSheet.root, selectedNodeId) : null
  const selectedStructureClass = selectedTopic?.style?.structureClass
  const effectiveStructureClass = selectedStructureClass ?? activeSheet?.layout.structureClass
  const hasSelection = selectedTopic !== null

  const updateStyle = (patch: Partial<MindMapTopicStyleOverride>): void => {
    if (!selectedTopic) return
    const currentStyle = selectedTopic.style ?? {}
    const nextStyle = { ...currentStyle, ...patch }
    // Remove undefined values
    for (const key of Object.keys(nextStyle) as (keyof MindMapTopicStyleOverride)[]) {
      if (nextStyle[key] === undefined) delete nextStyle[key]
    }
    updateNode(selectedTopic.id, {
      style: Object.keys(nextStyle).length > 0 ? nextStyle : null
    })
  }

  const clearStyleField = (field: keyof MindMapTopicStyleOverride): void => {
    if (!selectedTopic?.style) return
    const nextStyle = { ...selectedTopic.style }
    delete nextStyle[field]
    updateNode(selectedTopic.id, {
      style: Object.keys(nextStyle).length > 0 ? nextStyle : null
    })
  }

  const updateStructureClass = (value: string): void => {
    if (!selectedTopic) return
    if (value === '') {
      clearStyleField('structureClass')
      return
    }
    updateStyle({ structureClass: value as MindMapStructureClass })
  }

  const updateShape = (value: string): void => {
    if (value === '') {
      clearStyleField('shape')
      return
    }
    updateStyle({ shape: value })
  }

  const dispatchLayoutPatch = (patch: MindMapSheetLayoutUpdatePatch): void => {
    if (!activeSheet) return
    dispatchCommand(
      { type: 'sheet.update-layout', sheetId: activeSheet.id, patch },
      { label: t('mindmap.inspector.canvasControls.updateLabel') }
    )
  }

  if (!hasSelection) {
    return (
      <section className="mindmap-topic-style mm-section" aria-labelledby="mindmap-topic-style-title">
        <div className="mm-section__head">
          <strong id="mindmap-topic-style-title">{t('mindmap.topicStyle.title')}</strong>
        </div>
        <p className="mindmap-topic-style__empty">{t('mindmap.topicStyle.noSelection')}</p>
      </section>
    )
  }

  const style = selectedTopic?.style ?? {}

  const colorSwatchRow = (
    field: 'fill' | 'stroke' | 'textColor',
    presets: readonly string[],
    fallback: string
  ) => (
    <div className="mindmap-topic-style__color-swatches">
      {presets.map((color) => (
        <button
          key={color}
          type="button"
          className={`mindmap-topic-style__swatch${style[field] === color ? ' is-active' : ''}`}
          style={{ background: color }}
          title={color}
          aria-label={color}
          onClick={() => updateStyle({ [field]: style[field] === color ? undefined : color })}
        />
      ))}
      {style[field] && !presets.includes(style[field]!) ? (
        <button
          type="button"
          className="mindmap-topic-style__swatch is-active"
          style={{ background: style[field] }}
          title={style[field]}
        />
      ) : null}
      <input
        type="color"
        className="mindmap-topic-style__color-picker"
        value={style[field] ?? fallback}
        onChange={(event) => updateStyle({ [field]: event.currentTarget.value })}
        title={t('mindmap.topicStyle.customColor')}
      />
      {style[field] ? (
        <button
          type="button"
          className="mindmap-topic-style__clear"
          aria-label={t('mindmap.topicStyle.customColor')}
          onClick={() => clearStyleField(field)}
        >
          ✕
        </button>
      ) : null}
    </div>
  )

  return (
    <section className="mindmap-topic-style mm-section" aria-labelledby="mindmap-topic-style-title">
      <div className="mm-section__head">
        <strong id="mindmap-topic-style-title">{t('mindmap.topicStyle.title')}</strong>
        {selectedTopic ? (
          <div className="mindmap-topic-style__heading-actions">
            <span className="mm-section__hint" title={selectedTopic.title || t('mindmap.untitledTopic')}>
              {selectedTopic.title || t('mindmap.untitledTopic')}
            </span>
            {selectedTopic.style ? (
              <button
                type="button"
                className="mindmap-topic-style__reset"
                onClick={() => updateNode(selectedTopic.id, { style: null })}
                title={t('mindmap.topicStyle.reset')}
                aria-label={t('mindmap.topicStyle.reset')}
              >
                <RotateCcw size={13} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 样式: shape + fill + border */}
      <div className="mm-subhead">{t('mindmap.topicStyle.styleSection')}</div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-shape">
          {t('mindmap.topicStyle.shapeLabel')}
        </label>
        <select
          id="mindmap-topic-style-shape"
          className="mm-select"
          value={style.shape ?? ''}
          onChange={(event) => updateShape(event.currentTarget.value)}
        >
          <option value="">{t('mindmap.topicStyle.inherit')}</option>
          {SHAPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`mindmap.topicStyle.${option.labelKey}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="mm-row mm-row--stack">
        <span className="mm-row__label">{t('mindmap.topicStyle.fillColor')}</span>
        {colorSwatchRow('fill', FILL_COLOR_PRESETS, '#4A90D9')}
      </div>
      <div className="mm-row mm-row--stack">
        <span className="mm-row__label">{t('mindmap.topicStyle.strokeColor')}</span>
        {colorSwatchRow('stroke', FILL_COLOR_PRESETS, '#4A90D9')}
      </div>

      {/* 文本: font family / size / weight / colour */}
      <div className="mm-subhead">{t('mindmap.topicStyle.textSection')}</div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-fontfamily">
          {t('mindmap.topicStyle.fontFamily')}
        </label>
        <select
          id="mindmap-topic-style-fontfamily"
          className="mm-select"
          value={style.fontFamily ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value
            updateStyle({ fontFamily: value || undefined })
          }}
        >
          <option value="">{t('mindmap.topicStyle.inherit')}</option>
          <option value="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
            {t('mindmap.topicStyle.fontSystem')}
          </option>
          <option value="Arial, Helvetica, sans-serif">
            {t('mindmap.topicStyle.fontSans')}
          </option>
          <option value="Georgia, 'Times New Roman', serif">
            {t('mindmap.topicStyle.fontSerif')}
          </option>
          <option value="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">
            {t('mindmap.topicStyle.fontMono')}
          </option>
        </select>
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-fontsize">
          {t('mindmap.topicStyle.fontSize')}
        </label>
        <select
          id="mindmap-topic-style-fontsize"
          className="mm-select"
          value={style.fontSize?.toString() ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value
            updateStyle({ fontSize: value ? Number(value) : undefined })
          }}
        >
          <option value="">{t('mindmap.topicStyle.inherit')}</option>
          {[10, 11, 12, 13, 14, 16, 18, 20, 24].map((size) => (
            <option key={size} value={size}>{size}px</option>
          ))}
        </select>
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-fontweight">
          {t('mindmap.topicStyle.fontWeight')}
        </label>
        <select
          id="mindmap-topic-style-fontweight"
          className="mm-select"
          value={style.fontWeight ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value
            updateStyle({ fontWeight: value || undefined })
          }}
        >
          <option value="">{t('mindmap.topicStyle.inherit')}</option>
          <option value="300">Light</option>
          <option value="400">Regular</option>
          <option value="500">Medium</option>
          <option value="600">Semibold</option>
          <option value="700">Bold</option>
        </select>
      </div>
      <div className="mm-row mm-row--stack">
        <span className="mm-row__label">{t('mindmap.topicStyle.textColor')}</span>
        {colorSwatchRow('textColor', TEXT_COLOR_PRESETS, '#333333')}
      </div>

      {/* 分支: sheet-level connector style */}
      <div className="mm-subhead">{t('mindmap.topicStyle.branchSection')}</div>
      <div className="mm-row">
        <span className="mm-row__label">{t('mindmap.inspector.canvasControls.connector')}</span>
        <div className="mindmap-segmented mindmap-segmented--inline" role="group" aria-label={t('mindmap.topicStyle.branchSection')}>
          {BRANCH_LINE_STYLE_OPTIONS.map((option) => {
            const selected = (activeSheet?.layout.lineStyle ?? 'curve') === option.value
            return (
              <button
                type="button"
                key={option.value}
                className={selected ? 'is-selected' : ''}
                aria-pressed={selected}
                onClick={() => dispatchLayoutPatch({ lineStyle: option.value })}
              >
                {t(`mindmap.inspector.canvasControls.${option.labelKey}`)}
              </button>
            )
          })}
        </div>
      </div>

      {/* 布局: per-topic structure override */}
      <div className="mm-subhead">{t('mindmap.topicStyle.layoutSection')}</div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-layout">
          {t('mindmap.topicStyle.layoutLabel')}
        </label>
        <select
          id="mindmap-topic-style-layout"
          className="mm-select"
          value={selectedStructureClass ?? ''}
          onChange={(event) => updateStructureClass(event.currentTarget.value)}
        >
          <option value="">{t('mindmap.topicStyle.inheritLayout')}</option>
          {MIND_MAP_TOPIC_STYLE_LAYOUT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`mindmap.topicStyle.layouts.${option.labelKey}`)}
            </option>
          ))}
        </select>
      </div>
      {effectiveStructureClass ? (
        <span className="mindmap-topic-style__effective">
          {t('mindmap.topicStyle.effective', {
            layout: topicStyleLayoutLabel(t, effectiveStructureClass)
          })}
        </span>
      ) : null}
    </section>
  )
}

function topicStyleLayoutLabel(
  t: (key: string) => string,
  structureClass: MindMapStructureClass
): string {
  const option = MIND_MAP_TOPIC_STYLE_LAYOUT_OPTIONS.find(
    (candidate) => candidate.value === structureClass
  )
  return option
    ? t(`mindmap.topicStyle.layouts.${option.labelKey}`)
    : structureClass
}

function findMindMapTopic(node: MindMapTopicV2, id: string): MindMapTopicV2 | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findMindMapTopic(child, id)
    if (found) return found
  }
  return null
}
