import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapSheetLayoutUpdatePatch } from '../../../../shared/mindmap/commands'
import {
  STRUCTURE_FAMILIES,
  STRUCTURE_FAMILY_LABELS,
  STRUCTURE_TYPE_PRESETS,
  getStructureTypePreset,
  type StructureFamily
} from '../../../../shared/mindmap/structure-types'
import { useMindMapViewStore } from './mind-map-view-store'
import { getCanvasInspectorFieldCapability } from './mind-map-inspector-capabilities'
import {
  resolveLayoutField,
  type InspectorValue,
  type MindMapLayoutField
} from './mind-map-inspector-values'

const SPACING_OPTIONS = [8, 16, 24, 32] as const

const LINE_WIDTH_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: 0.5, labelKey: 'lineWidthExtraThin' },
  { value: 0.75, labelKey: 'lineWidthThin' },
  { value: 1, labelKey: 'lineWidthDefault' },
  { value: 1.5, labelKey: 'lineWidthThick' },
  { value: 2, labelKey: 'lineWidthExtraThick' }
]

type CanvasOptionsText = {
  layout: string
  spacing: string
  compact: string
  compactDescription: string
  reset: string
  spacingCompact: string
  spacingComfortable: string
  spacingSpacious: string
  right: string
  balanced: string
  left: string
  map: string
  down: string
  up: string
  connector: string
  curve: string
  elbow: string
  straight: string
  branchLineWidth: string
  lineWidthExtraThin: string
  lineWidthThin: string
  lineWidthDefault: string
  lineWidthThick: string
  lineWidthExtraThick: string
  balancedMap: string
  balancedMapUnavailable: string
  resetField: string
  [key: string]: string
}

