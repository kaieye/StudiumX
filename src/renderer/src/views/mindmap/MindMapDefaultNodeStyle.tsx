import { type CSSProperties } from 'react'
import { Bold, Italic, Strikethrough, Underline } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MindMapTheme, MindMapTopicStyleOverride } from '../../../../shared/mindmap/domain/types'
import type { InspectorValue } from './mind-map-inspector-values'
import {
  isBoldTopicFontWeight,
  hasTopicTextDecoration,
  normalizeTopicFontWeight,
  resolveEffectiveTopicStyle,
  updateTopicTextDecoration,
  type MindMapTextDecorationFlag
} from './mind-map-topic-style'
import { fontEntryLabel, SAFE_FONTS } from './mind-map-font-list'
import { MindMapFontPicker } from './MindMapThemePanel'
import { MindMapTopicColorPicker, MindMapTopicStyleMenu } from './MindMapTopicStyleMenu'

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
  { value: 'solid', labelKey: 'borderStyleSolid' },
  { value: 'dash', labelKey: 'borderStyleDash' },
  { value: 'none', labelKey: 'borderStyleNone' }
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

/**
 * Global-node default style editor.
 *
 * Renders the same per-node style controls as the topic-style inspector, but
 * operates on the sheet's `defaultTopicStyle` applied to every newly created
 * node. Because this is a default for new nodes (not a theme-layer override),
 * the controls always show concrete values — never "inherit"/"default"
 * placeholders. Unset fields resolve through the document theme so the shown
 * value matches what a new node would actually render; changing a control
 * writes that field as an explicit override. Mutations go through `onChange`;
 * the canonical command/reducer/persistence lane stays with the caller.
 */
