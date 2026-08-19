import { useRef, type CSSProperties } from 'react'
import { Bold, Italic, Strikethrough, Underline } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'
import type { MindMapTopicStyleOverride, MindMapTopicNumbering, MindMapTopicV2, MindMapTextSpanStyle } from '../../../../shared/mindmap/domain/types'
import type { MindMapCommand } from '../../../../shared/mindmap/commands/mind-map-command-types'
import type { MindMapExecuteOptions } from '../../../../shared/mindmap/commands/mind-map-undo-redo'
import { resolveInspectorValue, resolveTopicStyleField, type InspectorValue } from './mind-map-inspector-values'
import { getTopicStyleFieldCapability } from './mind-map-inspector-capabilities'
import {
  buildPropagateTopicStyleCommand,
  buildPropagateTopicNumberingCommand,
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
import { fontEntryLabel, SAFE_FONTS } from './mind-map-font-list'
import { MindMapFontPicker } from './MindMapThemePanel'
import { MindMapTopicShapePicker } from './MindMapTopicShapePicker'
import { MindMapTopicColorPicker, MindMapTopicStyleMenu } from './MindMapTopicStyleMenu'
import { resolveTopicDisplayStyle, DEFAULT_TOPIC_FONT_FAMILY } from './mind-map-topic-display-style'
import { branchColorForKey } from './mind-map-branch-colors'

type MindMapTopicStyleLayoutOption = {
  value: MindMapStructureClass
  labelKey: 'right' | 'balanced' | 'left' | 'map' | 'down' | 'up'
}

const MIXED_VALUE = '__mixed__'

const TOPIC_STYLE_DEFAULTS = {
  fill: '#F8F7F7',
  stroke: '#8E8E93',
  textColor: '#24324A'
} as const

const NUMBERING_PATTERN_OPTIONS = [
  { value: 'none', labelKey: 'patternNone' },
  { value: 'arabic', labelKey: 'patternArabic' },
  { value: 'uppercase', labelKey: 'patternUppercase' },
  { value: 'lowercase', labelKey: 'patternLowercase' },
  { value: 'roman', labelKey: 'patternRoman' }
] as const satisfies readonly {
  value: NonNullable<MindMapTopicNumbering['pattern']>
  labelKey: string
}[]

const NUMBERING_RESTART_MIN = 1
const NUMBERING_RESTART_MAX = 9999

const MIND_MAP_TOPIC_STYLE_LAYOUT_OPTIONS: readonly MindMapTopicStyleLayoutOption[] = [
  { value: 'studiumx.layout.logic.right', labelKey: 'right' },
  { value: 'studiumx.layout.logic.balanced', labelKey: 'balanced' },
  { value: 'studiumx.layout.logic.left', labelKey: 'left' },
  { value: 'studiumx.layout.logic.map', labelKey: 'map' },
  { value: 'studiumx.layout.logic.down', labelKey: 'down' },
  { value: 'studiumx.layout.logic.up', labelKey: 'up' }
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

/** Topic formatting for a single topic or a multi-selection. */
export function MindMapTopicStyleInspector() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const selection = useMindMapViewStore((state) => state.selection)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)
  const setTopicChildrenCollapsed = useMindMapViewStore((state) => state.setTopicChildrenCollapsed)
  const setSiblingTopicsCollapsed = useMindMapViewStore((state) => state.setSiblingTopicsCollapsed)
  const fontSizeEditSession = useRef(0)
  const richTextSelection = useMindMapViewStore((state) => state.richTextSelection)
  const richTextSelectionActive = useMindMapViewStore((state) => state.richTextSelectionActive)
  const richTextTarget = useMindMapViewStore((state) => state.richTextTarget)
  const requestRichTextStyle = useMindMapViewStore((state) => state.requestRichTextStyle)

  const activeSheet =
    current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0] ?? null
  const selectedTopicEntries = activeSheet && selection.kind === 'topic'
    ? selection.topicIds
        .map((id) => findMindMapTopic(activeSheet.root, id, activeSheet.layout.structureClass))
        .filter((entry): entry is { topic: MindMapTopicV2; depth: number; branchIndex: number; branchKey: string; structureClass: MindMapStructureClass } => entry !== null)
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

  const selectedTopicRef = activeSheet && selectedTopics.length === 1
    ? findTopicInSheet(activeSheet, selectedTopics[0].id)
    : undefined
  const siblingCount = selectedTopicRef?.parent?.children.filter(
    (topic) => topic.id !== selectedTopicRef.node.id
  ).length ?? 0
  const currentTopicHasChildren = (selectedTopicRef?.node.children.length ?? 0) > 0
  const siblingBranchTopics = selectedTopicRef?.parent?.children.filter(
    (topic) => topic.children.length > 0
  ) ?? []
  const canToggleSiblingChildren = selectedTopicRef?.parent !== null
    && selectedTopicRef?.parent !== undefined
    && siblingCount > 0
    && siblingBranchTopics.length > 0
  const siblingChildrenCollapsed = siblingBranchTopics.length > 0
    && siblingBranchTopics.every((topic) => topic.collapsed === true)
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

  // Numbering is single-selection only; the topic's own config applies to its
  // children. `undefined` means "inherit" (no local override).
  const numbering = selectedTopics.length === 1 ? selectedTopics[0].numbering : undefined
  const numberingPattern = numbering?.pattern
  const hasConcreteNumberingPattern =
    numberingPattern !== undefined && numberingPattern !== 'none'
  const numberingTieredActive = numbering?.tiered === true
  const numberingRestartActive = numbering?.restartAt !== undefined

  const updateNumbering = (next: MindMapTopicNumbering | null): void => {
    if (!activeSheet || selectedTopics.length !== 1) return
    dispatchCommand(
      {
        type: 'topic.update',
        sheetId: activeSheet.id,
        topicId: selectedTopics[0].id,
        patch: { numbering: next }
      },
      { label: 'Update topic numbering' }
    )
  }

  const changeNumberingPattern = (value: string): void => {
    if (value === '') {
      updateNumbering(null)
      return
    }
    if (value === 'none') {
      updateNumbering({ pattern: 'none' })
      return
    }
    const pattern = value as NonNullable<MindMapTopicNumbering['pattern']>
    updateNumbering({ ...(numbering ?? {}), pattern })
  }

  const toggleNumberingTiered = (): void => {
    if (!hasConcreteNumberingPattern) return
    updateNumbering({
      ...(numbering ?? {}),
      pattern: numberingPattern,
      tiered: !numberingTieredActive
    })
  }

  const toggleNumberingRestart = (): void => {
    if (!hasConcreteNumberingPattern) return
    if (numberingRestartActive) {
      const { restartAt: _ignored, ...rest } = numbering ?? {}
      void _ignored
      updateNumbering({ ...rest, pattern: numberingPattern })
    } else {
      updateNumbering({ ...(numbering ?? {}), pattern: numberingPattern, restartAt: 1 })
    }
  }

  const changeNumberingRestartAt = (value: number): void => {
    if (!hasConcreteNumberingPattern) return
    if (!Number.isFinite(value) || value < NUMBERING_RESTART_MIN || value > NUMBERING_RESTART_MAX) {
      return
    }
    updateNumbering({ ...(numbering ?? {}), pattern: numberingPattern, restartAt: Math.trunc(value) })
  }

  const applyNumberingToSiblings = (): void => {
    if (!activeSheet || !selectedTopicRef) return
    const command = buildPropagateTopicNumberingCommand(activeSheet, selectedTopicRef.node.id)
    if (!command) return
    dispatchCommand(command, { label: 'Apply numbering to siblings' })
  }

  if (!hasSelection) {
    return (
      <section className="mindmap-topic-style mm-section">
        <p className="mindmap-topic-style__empty">{t('mindmap.topicStyle.noSelection')}</p>
      </section>
    )
  }

  const fieldValue = <K extends keyof MindMapTopicStyleOverride>(field: K) =>
    resolveTopicStyleField(selectedTopics, field)
  const effectiveFieldValue = <T,>(
    resolve: (style: ReturnType<typeof resolveTopicDisplayStyle>) => T
  ): InspectorValue<T> => resolveInspectorValue(
    selectedTopicEntries.map(({ topic, depth, branchKey, structureClass }) =>
      resolve(resolveTopicDisplayStyle(topic.style, current!.theme, depth, {
        branchColor: branchColorForKey(current!.theme, branchKey),
        structureClass,
        darkAppearance: document.documentElement.dataset.resolvedTheme === 'dark'
      }))
    ),
    { absentState: 'inherited' }
  )
  const selectValue = <T extends string | number>(value: InspectorValue<T>): string => {
    if (value.state === 'mixed') return MIXED_VALUE
    if (value.state === 'concrete') return String(value.value)
    if (value.state === 'none') return 'none'
    return ''
  }
  const effectiveEmphasisValue = <T,>(
    resolve: (style: MindMapTopicStyleOverride | undefined) => T
  ): InspectorValue<T> => resolveInspectorValue(
    selectedTopicEntries.map(({ topic, depth }) =>
      resolve(resolveEffectiveTopicStyle(topic.style, current!.theme, depth))
    ),
    { absentState: 'inherited' }
  )

  const shape = fieldValue('shape')
  const effectiveShape = effectiveFieldValue((style) => style.shape)
  const fillPattern = fieldValue('fillPattern')
  const effectiveFillPattern = effectiveFieldValue((style) => style.fillPattern)
  const fillColor = fieldValue('fill')
  const effectiveFillColor = effectiveFieldValue((style) => style.fill)
  const strokeColor = fieldValue('stroke')
  const effectiveStrokeColor = effectiveFieldValue((style) => style.stroke)
  const textColor = fieldValue('textColor')
  const effectiveTextColor = effectiveFieldValue((style) => style.textColor)
  const effectiveFontFamily = effectiveFieldValue((style) => style.fontFamily)
  const resolvedFont = resolveSelectedTopicFontProvenance(
    selectedTopicEntries.map(({ topic, depth }) => ({ nodeStyle: topic.style, depth })),
    current!.theme
  )
  const effectiveFontSize = effectiveFieldValue((style) => style.fontSize)
  const effectiveFontWeight = effectiveFieldValue((style) => style.fontWeight)
  const borderStyle = fieldValue('borderStyle')
  const effectiveBorderStyle = effectiveFieldValue((style) => style.borderStyle)
  const borderWidth = fieldValue('borderWidth')
  const effectiveBorderWidth = effectiveFieldValue((style) => style.borderWidth)
  const effectiveBorderStyles = selectedTopicEntries.map(({ topic, depth, branchKey, structureClass }) =>
    resolveTopicDisplayStyle(topic.style, current!.theme, depth, {
      branchColor: branchColorForKey(current!.theme, branchKey),
      structureClass,
      darkAppearance: document.documentElement.dataset.resolvedTheme === 'dark'
    }).borderStyle
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

  // --- Selection-targeted text formatting ---------------------------------
  // When a rich text selection is active in the inline editor (and the single
  // selected topic is the one being edited), the text-property controls below
  // edit the *selected span* instead of the whole topic style. They display
  // the selection's values and dispatch one-shot span style requests that the
  // canvas forwards to the live editor.
  const selectionActiveForTopic =
    richTextSelectionActive === true &&
    richTextTarget?.kind === 'node' &&
    selectedTopics.length === 1 &&
    selectedTopics[0]!.id === richTextTarget.nodeId
  const selectedRichText = selectionActiveForTopic ? richTextSelection : null

  const inspectorConcrete = <T,>(value: T | undefined): InspectorValue<T> =>
    value === undefined ? { state: 'inherited' } : { state: 'concrete', value }

  // Display overrides while a selection is active (reflect the selected span).
  const selTextColor = selectedRichText
    ? inspectorConcrete(selectedRichText.color)
    : effectiveTextColor
  const selFontFamily = selectedRichText
    ? inspectorConcrete(selectedRichText.fontFamily)
    : effectiveFontFamily
  const selFontSize = selectedRichText
    ? inspectorConcrete(selectedRichText.fontSize)
    : effectiveFontSize
  const selBold = selectedRichText
    ? inspectorConcrete(selectedRichText.bold)
    : effectiveBold
  const selItalic = selectedRichText
    ? inspectorConcrete(selectedRichText.italic)
    : effectiveItalic
  const selUnderline = selectedRichText
    ? inspectorConcrete(selectedRichText.underline)
    : effectiveUnderline
  const selStrikethrough = selectedRichText
    ? inspectorConcrete(selectedRichText.strikethrough)
    : effectiveStrikethrough
  // The panel's weight select only carries bold/non-bold semantics at span
  // level, so a selection maps to the closest weight tokens.
  const selFontWeight = selectedRichText
    ? inspectorConcrete(selectedRichText.bold ? '700' : '400')
    : effectiveFontWeight
  // Show the real font the canvas renders: an explicit span/topic stack when
  // set, otherwise the effective inherited stack (never a "default" label).
  const fontStackLabel = (stack: string): string =>
    SAFE_FONTS.some((entry) => entry.stack === stack)
      ? fontEntryLabel(SAFE_FONTS.find((entry) => entry.stack === stack)!, t)
      : t('mindmap.topicStyle.importedFont', { font: stack })
  const selFontFamilyLabel =
    selFontFamily.state === 'mixed'
      ? t('mindmap.topicStyle.mixed')
      : selFontFamily.state === 'concrete'
        ? fontStackLabel(selFontFamily.value)
        : fontStackLabel(
            effectiveFontFamily.state === 'concrete'
              ? effectiveFontFamily.value
              : DEFAULT_TOPIC_FONT_FAMILY
          )

  /** Route a text-property change to the selected span, or fall back to the
   *  whole-topic style mutation when no selection is active. */
  const applyTextProperty = (
    style: MindMapTextSpanStyle,
    fallback: () => void,
    toggle = false
  ): void => {
    if (selectionActiveForTopic) {
      requestRichTextStyle(style, toggle)
      return
    }
    fallback()
  }

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
  const effectiveStructureClassValue = effectiveFieldValue((style) => style.structureClass)
  const effectiveStructureClassLabel = effectiveStructureClassValue.state === 'mixed'
    ? t('mindmap.topicStyle.mixed')
    : effectiveStructureClassValue.state === 'concrete'
      ? t(`mindmap.topicStyle.layouts.${
          MIND_MAP_TOPIC_STYLE_LAYOUT_OPTIONS.find(
            (option) => option.value === effectiveStructureClassValue.value
          )?.labelKey ?? 'right'
        }`)
      : null
  const fontProvenanceLabel = (() => {
    switch (resolvedFont.source) {
      case 'local':
        return t('mindmap.topicStyle.fontSourceLocal', { font: resolvedFont.fontFamily })
      case 'document':
        return t('mindmap.topicStyle.fontSourceDocument', { font: resolvedFont.fontFamily })
      case 'theme-layer':
        return t('mindmap.topicStyle.fontSourceThemeLayer', { font: resolvedFont.fontFamily })
      case 'mixed':
        return t('mindmap.topicStyle.fontSourceMixed')
      default:
        return t('mindmap.topicStyle.fontSourceAppFallback')
    }
  })()
  return (
    <section className="mindmap-topic-style mm-section">
      <div className="mm-subhead">{t('mindmap.topicStyle.styleSection')}</div>
      <div className="mindmap-topic-style__title">{t('mindmap.topicStyle.title')}</div>
      {selectedTopics.length > 1 ? (
        <p className="mindmap-topic-style__selection-count">
          {t('mindmap.topicStyle.multiSelection', { count: selectedTopics.length })}
        </p>
      ) : null}
      <MindMapTopicShapePicker
        value={shape}
        displayValue={effectiveShape}
        onChange={(nextShape) => updateStyleField('shape', nextShape)}
      />
      <MindMapTopicStyleMenu
        id="mindmap-topic-style-fill-pattern"
        label={t('mindmap.topicStyle.fillPattern')}
        value={fillPattern}
        displayValue={effectiveFillPattern}
        options={FILL_PATTERN_OPTIONS.map((option) => ({
          value: option.value,
          label: t(`mindmap.topicStyle.${option.labelKey}`)
        }))}
        onChange={(nextPattern) => updateStyleField('fillPattern', nextPattern)}
        className="mindmap-topic-style-menu--pattern"
        optionsClassName="mindmap-topic-style-menu__options--patterns"
        optionClassName="mindmap-topic-style-menu__option--pattern"
        renderPreview={(selected, state) => (
          <span
            className={`mindmap-topic-style-menu__pattern-preview mindmap-topic-style-menu__pattern-preview--${state.state === 'mixed' ? 'mixed' : selected ?? 'inherit'}`}
          />
        )}
        renderOption={(option) => (
          <>
            <span
              className={`mindmap-topic-style-menu__pattern-preview mindmap-topic-style-menu__pattern-preview--${option.value}`}
              aria-hidden="true"
            />
            <span>{option.label}</span>
          </>
        )}
      />
      <MindMapTopicColorPicker
        id="mindmap-topic-style-fill-color"
        label={t('mindmap.topicStyle.fillColor')}
        value={fillColor}
        displayValue={effectiveFillColor}
        presets={FILL_COLOR_PRESETS}
        fallback={TOPIC_STYLE_DEFAULTS.fill}
        onChange={(nextColor) => updateStyleField('fill', nextColor)}
      />
      <MindMapTopicStyleMenu
        id="mindmap-topic-style-border-style"
        label={t('mindmap.topicStyle.borderStyle')}
        value={borderStyle}
        displayValue={effectiveBorderStyle}
        options={BORDER_STYLE_OPTIONS.map((option) => ({
          value: option.value,
          label: t(`mindmap.topicStyle.${option.labelKey}`)
        }))}
        onChange={(nextBorderStyle) => updateStyleField('borderStyle', nextBorderStyle)}
        className="mindmap-topic-style-menu--border"
        optionsClassName="mindmap-topic-style-menu__options--border"
        optionClassName="mindmap-topic-style-menu__option--border"
        renderPreview={(selected, state) => (
          <span
            className={`mindmap-topic-style-menu__border-preview mindmap-topic-style-menu__border-preview--${state.state === 'mixed' ? 'mixed' : selected ?? 'inherit'}`}
          />
        )}
        renderOption={(option) => (
          <>
            <span
              className={`mindmap-topic-style-menu__border-preview mindmap-topic-style-menu__border-preview--${option.value}`}
              aria-hidden="true"
            />
            <span>{option.label}</span>
          </>
        )}
      />
      <fieldset
        className="mindmap-topic-style__border-field"
        disabled={borderStrokeCapability.disabled}
      >
        <MindMapTopicColorPicker
          id="mindmap-topic-style-border-color"
          label={t('mindmap.topicStyle.strokeColor')}
          value={strokeColor}
          displayValue={effectiveStrokeColor}
          presets={FILL_COLOR_PRESETS}
          fallback={TOPIC_STYLE_DEFAULTS.stroke}
          disabled={borderStrokeCapability.disabled}
          onChange={(nextColor) => updateStyleField('stroke', nextColor)}
        />
      </fieldset>
      <fieldset
        className="mindmap-topic-style__border-field"
        disabled={borderWidthCapability.disabled}
      >
        <MindMapTopicStyleMenu
          id="mindmap-topic-style-border-width"
          label={t('mindmap.topicStyle.borderWidth')}
          value={borderWidth}
          displayValue={effectiveBorderWidth}
          options={[
            ...BORDER_WIDTH_OPTIONS,
            ...(borderWidth.state === 'concrete' && !BORDER_WIDTH_OPTIONS.some(
              (width) => Math.abs(width - borderWidth.value) < 0.001
            ) ? [borderWidth.value] : [])
          ].map((width) => ({ value: width, label: String(width) }))}
          disabled={borderWidthCapability.disabled}
          onChange={(nextWidth) => updateStyleField('borderWidth', nextWidth)}
          className="mindmap-topic-style-menu--border-width"
          optionsClassName="mindmap-topic-style-menu__options--border-width"
          optionClassName="mindmap-topic-style-menu__option--border-width"
          renderPreview={(selected, state) => (
            <span
              className="mindmap-topic-style-menu__width-preview"
              style={{ '--mindmap-topic-style-width': `${state.state === 'mixed' ? 2 : selected ?? 1}px` } as CSSProperties}
            />
          )}
          renderOption={(option) => (
            <>
              <span
                className="mindmap-topic-style-menu__width-preview"
                style={{ '--mindmap-topic-style-width': `${option.value}px` } as CSSProperties}
                aria-hidden="true"
              />
              <span>{option.label}</span>
            </>
          )}
        />
      </fieldset>
      {!borderEnabled ? (
        <p className="mindmap-topic-style__disabled-note">
          {t('mindmap.topicStyle.borderDisabled')}
        </p>
      ) : null}

      <div className="mm-subhead">{t('mindmap.topicStyle.textSection')}</div>
      <div className="mm-row">
        <span className="mm-row__label">{t('mindmap.topicStyle.fontFamily')}</span>
        <MindMapFontPicker
          value={selFontFamily.state === 'concrete' ? selFontFamily.value : undefined}
          currentLabel={selFontFamilyLabel}
          ariaLabel={t('mindmap.topicStyle.fontFamily')}
          onSelect={(stack) => applyTextProperty(
            { fontFamily: stack || undefined },
            () => updateStyleField('fontFamily', stack || undefined)
          )}
          searchPlaceholder="Search fonts…"
          searchLabel="Search fonts"
          noResultsLabel="No fonts found."
        />
        <span
          className="mindmap-topic-style__font-provenance"
          role="status"
          aria-label={fontProvenanceLabel}
        >
          {fontProvenanceLabel}
        </span>
        {resolvedFont.mayFallback ? (
          <span
            id="mindmap-topic-style-font-fallback"
            className="mindmap-topic-style__font-warning"
          >
            {t('mindmap.topicStyle.fontMayFallback')}
          </span>
        ) : null}
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-fontsize">
          {t('mindmap.topicStyle.fontSize')}
        </label>
        <label
          className="mindmap-spacing-field mindmap-spacing-field--wide"
          htmlFor="mindmap-topic-style-fontsize"
        >
          <input
            id="mindmap-topic-style-fontsize"
            className="mm-number-input"
            type="number"
            inputMode="decimal"
            min="0.1"
            max="512"
            step="any"
            value={selFontSize.state === 'concrete' ? selFontSize.value : ''}
            placeholder={selFontSize.state === 'mixed'
              ? t('mindmap.topicStyle.mixed')
              : undefined}
            aria-describedby="mindmap-topic-style-fontsize-unit"
            onFocus={() => {
              fontSizeEditSession.current += 1
            }}
            onChange={(event) => {
              const rawValue = event.currentTarget.value
              const mergeKey = `topic-style:font-size:${selectedTopics.map((topic) => topic.id).sort().join(',')}:${fontSizeEditSession.current}`
              if (rawValue === '') {
                applyTextProperty(
                  { fontSize: undefined },
                  () => updateStyleField('fontSize', undefined, { mergeKey })
                )
                return
              }
              const nextValue = Number(rawValue)
              if (Number.isFinite(nextValue) && nextValue > 0 && nextValue <= 512) {
                applyTextProperty(
                  { fontSize: nextValue },
                  () => updateStyleField('fontSize', nextValue, { mergeKey })
                )
              }
            }}
          />
          <span id="mindmap-topic-style-fontsize-unit" aria-hidden="true">px</span>
        </label>
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-fontweight">
          {t('mindmap.topicStyle.fontWeight')}
        </label>
        <select
          id="mindmap-topic-style-fontweight"
          className="mm-select"
          value={selFontWeight.state === 'concrete'
            ? normalizeTopicFontWeight(selFontWeight.value) ?? ''
            : selectValue(selFontWeight)}
          onChange={(event) => {
            if (event.currentTarget.value === MIXED_VALUE) return
            const next = event.currentTarget.value as string
            applyTextProperty(
              { bold: next === '' ? undefined : Number(next) >= 600 },
              () => updateStyleField('fontWeight', next || undefined)
            )
          }}
        >
          {selFontWeight.state === 'mixed' ? <option value={MIXED_VALUE} disabled>{t('mindmap.topicStyle.mixed')}</option> : null}
          <option value="300">{t('mindmap.topicStyle.fontWeightLight')}</option>
          <option value="400">{t('mindmap.topicStyle.fontWeightRegular')}</option>
          <option value="500">{t('mindmap.topicStyle.fontWeightMedium')}</option>
          <option value="600">{t('mindmap.topicStyle.fontWeightSemibold')}</option>
          <option value="700">{t('mindmap.topicStyle.fontWeightBold')}</option>
        </select>
      </div>
      {effectiveStructureClassLabel ? (
        <p className="mindmap-topic-style__effective-layout">
          {t('mindmap.topicStyle.effectiveLayout', { layout: effectiveStructureClassLabel })}
        </p>
      ) : null}
      <div className="mm-row">
        <span className="mm-row__label">{t('mindmap.topicStyle.emphasis')}</span>
        <div
          className="mindmap-topic-style__text-toggles"
          role="group"
          aria-label={t('mindmap.topicStyle.emphasis')}
        >
          <button
            type="button"
            className={selBold.state === 'concrete' && selBold.value ? 'is-active' : ''}
            aria-pressed={selBold.state === 'mixed' ? 'mixed' : selBold.state === 'concrete' && selBold.value}
            aria-label={selBold.state === 'mixed'
              ? `${t('mindmap.topicStyle.bold')} — ${t('mindmap.topicStyle.mixed')}`
              : t('mindmap.topicStyle.bold')}
            title={t('mindmap.topicStyle.bold')}
            onClick={() => {
              const turnOn = selBold.state === 'mixed' || selBold.state !== 'concrete' || !selBold.value
              applyTextProperty(
                { bold: turnOn },
                () => dispatchStyleMutation((style, _topic, depth) => {
                  if (turnOn) style.fontWeight = '700'
                  else if (isBoldTopicFontWeight(topicStyleLayerForDepth(current!.theme, depth)?.fontWeight)) {
                    style.fontWeight = '400'
                  } else {
                    delete style.fontWeight
                  }
                  return style
                })
              )
            }}
          >
            <Bold size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={selItalic.state === 'concrete' && selItalic.value ? 'is-active' : ''}
            aria-pressed={selItalic.state === 'mixed' ? 'mixed' : selItalic.state === 'concrete' && selItalic.value}
            aria-label={selItalic.state === 'mixed'
              ? `${t('mindmap.topicStyle.italic')} — ${t('mindmap.topicStyle.mixed')}`
              : t('mindmap.topicStyle.italic')}
            title={t('mindmap.topicStyle.italic')}
            onClick={() => {
              const turnOn = selItalic.state === 'mixed' || selItalic.state !== 'concrete' || !selItalic.value
              applyTextProperty(
                { italic: turnOn },
                () => dispatchStyleMutation((style, _topic, depth) => {
                  if (turnOn) style.fontStyle = 'italic'
                  else if (topicStyleLayerForDepth(current!.theme, depth)?.fontStyle === 'italic') {
                    style.fontStyle = 'normal'
                  } else {
                    delete style.fontStyle
                  }
                  return style
                })
              )
            }}
          >
            <Italic size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={selUnderline.state === 'concrete' && selUnderline.value ? 'is-active' : ''}
            aria-pressed={selUnderline.state === 'mixed' ? 'mixed' : selUnderline.state === 'concrete' && selUnderline.value}
            aria-label={selUnderline.state === 'mixed'
              ? `${t('mindmap.topicStyle.underline')} — ${t('mindmap.topicStyle.mixed')}`
              : t('mindmap.topicStyle.underline')}
            title={t('mindmap.topicStyle.underline')}
            onClick={() => {
              const turnOn = selUnderline.state === 'mixed' || selUnderline.state !== 'concrete' || !selUnderline.value
              applyTextProperty(
                { underline: turnOn },
                () => toggleTextDecoration('underline', effectiveUnderline)
              )
            }}
          >
            <Underline size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={selStrikethrough.state === 'concrete' && selStrikethrough.value ? 'is-active' : ''}
            aria-pressed={selStrikethrough.state === 'mixed' ? 'mixed' : selStrikethrough.state === 'concrete' && selStrikethrough.value}
            aria-label={selStrikethrough.state === 'mixed'
              ? `${t('mindmap.topicStyle.strikethrough')} — ${t('mindmap.topicStyle.mixed')}`
              : t('mindmap.topicStyle.strikethrough')}
            title={t('mindmap.topicStyle.strikethrough')}
            onClick={() => {
              const turnOn = selStrikethrough.state === 'mixed' || selStrikethrough.state !== 'concrete' || !selStrikethrough.value
              applyTextProperty(
                { strikethrough: turnOn },
                () => toggleTextDecoration('line-through', effectiveStrikethrough)
              )
            }}
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
          {TEXT_ALIGN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`mindmap.topicStyle.${option.labelKey}`)}
            </option>
          ))}
        </select>
      </div>
      <MindMapTopicColorPicker
        id="mindmap-topic-style-text-color"
        label={t('mindmap.topicStyle.textColor')}
        value={textColor}
        displayValue={selTextColor}
        presets={TEXT_COLOR_PRESETS}
        fallback={TOPIC_STYLE_DEFAULTS.textColor}
        onChange={(nextColor) => applyTextProperty(
          { color: nextColor },
          () => updateStyleField('textColor', nextColor)
        )}
      />

      <div className="mm-subhead">{t('mindmap.topicStyle.layoutSection')}</div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-topic-style-layout">
          {t('mindmap.topicStyle.layoutLabel')}
        </label>
        <select
          id="mindmap-topic-style-layout"
          className="mm-select"
          value={selectValue(effectiveStructureClassValue)}
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
          {effectiveStructureClassValue.state === 'mixed' ? <option value={MIXED_VALUE} disabled>{t('mindmap.topicStyle.mixed')}</option> : null}
          {MIND_MAP_TOPIC_STYLE_LAYOUT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`mindmap.topicStyle.layouts.${option.labelKey}`)}
            </option>
          ))}
        </select>
      </div>
      {selectedTopics.length === 1 ? (
        <>
          <div className="mm-subhead">{t('mindmap.topicStyle.childVisibilitySection')}</div>
          <div className="mindmap-topic-style__propagation-actions">
            <button
              type="button"
              disabled={!currentTopicHasChildren || !selectedTopicRef}
              onClick={() => {
                if (selectedTopicRef) {
                  setTopicChildrenCollapsed(
                    selectedTopicRef.node.id,
                    selectedTopicRef.node.collapsed !== true
                  )
                }
              }}
            >
              {selectedTopicRef?.node.collapsed === true
                ? t('mindmap.expandCurrentChildren')
                : t('mindmap.collapseCurrentChildren')}
            </button>
            <button
              type="button"
              disabled={!canToggleSiblingChildren || !selectedTopicRef}
              onClick={() => {
                if (selectedTopicRef) {
                  setSiblingTopicsCollapsed(selectedTopicRef.node.id, !siblingChildrenCollapsed)
                }
              }}
            >
              {siblingChildrenCollapsed
                ? t('mindmap.expandSiblingChildren')
                : t('mindmap.collapseSiblingChildren')}
            </button>
          </div>

          <div className="mm-subhead">{t('mindmap.numbering.title')}</div>
          <div className="mm-row">
            <label className="mm-row__label" htmlFor="mindmap-topic-numbering-pattern">
              {t('mindmap.numbering.pattern')}
            </label>
            <select
              id="mindmap-topic-numbering-pattern"
              className="mm-select"
              value={numbering?.pattern ?? ''}
              onChange={(event) => changeNumberingPattern(event.currentTarget.value)}
            >
              <option value="">{t('mindmap.numbering.patternNone')}</option>
              {NUMBERING_PATTERN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(`mindmap.numbering.${option.labelKey}`)}
                </option>
              ))}
            </select>
          </div>
          {hasConcreteNumberingPattern ? (
            <>
              <div className="mm-row">
                <span className="mm-row__label">{t('mindmap.numbering.tiered')}</span>
                <button
                  type="button"
                  className={`mindmap-topic-style__text-toggle${numberingTieredActive ? ' is-active' : ''}`}
                  aria-pressed={numberingTieredActive}
                  aria-label={t('mindmap.numbering.tiered')}
                  onClick={toggleNumberingTiered}
                >
                  {numberingTieredActive ? t('mindmap.numbering.on') : t('mindmap.numbering.off')}
                </button>
                <span className="mindmap-topic-style__effective">{t('mindmap.numbering.tieredHint')}</span>
              </div>
              <div className="mm-row">
                <span className="mm-row__label">{t('mindmap.numbering.restart')}</span>
                <button
                  type="button"
                  className={`mindmap-topic-style__text-toggle${numberingRestartActive ? ' is-active' : ''}`}
                  aria-pressed={numberingRestartActive}
                  aria-label={t('mindmap.numbering.restart')}
                  onClick={toggleNumberingRestart}
                >
                  {numberingRestartActive ? t('mindmap.numbering.on') : t('mindmap.numbering.off')}
                </button>
                <span className="mindmap-topic-style__effective">{t('mindmap.numbering.restartHint')}</span>
              </div>
              {numberingRestartActive ? (
                <div className="mm-row">
                  <label className="mm-row__label" htmlFor="mindmap-topic-numbering-restart-at">
                    {t('mindmap.numbering.restartAt')}
                  </label>
                  <div className="mindmap-topic-style__number-field">
                    <input
                      id="mindmap-topic-numbering-restart-at"
                      className="mm-number-input"
                      type="number"
                      min={NUMBERING_RESTART_MIN}
                      max={NUMBERING_RESTART_MAX}
                      step="1"
                      value={numbering?.restartAt ?? 1}
                      onChange={(event) => changeNumberingRestartAt(Number(event.currentTarget.value))}
                    />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          <div className="mindmap-topic-style__propagation-actions">
            <button
              type="button"
              disabled={siblingCount === 0}
              onClick={applyNumberingToSiblings}
            >
              {t('mindmap.numbering.applyToSiblings')}
            </button>
          </div>

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

function findMindMapTopic(
  node: MindMapTopicV2,
  id: string,
  inheritedStructureClass: MindMapStructureClass,
  depth = 0,
  branchIndex = 0,
  branchKey = node.id
): { topic: MindMapTopicV2; depth: number; branchIndex: number; branchKey: string; structureClass: MindMapStructureClass } | null {
  const structureClass = node.style?.structureClass ?? inheritedStructureClass
  if (node.id === id) return { topic: node, depth, branchIndex, branchKey, structureClass }
  for (const [index, child] of node.children.entries()) {
    const found = findMindMapTopic(
      child,
      id,
      structureClass,
      depth + 1,
      depth === 0 ? index : branchIndex,
      depth === 0 ? child.id : branchKey
    )
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