/** XMind-style per-sheet layout controls. Mutations stay on the command path. */
export function MindMapCanvasOptionsPanel() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)
  const [structurePickerOpen, setStructurePickerOpen] = useState(false)
  const structurePickerRef = useRef<HTMLDivElement>(null)
  const structureTriggerRef = useRef<HTMLButtonElement>(null)
  const sheet = current?.sheets.find((candidate) => candidate.id === activeSheetId) ?? current?.sheets[0]

  useEffect(() => {
    if (!structurePickerOpen) return
    const selected = structurePickerRef.current?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]'
    )
    const first = structurePickerRef.current?.querySelector<HTMLElement>('[role="option"]')
    ;(selected ?? first)?.focus()

    const onPointerDown = (event: PointerEvent): void => {
      if (!structurePickerRef.current?.contains(event.target as Node)) {
        setStructurePickerOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [structurePickerOpen])

  if (!sheet) return null

  const text = t('mindmap.inspector.canvasControls', { returnObjects: true }) as CanvasOptionsText
  const layout = sheet.layout
  const activeStructure = getStructureTypePreset(layout.structureClass) ?? STRUCTURE_TYPE_PRESETS[0]!
  const balanceCapability = getCanvasInspectorFieldCapability('autoBalance', layout.structureClass)
  const balanceSupported = !balanceCapability.disabled
  const dispatchLayoutPatch = (patch: MindMapSheetLayoutUpdatePatch): void => {
    dispatchCommand(
      { type: 'sheet.update-layout', sheetId: sheet.id, patch },
      { label: t('mindmap.inspector.canvasControls.updateLabel') }
    )
  }

  /** Resolve a layout field through the five-state adapter (inherited vs concrete). */
  const layoutField = <K extends MindMapLayoutField>(field: K) =>
    resolveLayoutField(sheet.layout, field)

  /** Per-field reset to the structure/theme default; only shown while the field is concrete. */
  const resetFieldButton = (field: MindMapLayoutField, value: InspectorValue<unknown>) => {
    if (value.state !== 'concrete') return null
    return (
      <button
        type="button"
        className="mm-inline-reset"
        onClick={() => dispatchLayoutPatch({ [field]: null } as MindMapSheetLayoutUpdatePatch)}
        aria-label={text.resetField}
      >
        {text.resetField}
      </button>
    )
  }

  // Resolved once so TS can narrow each field to inherited vs concrete.
  const spacingValue = layoutField('spacing')
  const compactValue = layoutField('compact')
  const lineStyleValue = layoutField('lineStyle')
  const lineWidthScaleValue = layoutField('lineWidthScale')
  const linePatternValue = layoutField('linePattern')
  const taperedValue = layoutField('tapered')

  const reset = (): void => {
    const familyDefault = STRUCTURE_TYPE_PRESETS.find(
      (preset) => preset.family === activeStructure.family
    ) ?? STRUCTURE_TYPE_PRESETS[0]!
    dispatchLayoutPatch({
      structureClass: familyDefault.id,
      direction: null,
      compact: null,
      spacing: null,
      lineStyle: null,
      lineWidthScale: null,
      linePattern: null,
      tapered: null
    })
  }

  /** Look up a structure option label via i18n, falling back to the preset name. */
  const structureLabel = (labelKey: string, fallback: string): string =>
    text[labelKey] ?? fallback

  // Group structure presets by family for display.
  const presetsByFamily = STRUCTURE_FAMILIES.map((family) => ({
    family,
    presets: STRUCTURE_TYPE_PRESETS.filter((p) => p.family === family)
  })).filter((group) => group.presets.length > 0)

  const closeStructurePicker = (): void => {
    setStructurePickerOpen(false)
    queueMicrotask(() => structureTriggerRef.current?.focus())
  }

  const onStructurePickerKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeStructurePicker()
      return
    }
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return

    const options = [...(structurePickerRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    if (options.length === 0) return
    event.preventDefault()
    const currentIndex = options.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
    options[(currentIndex + step + options.length) % options.length]?.focus()
  }

  return (
    <section className="mindmap-canvas-options mm-section" aria-labelledby="mindmap-canvas-options-title">
      <div className="mm-section__head">
        <strong id="mindmap-canvas-options-title">{t('mindmap.inspector.canvasOptions')}</strong>
        <button
          type="button"
          className="mm-section__action"
          onClick={reset}
          title={text.reset}
          aria-label={text.reset}
        >
          <RotateCcw size={12} aria-hidden="true" />
        </button>
      </div>

      <div className="mindmap-canvas-options__section">
        <div className="mindmap-canvas-options__label">{text.layout}</div>
        <div
          ref={structurePickerRef}
          className="mindmap-structure-picker"
          onKeyDown={onStructurePickerKeyDown}
        >
          <button
            ref={structureTriggerRef}
            type="button"
            className="mindmap-structure-picker__trigger"
            aria-expanded={structurePickerOpen}
            aria-haspopup="listbox"
            aria-controls="mindmap-structure-options"
            aria-label={`${text.layout}: ${structureLabel(activeStructure.labelKey, activeStructure.name)}`}
            onClick={() => setStructurePickerOpen((open) => !open)}
          >
            <span className="mindmap-layout-option__glyph" aria-hidden="true">{activeStructure.glyph}</span>
            <span>{structureLabel(activeStructure.labelKey, activeStructure.name)}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {structurePickerOpen ? (
            <div
              id="mindmap-structure-options"
              className="mindmap-structure-picker__popover"
              role="listbox"
              aria-label={text.layout}
            >
              <div className="mindmap-layout-groups">
                {presetsByFamily.map((group) => (
                  <div key={group.family} className="mindmap-layout-group" role="group" aria-label={text['family' + group.family.charAt(0).toUpperCase() + group.family.slice(1)] ?? STRUCTURE_FAMILY_LABELS[group.family as StructureFamily]}>
                    <div className="mindmap-layout-group__label">
                      {text['family' + group.family.charAt(0).toUpperCase() + group.family.slice(1)] ?? STRUCTURE_FAMILY_LABELS[group.family as StructureFamily]}
                    </div>
                    <div className="mindmap-layout-grid">
                      {group.presets.map((option) => {
                        const selected = layout.structureClass === option.id
                        return (
                          <button
                            type="button"
                            role="option"
                            key={option.id}
                            className={`mindmap-layout-option${selected ? ' is-selected' : ''}`}
                            aria-selected={selected}
                            aria-description={selected ? t('mindmap.topicStyle.selected') : undefined}
                            onClick={() => {
                              dispatchLayoutPatch({ structureClass: option.id })
                              closeStructurePicker()
                            }}
                          >
                            <span className="mindmap-layout-option__glyph" aria-hidden="true">{option.glyph}</span>
                            <span>{structureLabel(option.labelKey, option.name)}</span>
                            {selected ? <Check size={12} aria-hidden="true" /> : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mindmap-canvas-options__section">
        <div className="mindmap-canvas-options__label">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {text.spacing}
            {resetFieldButton('spacing', spacingValue)}
          </span>
        </div>
        <div className="mindmap-spacing-options" role="group" aria-label={text.spacing}>
          {SPACING_OPTIONS.map((spacing) => {
            const selected = spacingValue.state === 'concrete'
              ? spacingValue.value === spacing
              : spacing === 16
            const label = spacing <= 8 ? text.spacingCompact : spacing >= 24 ? text.spacingSpacious : text.spacingComfortable
            return (
              <button
                type="button"
                key={spacing}
                className={`mindmap-spacing-option${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => dispatchLayoutPatch({ spacing })}
              >
                <span className="mindmap-spacing-option__dots" style={{ '--mindmap-spacing': `${Math.max(4, spacing / 4)}px` } as CSSProperties} aria-hidden="true" />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
        <label className="mm-row mm-row--switch">
          <span className="mm-row__label">
            {text.compact}
            <small>{text.compactDescription}</small>
          </span>
          {resetFieldButton('compact', compactValue)}
          <span className="mm-switch">
            <input
              type="checkbox"
              checked={compactValue.state === 'concrete' && compactValue.value === true}
              onChange={(event) => dispatchLayoutPatch({ compact: event.currentTarget.checked })}
            />
            <span className="mm-switch__track" aria-hidden="true" />
          </span>
        </label>
      </div>

      <div className="mindmap-canvas-options__section">
        <div className="mm-row">
          <label className="mm-row__label" htmlFor="mindmap-connector-style">
            {text.connector}
          </label>
          <select
            id="mindmap-connector-style"
            className="mm-select"
            aria-label={text.connector}
            aria-description={lineStyleValue.state === 'inherited'
              ? t('mindmap.topicStyle.stateInherited')
              : lineStyleValue.state === 'mixed'
                ? t('mindmap.topicStyle.mixed')
                : undefined}
            value={lineStyleValue.state === 'concrete' ? lineStyleValue.value : ''}
            onChange={(event) => {
              const value = event.currentTarget.value
              dispatchLayoutPatch({
                lineStyle: value === '' ? null : (value as 'curve' | 'straight' | 'elbow' | 'rounded-elbow' | 'bight' | 'fold' | 'rounded-fold')
              })
            }}
          >
            <option value="">{text.connectorDefault}</option>
            {(['curve', 'straight', 'elbow', 'rounded-elbow', 'bight', 'fold', 'rounded-fold'] as const).map((lineStyle) => (
              <option key={lineStyle} value={lineStyle}>{text[lineStyle]}</option>
            ))}
          </select>
        </div>
        <div className="mm-row">
          <label className="mm-row__label" htmlFor="mindmap-branch-line-width">
            {text.branchLineWidth}
          </label>
          {resetFieldButton('lineWidthScale', lineWidthScaleValue)}
          <select
            id="mindmap-branch-line-width"
            className="mm-select"
            aria-label={text.branchLineWidth}
            aria-description={lineWidthScaleValue.state === 'inherited'
              ? t('mindmap.topicStyle.stateInherited')
              : lineWidthScaleValue.state === 'mixed'
                ? t('mindmap.topicStyle.mixed')
                : undefined}
            value={lineWidthScaleValue.state === 'concrete' ? lineWidthScaleValue.value : 1}
            onChange={(event) => dispatchLayoutPatch({ lineWidthScale: Number(event.currentTarget.value) })}
          >
            {LINE_WIDTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{text[option.labelKey]}</option>
            ))}
          </select>
        </div>
        <div className="mm-row">
          <label className="mm-row__label" htmlFor="mindmap-branch-line-pattern">
            {text.branchLinePattern}
          </label>
          {resetFieldButton('linePattern', linePatternValue)}
          <select
            id="mindmap-branch-line-pattern"
            className="mm-select"
            aria-label={text.branchLinePattern}
            aria-description={linePatternValue.state === 'inherited'
              ? t('mindmap.topicStyle.stateInherited')
              : linePatternValue.state === 'mixed'
                ? t('mindmap.topicStyle.mixed')
                : undefined}
            value={linePatternValue.state === 'concrete' ? linePatternValue.value : 'solid'}
            onChange={(event) => {
              const value = event.currentTarget.value as 'solid' | 'dash' | 'hand-drawn-solid' | 'hand-drawn-dash'
              dispatchLayoutPatch({ linePattern: value })
            }}
          >
            {(['solid', 'dash', 'hand-drawn-solid', 'hand-drawn-dash'] as const).map((pattern) => (
              <option key={pattern} value={pattern}>
                {text[`pattern${pattern.split('-').map((part) => part[0]!.toUpperCase() + part.slice(1)).join('')}`]}
              </option>
            ))}
          </select>
        </div>
        <label className="mm-row mm-row--switch">
          <span className="mm-row__label">
            {text.taperedLine}
            <small>{text.taperedLineDescription}</small>
          </span>
          {resetFieldButton('tapered', taperedValue)}
          <span className="mm-switch">
            <input
              type="checkbox"
              checked={taperedValue.state === 'concrete' && taperedValue.value === true}
              onChange={(event) => dispatchLayoutPatch({ tapered: event.currentTarget.checked })}
            />
            <span className="mm-switch__track" aria-hidden="true" />
          </span>
        </label>
        <label className="mm-row mm-row--switch">
          <span className="mm-row__label">{text.balancedMap}</span>
          <span className="mm-switch">
            <input
              type="checkbox"
              checked={layout.structureClass === 'org.xmind.ui.logic.balanced'}
              disabled={!balanceSupported}
              aria-describedby={!balanceSupported ? 'mindmap-balanced-map-unavailable' : undefined}
              onChange={(event) =>
                dispatchLayoutPatch({
                  structureClass: event.currentTarget.checked
                    ? 'org.xmind.ui.logic.balanced'
                    : 'org.xmind.ui.logic.right'
                })
              }
            />
            <span className="mm-switch__track" aria-hidden="true" />
          </span>
        </label>
        {!balanceSupported ? (
          <p id="mindmap-balanced-map-unavailable" className="mindmap-canvas-options__capability-note">
            {text.balancedMapUnavailable}
          </p>
        ) : null}
      </div>
    </section>
  )
}
