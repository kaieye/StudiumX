import { useRef } from 'react'
import { Bold, Italic, RotateCcw, Strikethrough, Underline } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'
import type { MindMapTopicStyleOverride, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import type { MindMapCommand } from '../../../../shared/mindmap/commands/mind-map-command-types'
import type { MindMapExecuteOptions } from '../../../../shared/mindmap/commands/mind-map-undo-redo'
import { resolveInspectorValue, resolveTopicStyleField, type InspectorValue } from './mind-map-inspector-values'
import { getTopicStyleFieldCapability } from './mind-map-inspector-capabilities'
import {
  buildPropagateTopicStyleCommand,
  findTopicInSheet,
  type MindMapTopicStylePropagationScope
} from './mind-map-commands'
import { useMindMapViewStore } from './mind-map-view-store'
import {
  defaultTopicTextAlign,
  isBoldTopicFontWeight,
  hasTopicTextDecoration,
  normalizeTopicFontWeight,
  normalizeTopicTextDecoration,
  resolveEffectiveTopicStyle,
  topicStyleLayerForDepth,
  updateTopicTextDecoration,
  type MindMapTextDecorationFlag
} from './mind-map-topic-style'
import { resolveSelectedTopicFontProvenance } from './mind-map-font-provenance'
import { MindMapTopicShapePicker } from './MindMapTopicShapePicker'
import type { MindMapQuickStylePreset } from '../../../../shared/mindmap/quick-styles'

type MindMapTopicStyleLayoutOption = {
  value: MindMapStructureClass
  labelKey: 'right' | 'balanced' | 'left' | 'map' | 'down' | 'up'
}

const MIXED_VALUE = '__mixed__'
const WIDTH_MIN = 72
const WIDTH_MAX = 720

const FONT_SOURCE_LABEL_KEYS = {
  local: 'fontSourceLocal',
  document: 'fontSourceDocument',
  'theme-layer': 'fontSourceThemeLayer',
  'app-fallback': 'fontSourceAppFallback',
  mixed: 'fontSourceMixed'
} as const

const MIND_MAP_TOPIC_STYLE_LAYOUT_OPTIONS: readonly MindMapTopicStyleLayoutOption[] = [
  { value: 'org.xmind.ui.logic.right', labelKey: 'right' },
  { value: 'org.xmind.ui.logic.balanced', labelKey: 'balanced' },
  { value: 'org.xmind.ui.logic.left', labelKey: 'left' },
  { value: 'org.xmind.ui.logic.map', labelKey: 'map' },
  { value: 'org.xmind.ui.logic.down', labelKey: 'down' },
  { value: 'org.xmind.ui.logic.up', labelKey: 'up' }
]

const FILL_PATTERN_OPTIONS = [
  { value: 'solid', labelKey: 'fillPatternSolid' },
  { value: 'hand-drawn', labelKey: 'fillPatternHandDrawn' },
  { value: 'diagonal', labelKey: 'fillPatternDiagonal' },
  { value: 'horizontal', labelKey: 'fillPatternHorizontal' }
] as const satisfies readonly {
  value: NonNullable<MindMapTopicStyleOverride['fillPattern']>
  labelKey: string
}[]

const FILL_COLOR_PRESETS: readonly string[] = [
  '#4A90D9', '#50C878', '#F5A623', '#E74C3C', '#9B59B6',
  '#1ABC9C', '#E67E22', '#34495E', '#ECF0F1', '#F39C12'
]

const TEXT_COLOR_PRESETS: readonly string[] = [
  '#FFFFFF', '#333333', '#4A90D9', '#E74C3C', '#50C878',
  '#F5A623', '#9B59B6', '#1ABC9C'
]

const BORDER_STYLE_OPTIONS = [
  { value: 'none', labelKey: 'borderStyleNone' },
  { value: 'solid', labelKey: 'borderStyleSolid' },
  { value: 'dash', labelKey: 'borderStyleDash' },
  { value: 'hand-drawn-solid', labelKey: 'borderStyleHandDrawnSolid' },
  { value: 'hand-drawn-dash', labelKey: 'borderStyleHandDrawnDash' }
] as const satisfies readonly {
  value: NonNullable<MindMapTopicStyleOverride['borderStyle']>
  labelKey: string
}[]

const BORDER_WIDTH_OPTIONS = [0.5, 1, 2, 3, 5] as const

const TEXT_TRANSFORM_OPTIONS = [
  { value: 'none', labelKey: 'textTransformNone' },
  { value: 'uppercase', labelKey: 'textTransformUppercase' },
  { value: 'lowercase', labelKey: 'textTransformLowercase' },
  { value: 'capitalize', labelKey: 'textTransformCapitalize' }
] as const satisfies readonly {
  value: NonNullable<MindMapTopicStyleOverride['textTransform']>
  labelKey: string
}[]

const TEXT_ALIGN_OPTIONS = [
  { value: 'left', labelKey: 'textAlignLeft' },
  { value: 'center', labelKey: 'textAlignCenter' },
  { value: 'right', labelKey: 'textAlignRight' }
] as const satisfies readonly {
  value: NonNullable<MindMapTopicStyleOverride['textAlign']>
  labelKey: string
}[]

const FONT_OPTIONS = [
  { value: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", key: 'fontSystem' },
  { value: 'Arial, Helvetica, sans-serif', key: 'fontSans' },
  { value: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif', key: 'fontCjkSans' },
  { value: '"Noto Serif CJK SC", "Songti SC", SimSun, serif', key: 'fontCjkSerif' },
  { value: "Georgia, 'Times New Roman', serif", key: 'fontSerif' },
  { value: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', key: 'fontMono' }
] as const

/** Topic formatting for a single topic or a multi-selection. */
export function MindMapTopicStyleInspector() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const selection = useMindMapViewStore((state) => state.selection)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)
  const applyQuickStyle = useMindMapViewStore((state) => state.applyQuickStyle)
  const fontSizeEditSession = useRef(0)

  const activeSheet =
    current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0] ?? null
  const selectedTopicEntries = activeSheet && selection.kind === 'topic'
    ? selection.topicIds
        .map((id) => findMindMapTopic(activeSheet.root, id))
        .filter((entry): entry is { topic: MindMapTopicV2; depth: number } => entry !== null)
    : []
  const selectedTopics = selectedTopicEntries.map((entry) => entry.topic)
  const hasSelection = selectedTopics.length > 0

  const dispatchStyleMutation = (
    mutate: (
      style: MindMapTopicStyleOverride,
      topic: MindMapTopicV2,
      depth: number
    ) => MindMapTopicStyleOverride,
    options?: MindMapExecuteOptions
  ): void => {
    if (!activeSheet || selectedTopics.length === 0) return
    const commands: MindMapCommand[] = selectedTopicEntries.map(({ topic, depth }) => {
      const nextStyle = mutate({ ...(topic.style ?? {}) }, topic, depth)
      return {
        type: 'topic.update',
        sheetId: activeSheet.id,
        topicId: topic.id,
        patch: { style: Object.keys(nextStyle).length > 0 ? nextStyle : null }
      }
    })
    dispatchCommand(
      commands.length === 1 ? commands[0] : { type: 'transaction', commands },
      {
        label: selectedTopics.length === 1 ? 'Update topic style' : 'Update selected topic styles',
        ...options
      }
    )
  }

  const updateStyleField = <K extends keyof MindMapTopicStyleOverride>(
    field: K,
    value: MindMapTopicStyleOverride[K],
    options?: MindMapExecuteOptions
  ): void => {
    dispatchStyleMutation((style) => {
      if (value === undefined) delete style[field]
      else style[field] = value
      return style
    }, options)
  }

  const clearStyleField = (field: keyof MindMapTopicStyleOverride): void => {
    updateStyleField(field, undefined)
  }

  const resetStyles = (): void => {
    dispatchStyleMutation(() => ({}))
  }

  const selectedTopicRef = activeSheet && selectedTopics.length === 1
    ? findTopicInSheet(activeSheet, selectedTopics[0].id)
    : undefined
  const siblingCount = selectedTopicRef?.parent?.children.filter(
    (topic) => topic.id !== selectedTopicRef.node.id
  ).length ?? 0
  const descendantCount = selectedTopicRef ? countDescendants(selectedTopicRef.node) : 0
  const propagateStyle = (scope: MindMapTopicStylePropagationScope): void => {
    if (!activeSheet || !selectedTopicRef) return
    const command = buildPropagateTopicStyleCommand(activeSheet, selectedTopicRef.node.id, scope)
    if (!command) return
    dispatchCommand(command, {
      label: scope === 'siblings'
        ? 'Apply topic style to siblings'
        : 'Apply topic style to descendants'
    })
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

  const fieldValue = <K extends keyof MindMapTopicStyleOverride>(field: K) =>
    resolveTopicStyleField(selectedTopics, field)
  const selectValue = <T extends string | number>(value: InspectorValue<T>): string => {
    if (value.state === 'mixed') return MIXED_VALUE
    if (value.state === 'concrete') return String(value.value)
    if (value.state === 'none') return 'none'
    return ''
  }
  const concreteValue = <T,>(value: InspectorValue<T>): T | undefined =>
    value.state === 'concrete' ? value.value : undefined
  const effectiveEmphasisValue = <T,>(
    resolve: (style: MindMapTopicStyleOverride | undefined) => T
  ): InspectorValue<T> => resolveInspectorValue(
    selectedTopicEntries.map(({ topic, depth }) =>
      resolve(resolveEffectiveTopicStyle(topic.style, current!.theme, depth))
    ),
    { absentState: 'inherited' }
  )

  const colorSwatchRow = (
    field: 'fill' | 'stroke' | 'textColor',
    presets: readonly string[],
    fallback: string
  ) => {
    const resolved = fieldValue(field)
    const concrete = concreteValue(resolved)
    const hasOverride = selectedTopics.some((topic) => topic.style?.[field] !== undefined)
    return (
      <div className="mindmap-topic-style__color-swatches">
        {presets.map((color) => (
          <button
            key={color}
            type="button"
            className={`mindmap-topic-style__swatch${concrete === color ? ' is-active' : ''}`}
            style={{ background: color }}
            title={color}
            aria-label={color}
            aria-pressed={concrete === color}
            onClick={() => updateStyleField(field, concrete === color ? undefined : color)}
          />
        ))}
        {concrete && !presets.includes(concrete) ? (
          <button
            type="button"
            className="mindmap-topic-style__swatch is-active"
            style={{ background: concrete }}
            title={concrete}
            aria-label={concrete}
            aria-pressed="true"
          />
        ) : null}
        <input
          type="color"
          className="mindmap-topic-style__color-picker"
          value={concrete ?? fallback}
          onChange={(event) => updateStyleField(field, event.currentTarget.value)}
          title={resolved.state === 'mixed'
            ? `${t('mindmap.topicStyle.customColor')} — ${t('mindmap.topicStyle.mixed')}`
            : t('mindmap.topicStyle.customColor')}
        />
        {hasOverride ? (
          <button
            type="button"
            className="mindmap-topic-style__clear"
            aria-label={t('mindmap.topicStyle.clearField')}
            onClick={() => clearStyleField(field)}
          >
            ✕
          </button>
        ) : null}
      </div>
    )
  }

  const shape = fieldValue('shape')
  const fillPattern = fieldValue('fillPattern')
  const fontFamily = fieldValue('fontFamily')
  const resolvedFont = resolveSelectedTopicFontProvenance(
    selectedTopicEntries.map(({ topic, depth }) => ({ nodeStyle: topic.style, depth })),
    current!.theme
  )
  const hasUnlistedLocalFont = fontFamily.state === 'concrete'
    && !FONT_OPTIONS.some((option) => option.value === fontFamily.value)
  const fontSize = fieldValue('fontSize')
  const fontWeight = fieldValue('fontWeight')
  const borderStyle = fieldValue('borderStyle')
  const borderWidth = fieldValue('borderWidth')
  const effectiveBorderStyles = selectedTopicEntries.map(({ topic, depth }) =>
    resolveEffectiveTopicStyle(topic.style, current!.theme, depth)?.borderStyle ?? 'solid'
  )
  const borderEnabled = effectiveBorderStyles.some((value) => value !== 'none')
  const borderStrokeCapability = getTopicStyleFieldCapability('stroke', { borderEnabled })
  const borderWidthCapability = getTopicStyleFieldCapability('borderWidth', { borderEnabled })
  const effectiveBold = effectiveEmphasisValue((style) => isBoldTopicFontWeight(style?.fontWeight))
  const effectiveItalic = effectiveEmphasisValue((style) => style?.fontStyle === 'italic')
  const effectiveUnderline = effectiveEmphasisValue((style) =>
    hasTopicTextDecoration(style?.textDecoration, 'underline')
  )
  const effectiveStrikethrough = effectiveEmphasisValue((style) =>
    hasTopicTextDecoration(style?.textDecoration, 'line-through')
  )
  const effectiveTextTransform = effectiveEmphasisValue((style) => style?.textTransform ?? 'none')
  const effectiveTextAlign = resolveInspectorValue(
    selectedTopicEntries.map(({ topic, depth }) =>
      resolveEffectiveTopicStyle(topic.style, current!.theme, depth)?.textAlign
      ?? defaultTopicTextAlign(
        resolveEffectiveTopicStyle(topic.style, current!.theme, depth)?.structureClass
          ?? activeSheet!.layout.structureClass,
        depth
      )
    ),
    { absentState: 'inherited' }
  )
  const toggleTextDecoration = (
    flag: MindMapTextDecorationFlag,
    effectiveValue: InspectorValue<boolean>
  ): void => {
    const turnOn = effectiveValue.state === 'mixed'
      || effectiveValue.state !== 'concrete'
      || !effectiveValue.value
    dispatchStyleMutation((style, topic, depth) => {
      const effective = resolveEffectiveTopicStyle(topic.style, current!.theme, depth)?.textDecoration
      const next = updateTopicTextDecoration(effective, flag, turnOn)
      const inherited = normalizeTopicTextDecoration(
        topicStyleLayerForDepth(current!.theme, depth)?.textDecoration
      )
      if (next === inherited) delete style.textDecoration
      else style.textDecoration = next
      return style
    })
  }
  const structureClass = fieldValue('structureClass')
  const widthMode = fieldValue('widthMode')
  const width = fieldValue('width')
  const widthModeValue = widthMode.state === 'concrete' ? widthMode.value : widthMode.state === 'mixed' ? MIXED_VALUE : (widthMode.state === 'inherited' || widthMode.state === 'default' ? '' : '')
  const fixedWidthActive = widthMode.state === 'concrete' && widthMode.value === 'fixed'
  const widthInputValue = width.state === 'concrete' ? width.value : ''
  const effectiveStructureClass = structureClass.state === 'concrete'
    ? structureClass.value
    : structureClass.state === 'inherited'
      ? activeSheet?.layout.structureClass
      : null
  const hasAnyStyle = selectedTopics.some((topic) => topic.style && Object.keys(topic.style).length > 0)
  const heading = selectedTopics.length === 1
    ? selectedTopics[0].title || t('mindmap.untitledTopic')
    : t('mindmap.topicStyle.multiSelection', { count: selectedTopics.length })

  return (
    <section className="mindmap-topic-style mm-section" aria-labelledby="mindmap-topic-style-title">
      <div className="mm-section__head">
        <strong id="mindmap-topic-style-title">{t('mindmap.topicStyle.title')}</strong>
        <div className="mindmap-topic-style__heading-actions">
          <span className="mm-section__hint" title={heading}>{heading}</span>
          {hasAnyStyle ? (
            <button
              type="button"
              className="mindmap-topic-style__reset"
              onClick={resetStyles}
              title={t('mindmap.topicStyle.reset')}
              aria-label={t('mindmap.topicStyle.reset')}
            >
              <RotateCcw size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mm-subhead">{t('mindmap.topicStyle.styleSection')}</div>
      <div className="mm-row mm-row--stack">
        <span className="mm-row__label">{t('mindmap.topicStyle.quickStyle')}</span>
        <div
          className="mindmap-topic-style__quick-styles"
          role="group"
          aria-label={t('mindmap.topicStyle.quickStyle')}
        >
          {([
            'default',
            'important',
            'very-important',
            'strikethrough'
          ] as const satisfies readonly MindMapQuickStylePreset[]).map((preset) => (
            <button
              type="button"
              key={preset}
              className={`mindmap-topic-style__quick-style mindmap-topic-style__quick-style--${preset}`}
              onClick={() => applyQuickStyle(selectedTopics.map((topic) => topic.id), preset)}
            >
              {t(`mindmap.topicStyle.quickStyles.${preset}`)}
            </button>
          ))}
        </div>
        <span className="mindmap-topic-style__hint">{t('mindmap.topicStyle.quickStyleHint')}</span>
      </div>
      <MindMapTopicShapePicker
        value={shape}
        onChange={(nextShape) => updateStyleField('shape', nextShape)}
      />
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-width-mode">
          {t('mindmap.topicStyle.nodeWidth')}
        </label>
        <select
          id="mindmap-topic-style-width-mode"
          className="mm-select"
          value={widthModeValue}
          onChange={(event) => {
            const next = event.currentTarget.value
            if (next === MIXED_VALUE) return
            if (next === 'fixed') {
              const currentWidth = width.state === 'concrete' ? width.value : 160
              dispatchStyleMutation((style) => {
                style.widthMode = 'fixed'
                style.width = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, currentWidth))
                return style
              })
            } else if (next === 'auto') {
              dispatchStyleMutation((style) => {
                style.widthMode = 'auto'
                delete style.width
                return style
              })
            } else if (next === '') {
              dispatchStyleMutation((style) => {
                delete style.widthMode
                delete style.width
                return style
              })
            }
          }}
        >
          {widthMode.state === 'mixed' ? <option value={MIXED_VALUE} disabled>{t('mindmap.topicStyle.mixed')}</option> : null}
          <option value="">{t('mindmap.topicStyle.inherit')}</option>
          <option value="auto">{t('mindmap.topicStyle.widthAuto')}</option>
          <option value="fixed">{t('mindmap.topicStyle.widthFixed')}</option>
        </select>
      </div>
      {fixedWidthActive ? (
        <div className="mm-row">
          <label className="mm-row__label" htmlFor="mindmap-topic-style-width">
            {t('mindmap.topicStyle.nodeWidth')}
          </label>
          <div className="mindmap-topic-style__number-field">
            <input
              id="mindmap-topic-style-width"
              className="mm-number-input"
              type="number"
              min={WIDTH_MIN}
              max={WIDTH_MAX}
              step="1"
              value={widthInputValue}
              placeholder={width.state === 'mixed' ? t('mindmap.topicStyle.mixed') : '160'}
              onChange={(event) => {
                const next = Number(event.currentTarget.value)
                if (Number.isFinite(next) && next >= WIDTH_MIN && next <= WIDTH_MAX) {
                  updateStyleField('width', next)
                }
              }}
            />
            <span aria-hidden="true">px</span>
          </div>
        </div>
      ) : null}
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-fill-pattern">
          {t('mindmap.topicStyle.fillPattern')}
        </label>
        <select
          id="mindmap-topic-style-fill-pattern"
          className="mm-select"
          value={selectValue(fillPattern)}
          onChange={(event) => {
            if (event.currentTarget.value !== MIXED_VALUE) {
              updateStyleField(
                'fillPattern',
                event.currentTarget.value
                  ? event.currentTarget.value as NonNullable<MindMapTopicStyleOverride['fillPattern']>
                  : undefined
              )
            }
          }}
        >
          {fillPattern.state === 'mixed' ? <option value={MIXED_VALUE} disabled>{t('mindmap.topicStyle.mixed')}</option> : null}
          <option value="">{t('mindmap.topicStyle.inherit')}</option>
          {FILL_PATTERN_OPTIONS.map((option) => (
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
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-border-style">
          {t('mindmap.topicStyle.borderStyle')}
        </label>
        <select
          id="mindmap-topic-style-border-style"
          className="mm-select"
          value={selectValue(borderStyle)}
          onChange={(event) => {
            if (event.currentTarget.value !== MIXED_VALUE) {
              updateStyleField(
                'borderStyle',
                event.currentTarget.value
                  ? event.currentTarget.value as NonNullable<MindMapTopicStyleOverride['borderStyle']>
                  : undefined
              )
            }
          }}
        >
          {borderStyle.state === 'mixed' ? <option value={MIXED_VALUE} disabled>{t('mindmap.topicStyle.mixed')}</option> : null}
          <option value="">{t('mindmap.topicStyle.inherit')}</option>
          {BORDER_STYLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`mindmap.topicStyle.${option.labelKey}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="mm-row mm-row--stack">
        <span className="mm-row__label">{t('mindmap.topicStyle.strokeColor')}</span>
        <fieldset
          className="mindmap-topic-style__border-field"
          disabled={borderStrokeCapability.disabled}
          aria-describedby={borderStrokeCapability.disabled ? 'mindmap-topic-border-disabled' : undefined}
        >
          {colorSwatchRow('stroke', FILL_COLOR_PRESETS, '#4A90D9')}
        </fieldset>
      </div>
      <div className="mm-row">
        <span className="mm-row__label">{t('mindmap.topicStyle.borderWidth')}</span>
        <fieldset
          className="mindmap-segmented mindmap-segmented--inline mindmap-topic-style__border-field"
          role="group"
          aria-label={t('mindmap.topicStyle.borderWidth')}
          disabled={borderWidthCapability.disabled}
          aria-describedby={borderWidthCapability.disabled ? 'mindmap-topic-border-disabled' : undefined}
        >
          {BORDER_WIDTH_OPTIONS.map((width) => {
            const selected = borderWidth.state === 'concrete' && Math.abs(borderWidth.value - width) < 0.001
            return (
              <button
                type="button"
                key={width}
                className={selected ? 'is-selected' : ''}
                aria-pressed={selected}
                onClick={() => updateStyleField('borderWidth', selected ? undefined : width)}
              >
                {width}
              </button>
            )
          })}
        </fieldset>
      </div>
      {borderStrokeCapability.disabled || borderWidthCapability.disabled ? (
        <span id="mindmap-topic-border-disabled" className="mindmap-topic-style__effective">
          {t('mindmap.topicStyle.borderDisabled')}
        </span>
      ) : null}

      <div className="mm-subhead">{t('mindmap.topicStyle.textSection')}</div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-fontfamily">
          {t('mindmap.topicStyle.fontFamily')}
        </label>
        <select
          id="mindmap-topic-style-fontfamily"
          className="mm-select"
          value={selectValue(fontFamily)}
          onChange={(event) => {
            if (event.currentTarget.value !== MIXED_VALUE) {
              updateStyleField('fontFamily', event.currentTarget.value || undefined)
            }
          }}
        >
          {fontFamily.state === 'mixed' ? <option value={MIXED_VALUE} disabled>{t('mindmap.topicStyle.mixed')}</option> : null}
          <option value="">{t('mindmap.topicStyle.inherit')}</option>
          {hasUnlistedLocalFont ? (
            <option value={fontFamily.value}>{t('mindmap.topicStyle.importedFont', { font: fontFamily.value })}</option>
          ) : null}
          {FONT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{t(`mindmap.topicStyle.${option.key}`)}</option>
          ))}
        </select>
        <span
          id="mindmap-topic-style-font-source"
          className="mindmap-topic-style__effective"
          data-font-source={resolvedFont.source}
          role="status"
          aria-label={resolvedFont.fontFamily
            ? t('mindmap.topicStyle.fontSourceWithFamily', {
              source: t(`mindmap.topicStyle.${FONT_SOURCE_LABEL_KEYS[resolvedFont.source]}`),
              font: resolvedFont.fontFamily
            })
            : t('mindmap.topicStyle.fontSource', {
              source: t(`mindmap.topicStyle.${FONT_SOURCE_LABEL_KEYS[resolvedFont.source]}`)
            })}
        >
          {resolvedFont.fontFamily
            ? t('mindmap.topicStyle.fontSourceWithFamily', {
              source: t(`mindmap.topicStyle.${FONT_SOURCE_LABEL_KEYS[resolvedFont.source]}`),
              font: resolvedFont.fontFamily
            })
            : t('mindmap.topicStyle.fontSource', {
              source: t(`mindmap.topicStyle.${FONT_SOURCE_LABEL_KEYS[resolvedFont.source]}`)
            })}
        </span>
        {resolvedFont.mayFallback ? (
          <span
            id="mindmap-topic-style-font-fallback"
            className="mindmap-topic-style__font-warning"
            role="status"
          >
            {t('mindmap.topicStyle.fontMayFallback')}
          </span>
        ) : null}
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-fontsize">
          {t('mindmap.topicStyle.fontSize')}
        </label>
        <div className="mindmap-topic-style__number-field">
          <input
            id="mindmap-topic-style-fontsize"
            className="mm-number-input"
            type="number"
            inputMode="decimal"
            list="mindmap-topic-style-fontsize-presets"
            min="0.1"
            max="512"
            step="any"
            value={fontSize.state === 'concrete' ? fontSize.value : ''}
            placeholder={fontSize.state === 'mixed'
              ? t('mindmap.topicStyle.mixed')
              : t('mindmap.topicStyle.inherit')}
            aria-describedby="mindmap-topic-style-fontsize-unit"
            onFocus={() => {
              fontSizeEditSession.current += 1
            }}
            onChange={(event) => {
              const rawValue = event.currentTarget.value
              const mergeKey = `topic-style:font-size:${selectedTopics.map((topic) => topic.id).sort().join(',')}:${fontSizeEditSession.current}`
              if (rawValue === '') {
                updateStyleField('fontSize', undefined, { mergeKey })
                return
              }
              const nextValue = Number(rawValue)
              if (Number.isFinite(nextValue) && nextValue > 0 && nextValue <= 512) {
                updateStyleField('fontSize', nextValue, { mergeKey })
              }
            }}
          />
          <span id="mindmap-topic-style-fontsize-unit" aria-hidden="true">px</span>
          <datalist id="mindmap-topic-style-fontsize-presets">
            {[10, 11, 12, 13, 14, 16, 18, 20, 24].map((size) => (
              <option key={size} value={size} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-fontweight">
          {t('mindmap.topicStyle.fontWeight')}
        </label>
        <select
          id="mindmap-topic-style-fontweight"
          className="mm-select"
          value={fontWeight.state === 'concrete'
            ? normalizeTopicFontWeight(fontWeight.value) ?? ''
            : selectValue(fontWeight)}
          onChange={(event) => {
            if (event.currentTarget.value !== MIXED_VALUE) {
              updateStyleField('fontWeight', event.currentTarget.value || undefined)
            }
          }}
        >
          {fontWeight.state === 'mixed' ? <option value={MIXED_VALUE} disabled>{t('mindmap.topicStyle.mixed')}</option> : null}
          <option value="">{t('mindmap.topicStyle.inherit')}</option>
          <option value="300">{t('mindmap.topicStyle.fontWeightLight')}</option>
          <option value="400">{t('mindmap.topicStyle.fontWeightRegular')}</option>
          <option value="500">{t('mindmap.topicStyle.fontWeightMedium')}</option>
          <option value="600">{t('mindmap.topicStyle.fontWeightSemibold')}</option>
          <option value="700">{t('mindmap.topicStyle.fontWeightBold')}</option>
        </select>
      </div>
      <div className="mm-row">
        <span className="mm-row__label">{t('mindmap.topicStyle.emphasis')}</span>
        <div
          className="mindmap-topic-style__text-toggles"
          role="group"
          aria-label={t('mindmap.topicStyle.emphasis')}
        >
          <button
            type="button"
            className={effectiveBold.state === 'concrete' && effectiveBold.value ? 'is-active' : ''}
            aria-pressed={effectiveBold.state === 'mixed' ? 'mixed' : effectiveBold.state === 'concrete' && effectiveBold.value}
            aria-label={effectiveBold.state === 'mixed'
              ? `${t('mindmap.topicStyle.bold')} — ${t('mindmap.topicStyle.mixed')}`
              : t('mindmap.topicStyle.bold')}
            title={t('mindmap.topicStyle.bold')}
            onClick={() => {
              const turnOn = effectiveBold.state === 'mixed' || effectiveBold.state !== 'concrete' || !effectiveBold.value
              dispatchStyleMutation((style, _topic, depth) => {
                if (turnOn) style.fontWeight = '700'
                else if (isBoldTopicFontWeight(topicStyleLayerForDepth(current!.theme, depth)?.fontWeight)) {
                  style.fontWeight = '400'
                } else {
                  delete style.fontWeight
                }
                return style
              })
            }}
          >
            <Bold size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={effectiveItalic.state === 'concrete' && effectiveItalic.value ? 'is-active' : ''}
            aria-pressed={effectiveItalic.state === 'mixed' ? 'mixed' : effectiveItalic.state === 'concrete' && effectiveItalic.value}
            aria-label={effectiveItalic.state === 'mixed'
              ? `${t('mindmap.topicStyle.italic')} — ${t('mindmap.topicStyle.mixed')}`
              : t('mindmap.topicStyle.italic')}
            title={t('mindmap.topicStyle.italic')}
            onClick={() => {
              const turnOn = effectiveItalic.state === 'mixed' || effectiveItalic.state !== 'concrete' || !effectiveItalic.value
              dispatchStyleMutation((style, _topic, depth) => {
                if (turnOn) style.fontStyle = 'italic'
                else if (topicStyleLayerForDepth(current!.theme, depth)?.fontStyle === 'italic') {
                  style.fontStyle = 'normal'
                } else {
                  delete style.fontStyle
                }
                return style
              })
            }}
          >
            <Italic size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={effectiveUnderline.state === 'concrete' && effectiveUnderline.value ? 'is-active' : ''}
            aria-pressed={effectiveUnderline.state === 'mixed' ? 'mixed' : effectiveUnderline.state === 'concrete' && effectiveUnderline.value}
            aria-label={effectiveUnderline.state === 'mixed'
              ? `${t('mindmap.topicStyle.underline')} — ${t('mindmap.topicStyle.mixed')}`
              : t('mindmap.topicStyle.underline')}
            title={t('mindmap.topicStyle.underline')}
            onClick={() => toggleTextDecoration('underline', effectiveUnderline)}
          >
            <Underline size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={effectiveStrikethrough.state === 'concrete' && effectiveStrikethrough.value ? 'is-active' : ''}
            aria-pressed={effectiveStrikethrough.state === 'mixed' ? 'mixed' : effectiveStrikethrough.state === 'concrete' && effectiveStrikethrough.value}
            aria-label={effectiveStrikethrough.state === 'mixed'
              ? `${t('mindmap.topicStyle.strikethrough')} — ${t('mindmap.topicStyle.mixed')}`
              : t('mindmap.topicStyle.strikethrough')}
            title={t('mindmap.topicStyle.strikethrough')}
            onClick={() => toggleTextDecoration('line-through', effectiveStrikethrough)}
          >
            <Strikethrough size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-text-transform">
          {t('mindmap.topicStyle.textTransform')}
        </label>
        <select
          id="mindmap-topic-style-text-transform"
          className="mm-select"
          value={selectValue(effectiveTextTransform)}
          onChange={(event) => {
            if (event.currentTarget.value === MIXED_VALUE) return
            if (event.currentTarget.value === '') {
              updateStyleField('textTransform', undefined)
              return
            }
            const next = event.currentTarget.value as NonNullable<MindMapTopicStyleOverride['textTransform']>
            dispatchStyleMutation((style, _topic, depth) => {
              const inherited = topicStyleLayerForDepth(current!.theme, depth)?.textTransform
              if (next === inherited || next === 'none' && inherited === undefined) {
                delete style.textTransform
              } else {
                style.textTransform = next
              }
              return style
            })
          }}
        >
          {effectiveTextTransform.state === 'mixed' ? (
            <option value={MIXED_VALUE} disabled>{t('mindmap.topicStyle.mixed')}</option>
          ) : null}
          <option value="">{t('mindmap.topicStyle.inherit')}</option>
          {TEXT_TRANSFORM_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`mindmap.topicStyle.${option.labelKey}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-text-align">
          {t('mindmap.topicStyle.textAlign')}
        </label>
        <select
          id="mindmap-topic-style-text-align"
          className="mm-select"
          value={selectValue(effectiveTextAlign)}
          onChange={(event) => {
            if (event.currentTarget.value === MIXED_VALUE) return
            if (event.currentTarget.value === '') {
              updateStyleField('textAlign', undefined)
              return
            }
            const next = event.currentTarget.value as NonNullable<MindMapTopicStyleOverride['textAlign']>
            dispatchStyleMutation((style, topic, depth) => {
              const inherited = topicStyleLayerForDepth(current!.theme, depth)?.textAlign
                ?? defaultTopicTextAlign(
                  resolveEffectiveTopicStyle(topic.style, current!.theme, depth)?.structureClass
                    ?? activeSheet!.layout.structureClass,
                  depth
                )
              if (next === inherited) delete style.textAlign
              else style.textAlign = next
              return style
            })
          }}
        >
          {effectiveTextAlign.state === 'mixed' ? (
            <option value={MIXED_VALUE} disabled>{t('mindmap.topicStyle.mixed')}</option>
          ) : null}
          <option value="">{t('mindmap.topicStyle.inherit')}</option>
          {TEXT_ALIGN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`mindmap.topicStyle.${option.labelKey}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="mm-row mm-row--stack">
        <span className="mm-row__label">{t('mindmap.topicStyle.textColor')}</span>
        {colorSwatchRow('textColor', TEXT_COLOR_PRESETS, '#333333')}
      </div>

      <div className="mm-subhead">{t('mindmap.topicStyle.layoutSection')}</div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-layout">
          {t('mindmap.topicStyle.layoutLabel')}
        </label>
        <select
          id="mindmap-topic-style-layout"
          className="mm-select"
          value={selectValue(structureClass)}
          onChange={(event) => {
            if (event.currentTarget.value !== MIXED_VALUE) {
              updateStyleField(
                'structureClass',
                event.currentTarget.value
                  ? event.currentTarget.value as MindMapStructureClass
                  : undefined
              )
            }
          }}
        >
          {structureClass.state === 'mixed' ? <option value={MIXED_VALUE} disabled>{t('mindmap.topicStyle.mixed')}</option> : null}
          <option value="">{t('mindmap.topicStyle.inheritLayout')}</option>
          {MIND_MAP_TOPIC_STYLE_LAYOUT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`mindmap.topicStyle.layouts.${option.labelKey}`)}
            </option>
          ))}
        </select>
      </div>
      {structureClass.state === 'mixed' ? (
        <span className="mindmap-topic-style__effective">{t('mindmap.topicStyle.effectiveMixed')}</span>
      ) : effectiveStructureClass ? (
        <span className="mindmap-topic-style__effective">
          {t('mindmap.topicStyle.effective', {
            layout: topicStyleLayoutLabel(t, effectiveStructureClass)
          })}
        </span>
      ) : null}

      {selectedTopics.length === 1 ? (
        <>
          <div className="mm-subhead">{t('mindmap.topicStyle.propagationSection')}</div>
          <div className="mindmap-topic-style__propagation-actions">
            <button
              type="button"
              disabled={siblingCount === 0}
              onClick={() => propagateStyle('siblings')}
            >
              {t('mindmap.topicStyle.applyToSiblings', { count: siblingCount })}
            </button>
            <button
              type="button"
              disabled={descendantCount === 0}
              onClick={() => propagateStyle('descendants')}
            >
              {t('mindmap.topicStyle.applyToDescendants', { count: descendantCount })}
            </button>
          </div>
          <span className="mindmap-topic-style__effective">
            {t('mindmap.topicStyle.propagationHint')}
          </span>
        </>
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
  return option ? t(`mindmap.topicStyle.layouts.${option.labelKey}`) : structureClass
}

function findMindMapTopic(
  node: MindMapTopicV2,
  id: string,
  depth = 0
): { topic: MindMapTopicV2; depth: number } | null {
  if (node.id === id) return { topic: node, depth }
  for (const child of node.children) {
    const found = findMindMapTopic(child, id, depth + 1)
    if (found) return found
  }
  return null
}

function countDescendants(node: MindMapTopicV2): number {
  return node.children.reduce(
    (count, child) => count + 1 + countDescendants(child),
    0
  )
}
