import { Check, ChevronsDownUp, ChevronsUpDown, RotateCcw } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapSheetLayoutUpdatePatch } from '../../../../shared/mindmap/commands'
import {
  STRUCTURE_FAMILIES,
  STRUCTURE_FAMILY_LABELS,
  STRUCTURE_TYPE_PRESETS,
  type StructureFamily
} from '../../../../shared/mindmap/structure-types'
import { useMindMapViewStore } from './mind-map-view-store'

const SPACING_OPTIONS = [8, 16, 24, 32] as const

const LINE_WIDTH_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: 0.75, labelKey: 'lineWidthThin' },
  { value: 1, labelKey: 'lineWidthDefault' },
  { value: 1.5, labelKey: 'lineWidthThick' }
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
  branchLineWidth: string
  lineWidthThin: string
  lineWidthDefault: string
  lineWidthThick: string
  mapOperations: string
  collapseAll: string
  expandAll: string
  balancedMap: string
  [key: string]: string
}

/** XMind-style per-sheet layout controls. Mutations stay on the command path. */
export function MindMapCanvasOptionsPanel() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)
  const collapseAll = useMindMapViewStore((state) => state.collapseAll)
  const expandAll = useMindMapViewStore((state) => state.expandAll)
  const sheet = current?.sheets.find((candidate) => candidate.id === activeSheetId) ?? current?.sheets[0]

  if (!sheet) return null

  const text = t('mindmap.inspector.canvasControls', { returnObjects: true }) as CanvasOptionsText
  const layout = sheet.layout
  const dispatchLayoutPatch = (patch: MindMapSheetLayoutUpdatePatch): void => {
    dispatchCommand(
      { type: 'sheet.update-layout', sheetId: sheet.id, patch },
      { label: t('mindmap.inspector.canvasControls.updateLabel') }
    )
  }

  const reset = (): void => {
    dispatchLayoutPatch({
      structureClass: 'org.xmind.ui.logic.right',
      direction: null,
      compact: null,
      spacing: null,
      lineStyle: null,
      lineWidthScale: null
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
        <div className="mindmap-layout-groups" role="group" aria-label={text.layout}>
          {presetsByFamily.map((group) => (
            <div key={group.family} className="mindmap-layout-group">
              <div className="mindmap-layout-group__label">
                {text['family' + group.family.charAt(0).toUpperCase() + group.family.slice(1)] ?? STRUCTURE_FAMILY_LABELS[group.family as StructureFamily]}
              </div>
              <div className="mindmap-layout-grid">
                {group.presets.map((option) => {
                  const selected = layout.structureClass === option.id
                  return (
                    <button
                      type="button"
                      key={option.id}
                      className={`mindmap-layout-option${selected ? ' is-selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => dispatchLayoutPatch({ structureClass: option.id })}
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

      <div className="mindmap-canvas-options__section">
        <div className="mindmap-canvas-options__label">{text.spacing}</div>
        <div className="mindmap-spacing-options" role="group" aria-label={text.spacing}>
          {SPACING_OPTIONS.map((spacing) => {
            const selected = Math.round(layout.spacing ?? 16) === spacing
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
          <span className="mm-switch">
            <input
              type="checkbox"
              checked={layout.compact === true}
              onChange={(event) => dispatchLayoutPatch({ compact: event.currentTarget.checked })}
            />
            <span className="mm-switch__track" aria-hidden="true" />
          </span>
        </label>
      </div>

      <div className="mindmap-canvas-options__section">
        <div className="mm-row">
          <span className="mm-row__label">{text.branchLineWidth}</span>
          <div className="mindmap-segmented mindmap-segmented--inline" role="group" aria-label={text.branchLineWidth}>
            {LINE_WIDTH_OPTIONS.map((option) => {
              const selected = Math.round(layout.lineWidthScale ?? 1) === option.value || (layout.lineWidthScale === undefined && option.value === 1)
              return (
                <button
                  type="button"
                  key={option.value}
                  className={selected ? 'is-selected' : ''}
                  aria-pressed={selected}
                  onClick={() => dispatchLayoutPatch({ lineWidthScale: option.value })}
                >
                  {text[option.labelKey]}
                </button>
              )
            })}
          </div>
        </div>
        <label className="mm-row mm-row--switch">
          <span className="mm-row__label">{text.balancedMap}</span>
          <span className="mm-switch">
            <input
              type="checkbox"
              checked={layout.structureClass === 'org.xmind.ui.logic.balanced'}
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
      </div>

      <div className="mindmap-canvas-options__section">
        <div className="mindmap-canvas-options__label">{text.mapOperations}</div>
        <div className="mindmap-canvas-options__actions">
          <button
            type="button"
            className="mindmap-canvas-options__action"
            onClick={collapseAll}
            title={text.collapseAll}
          >
            <ChevronsDownUp size={14} aria-hidden="true" />
            <span>{text.collapseAll}</span>
          </button>
          <button
            type="button"
            className="mindmap-canvas-options__action"
            onClick={expandAll}
            title={text.expandAll}
          >
            <ChevronsUpDown size={14} aria-hidden="true" />
            <span>{text.expandAll}</span>
          </button>
        </div>
      </div>
    </section>
  )
}