export function MindMapDefaultNodeStyle({
  value,
  onChange,
  resetLabel,
  theme
}: {
  value: MindMapTopicStyleOverride
  onChange: (next: MindMapTopicStyleOverride) => void
  resetLabel: string
  theme: MindMapTheme
}) {
  const { t } = useTranslation()
  const style = value

  // Resolve each field to the concrete value a newly created node would render
  // (override > theme layer > built-in default) so no "inherit" state is shown.
  const effective = resolveEffectiveTopicStyle(style, theme, 1) ?? {}
  const fill = effective.fill ?? '#F8F7F7'
  const stroke = effective.stroke ?? '#8E8E93'
  const textColor = effective.textColor ?? '#24324A'
  const borderStyle = effective.borderStyle ?? 'solid'
  const borderWidth = effective.borderWidth ?? 1
  const fillPattern = effective.fillPattern ?? 'solid'
  const fontStack = effective.fontFamily ?? ''
  const fontLabel = fontStack
    ? SAFE_FONTS.find((entry) => entry.stack === fontStack)
      ? fontEntryLabel(SAFE_FONTS.find((entry) => entry.stack === fontStack)!, t)
      : t('mindmap.topicStyle.importedFont', { font: fontStack })
    : t('mindmap.topicStyle.fontSystem')
  const fontSize = effective.fontSize ?? 16
  const fontWeight = normalizeTopicFontWeight(effective.fontWeight) ?? '400'
  const textTransform = effective.textTransform ?? 'none'
  const textAlign = effective.textAlign ?? 'center'

  const updateField = <K extends keyof MindMapTopicStyleOverride>(
    field: K,
    next: MindMapTopicStyleOverride[K] | undefined
  ): void => {
    const copy = { ...style }
    if (next === undefined) delete copy[field]
    else (copy as Record<K, MindMapTopicStyleOverride[K]>)[field] = next
    onChange(Object.keys(copy).length > 0 ? copy : {})
  }

  // `iv` reports the persisted override state (drives clear affordances);
  // `concrete` drives the displayed value so nothing ever reads "inherit".
  const iv = <T,>(fieldValue: T | undefined): InspectorValue<T> =>
    fieldValue === undefined
      ? { state: 'inherited' }
      : { state: 'concrete', value: fieldValue }
  const concrete = <T,>(fieldValue: T): InspectorValue<T> =>
    ({ state: 'concrete', value: fieldValue })

  const toggleBold = (): void => {
    updateField('fontWeight', isBoldTopicFontWeight(style.fontWeight) ? undefined : '700')
  }
  const toggleItalic = (): void => {
    updateField('fontStyle', style.fontStyle === 'italic' ? undefined : 'italic')
  }
  const toggleDecoration = (flag: MindMapTextDecorationFlag): void => {
    const enabled = !hasTopicTextDecoration(style.textDecoration, flag)
    const next = updateTopicTextDecoration(style.textDecoration, flag, enabled)
    updateField('textDecoration', next === 'none' ? undefined : next)
  }
  const boldActive = isBoldTopicFontWeight(style.fontWeight)
  const italicActive = style.fontStyle === 'italic'
  const underlineActive = hasTopicTextDecoration(style.textDecoration, 'underline')
  const strikethroughActive = hasTopicTextDecoration(style.textDecoration, 'line-through')

  return (
    <div className="mindmap-default-node-style">
      <div className="mm-subhead">{t('mindmap.topicStyle.styleSection')}</div>
      <MindMapTopicStyleMenu
        id="mindmap-default-node-fill-pattern"
        label={t('mindmap.topicStyle.fillPattern')}
        value={iv(style.fillPattern)}
        displayValue={concrete(fillPattern)}
        options={FILL_PATTERN_OPTIONS.map((option) => ({
          value: option.value,
          label: t(`mindmap.topicStyle.${option.labelKey}`)
        }))}
        onChange={(nextPattern) => updateField('fillPattern', nextPattern)}
        className="mindmap-topic-style-menu--pattern"
        optionsClassName="mindmap-topic-style-menu__options--patterns"
        optionClassName="mindmap-topic-style-menu__option--pattern"
        renderPreview={(selected, state) => (
          <span
            className={`mindmap-topic-style-menu__pattern-preview mindmap-topic-style-menu__pattern-preview--${state.state === 'mixed' ? 'mixed' : selected ?? 'solid'}`}
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
        id="mindmap-default-node-fill-color"
        label={t('mindmap.topicStyle.fillColor')}
        value={iv(style.fill)}
        displayValue={concrete(fill)}
        presets={FILL_COLOR_PRESETS}
        fallback="#F8F7F7"
        onChange={(nextColor) => updateField('fill', nextColor)}
      />
      <MindMapTopicStyleMenu
        id="mindmap-default-node-border-style"
        label={t('mindmap.topicStyle.borderStyle')}
        value={iv(style.borderStyle)}
        displayValue={concrete(borderStyle)}
        options={BORDER_STYLE_OPTIONS.map((option) => ({
          value: option.value,
          label: t(`mindmap.topicStyle.${option.labelKey}`)
        }))}
        onChange={(nextBorderStyle) => updateField('borderStyle', nextBorderStyle)}
        className="mindmap-topic-style-menu--border"
        optionsClassName="mindmap-topic-style-menu__options--border"
        optionClassName="mindmap-topic-style-menu__option--border"
        renderPreview={(selected, state) => (
          <span
            className={`mindmap-topic-style-menu__border-preview mindmap-topic-style-menu__border-preview--${state.state === 'mixed' ? 'mixed' : selected ?? 'solid'}`}
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
      <MindMapTopicColorPicker
        id="mindmap-default-node-border-color"
        label={t('mindmap.topicStyle.strokeColor')}
        value={iv(style.stroke)}
        displayValue={concrete(stroke)}
        presets={FILL_COLOR_PRESETS}
        fallback="#8E8E93"
        onChange={(nextColor) => updateField('stroke', nextColor)}
      />
      <MindMapTopicStyleMenu
        id="mindmap-default-node-border-width"
        label={t('mindmap.topicStyle.borderWidth')}
        value={iv(style.borderWidth)}
        displayValue={concrete(borderWidth)}
        options={[
          ...BORDER_WIDTH_OPTIONS,
          ...(style.borderWidth !== undefined && !BORDER_WIDTH_OPTIONS.some(
            (width) => Math.abs(width - style.borderWidth!) < 0.001
          ) ? [style.borderWidth] : [])
        ].map((width) => ({ value: width, label: String(width) }))}
        onChange={(nextWidth) => updateField('borderWidth', nextWidth)}
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

      <div className="mm-subhead">{t('mindmap.topicStyle.textSection')}</div>
      <div className="mm-row">
        <span className="mm-row__label">{t('mindmap.topicStyle.fontFamily')}</span>
        <MindMapFontPicker
          value={style.fontFamily || fontStack || undefined}
          currentLabel={fontLabel}
          ariaLabel={t('mindmap.topicStyle.fontFamily')}
          onSelect={(stack) => updateField('fontFamily', stack || undefined)}
          searchPlaceholder="Search fonts…"
          searchLabel="Search fonts"
          noResultsLabel="No fonts found."
        />
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-default-node-fontsize">
          {t('mindmap.topicStyle.fontSize')}
        </label>
        <label
          className="mindmap-spacing-field mindmap-spacing-field--wide"
          htmlFor="mindmap-default-node-fontsize"
        >
          <input
            id="mindmap-default-node-fontsize"
            className="mm-number-input"
            type="number"
            inputMode="decimal"
            min="0.1"
            max="512"
            step="any"
            value={fontSize}
            aria-describedby="mindmap-default-node-fontsize-unit"
            onChange={(event) => {
              const rawValue = event.currentTarget.value
              if (rawValue === '') {
                updateField('fontSize', undefined)
                return
              }
              const nextValue = Number(rawValue)
              if (Number.isFinite(nextValue) && nextValue > 0 && nextValue <= 512) {
                updateField('fontSize', nextValue)
              }
            }}
          />
          <span id="mindmap-default-node-fontsize-unit" aria-hidden="true">px</span>
        </label>
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-default-node-fontweight">
          {t('mindmap.topicStyle.fontWeight')}
        </label>
        <select
          id="mindmap-default-node-fontweight"
          className="mm-select"
          value={fontWeight}
          onChange={(event) => updateField('fontWeight', event.currentTarget.value || undefined)}
        >
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
            className={boldActive ? 'is-active' : ''}
            aria-pressed={boldActive}
            aria-label={t('mindmap.topicStyle.bold')}
            title={t('mindmap.topicStyle.bold')}
            onClick={toggleBold}
          >
            <Bold size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={italicActive ? 'is-active' : ''}
            aria-pressed={italicActive}
            aria-label={t('mindmap.topicStyle.italic')}
            title={t('mindmap.topicStyle.italic')}
            onClick={toggleItalic}
          >
            <Italic size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={underlineActive ? 'is-active' : ''}
            aria-pressed={underlineActive}
            aria-label={t('mindmap.topicStyle.underline')}
            title={t('mindmap.topicStyle.underline')}
            onClick={() => toggleDecoration('underline')}
          >
            <Underline size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={strikethroughActive ? 'is-active' : ''}
            aria-pressed={strikethroughActive}
            aria-label={t('mindmap.topicStyle.strikethrough')}
            title={t('mindmap.topicStyle.strikethrough')}
            onClick={() => toggleDecoration('line-through')}
          >
            <Strikethrough size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-default-node-text-transform">
          {t('mindmap.topicStyle.textTransform')}
        </label>
        <select
          id="mindmap-default-node-text-transform"
          className="mm-select"
          value={textTransform}
          onChange={(event) => updateField('textTransform', (event.currentTarget.value || undefined) as MindMapTopicStyleOverride['textTransform'])}
        >
          {TEXT_TRANSFORM_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`mindmap.topicStyle.${option.labelKey}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="mm-row">
        <label className="mm-row__label" htmlFor="mindmap-default-node-text-align">
          {t('mindmap.topicStyle.textAlign')}
        </label>
        <select
          id="mindmap-default-node-text-align"
          className="mm-select"
          value={textAlign}
          onChange={(event) => updateField('textAlign', (event.currentTarget.value || undefined) as MindMapTopicStyleOverride['textAlign'])}
        >
          {TEXT_ALIGN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`mindmap.topicStyle.${option.labelKey}`)}
            </option>
          ))}
        </select>
      </div>
      <MindMapTopicColorPicker
        id="mindmap-default-node-text-color"
        label={t('mindmap.topicStyle.textColor')}
        value={iv(style.textColor)}
        displayValue={concrete(textColor)}
        presets={TEXT_COLOR_PRESETS}
        fallback="#24324A"
        onChange={(nextColor) => updateField('textColor', nextColor)}
      />

      <div className="mindmap-default-node-style__reset">
        <button
          type="button"
          className="mindmap-default-node-style__reset-btn"
          disabled={Object.keys(style).length === 0}
          onClick={() => onChange({})}
        >
          {resetLabel}
        </button>
      </div>
    </div>
  )
}
