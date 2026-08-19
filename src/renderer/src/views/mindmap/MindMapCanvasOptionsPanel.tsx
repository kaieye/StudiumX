import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MindMapSheetLayoutUpdatePatch } from '../../../../shared/mindmap/commands'
import { useMindMapViewStore } from './mind-map-view-store'
import {
  resolveLayoutField,
  type MindMapLayoutField
} from './mind-map-inspector-values'
import { MindMapIconPicker } from './MindMapIconPicker'
import { MIND_MAP_TOPIC_SHAPE_OPTIONS } from './MindMapTopicShapePicker'
import type { NodeShape } from './mind-map-node-shapes'
import { ConnectorStyleIcon, LinePatternIcon, NodeShapeIcon } from './mind-map-shape-icons'
import { getConnectorStyle } from '../../../../shared/mindmap/structure-types'
import { DEFAULT_MIND_MAP_TOPIC_SHAPE } from '../../../../shared/mindmap/mind-map-types'
import { DEFAULT_MIND_MAP_THEME, type MindMapTopicStyleOverride } from '../../../../shared/mindmap/domain/types'
import { getCanvasInspectorFieldCapability } from './mind-map-inspector-capabilities'
import { MindMapDefaultNodeStyle } from './MindMapDefaultNodeStyle'

const SPACING_MIN = 4
const SPACING_MAX = 96
const SPACING_DEFAULT = 16

const LINE_WIDTH_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: 0.5, labelKey: 'lineWidthExtraThin' },
  { value: 0.75, labelKey: 'lineWidthThin' },
  { value: 1, labelKey: 'lineWidthScaleOne' },
  { value: 1.5, labelKey: 'lineWidthThick' },
  { value: 2, labelKey: 'lineWidthExtraThick' }
]

/** Connector styles selectable in the canvas options (StudiumX branch language). */
const SELECTABLE_CONNECTORS = ['rounded-elbow', 'elbow', 'straight', 'curve'] as const

type CanvasOptionsText = {
  spacing: string
  reset: string
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
  globalNode: string
  globalNodeReset: string
  [key: string]: string
}

/** StudiumX-style per-sheet layout controls. Mutations stay on the command path. */
export function MindMapCanvasOptionsPanel() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)
  const sheet = current?.sheets.find((candidate) => candidate.id === activeSheetId) ?? current?.sheets[0]

  if (!sheet) return null

  const text = t('mindmap.inspector.canvasControls', { returnObjects: true }) as CanvasOptionsText
  const dispatchLayoutPatch = (patch: MindMapSheetLayoutUpdatePatch): void => {
    dispatchCommand(
      { type: 'sheet.update-layout', sheetId: sheet.id, patch },
      { label: t('mindmap.inspector.canvasControls.updateLabel') }
    )
  }

  /** Resolve a layout field through the five-state adapter (inherited vs concrete). */
  const layoutField = <K extends MindMapLayoutField>(field: K) =>
    resolveLayoutField(sheet.layout, field)

  const defaultTopicStyle = sheet.layout.defaultTopicStyle ?? {}
  const setDefaultTopicStyle = (next: MindMapTopicStyleOverride | null): void => {
    dispatchLayoutPatch({ defaultTopicStyle: next })
  }

  // Resolved once so TS can narrow each field to inherited vs concrete.
  const spacingValue = layoutField('spacing')
  const spacingInputValue = spacingValue.state === 'concrete'
    ? Math.max(SPACING_MIN, spacingValue.value)
    : SPACING_DEFAULT
  const lineStyleValue = layoutField('lineStyle')
  const lineWidthScaleValue = layoutField('lineWidthScale')
  const linePatternValue = layoutField('linePattern')
  const taperedValue = layoutField('tapered')
  const defaultTopicShapeValue = layoutField('defaultTopicShape')
  const autoBalanceCapability = getCanvasInspectorFieldCapability('autoBalance', sheet.layout.structureClass)
  const autoBalanceEnabled = sheet.layout.structureClass === 'studiumx.layout.logic.balanced'

  // The structure's default connector (e.g. Curve for map/logic, Elbow for
  // org/tree). When that default is itself one of the selectable styles, treat
  // it as the selected option so we never need a redundant "Structure default"
  // entry. Non-selectable defaults (brace/timeline/matrix/fishbone) keep a
  // small reset affordance so users can still return to the structure default.
  const effectiveDefault = getConnectorStyle(sheet.layout.structureClass)
  const defaultIsSelectable = (SELECTABLE_CONNECTORS as readonly string[]).includes(effectiveDefault)
  const connectorValue = lineStyleValue.state === 'concrete'
    ? lineStyleValue.value
    : defaultIsSelectable
      ? effectiveDefault
      : undefined

  const reset = (): void => {
    dispatchLayoutPatch({
      direction: null,
      compact: null,
      spacing: null,
      lineStyle: null,
      lineWidthScale: null,
      linePattern: null,
      tapered: null,
      defaultTopicShape: null,
      defaultTopicStyle: null
    })
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
        <div className="mm-row">
          <span className="mm-row__label">
            {text.spacing}
          </span>
          <label className="mindmap-spacing-field" htmlFor="mindmap-branch-spacing">
            <input
              id="mindmap-branch-spacing"
              className="mm-number-input"
              type="number"
              min={SPACING_MIN}
              max={SPACING_MAX}
              step="1"
              value={spacingInputValue}
              placeholder={spacingValue.state === 'mixed' ? t('mindmap.topicStyle.mixed') : String(SPACING_DEFAULT)}
              aria-label={text.spacing}
              onChange={(event) => {
                const next = Number(event.currentTarget.value)
                if (Number.isFinite(next) && next >= SPACING_MIN && next <= SPACING_MAX) {
                  dispatchLayoutPatch({ spacing: Math.round(next) })
                }
              }}
            />
            <span aria-hidden="true">px</span>
          </label>
        </div>
        <label
          className="mm-row mm-row--switch"
          title={autoBalanceCapability.reasonKey ? t(`mindmap.inspector.canvasControls.${autoBalanceCapability.reasonKey}`) : undefined}
        >
          <span className="mm-row__label">
            {text.autoBalance}
          </span>
          <span className="mm-switch">
            <input
              type="checkbox"
              checked={autoBalanceEnabled}
              disabled={autoBalanceCapability.disabled}
              onChange={(event) => dispatchLayoutPatch({
                structureClass: event.currentTarget.checked
                  ? 'studiumx.layout.logic.balanced'
                  : 'studiumx.layout.logic.right'
              })}
            />
            <span className="mm-switch__track" aria-hidden="true" />
          </span>
        </label>
        <MindMapIconPicker
          label={text.defaultNodeShape}
          value={defaultTopicShapeValue.state === 'concrete'
            ? defaultTopicShapeValue.value
            : DEFAULT_MIND_MAP_TOPIC_SHAPE}
          isMixed={defaultTopicShapeValue.state === 'mixed'}
          displayLabel={text.defaultNodeShapeDefault}
          options={MIND_MAP_TOPIC_SHAPE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(`mindmap.topicStyle.${option.labelKey}`),
            icon: <NodeShapeIcon shape={option.value as NodeShape} />
          }))}
          searchable
          showClear={defaultTopicShapeValue.state === 'concrete'}
          clearLabel={text.defaultNodeShapeDefault}
          onClear={() => dispatchLayoutPatch({ defaultTopicShape: DEFAULT_MIND_MAP_TOPIC_SHAPE })}
          dialogLabel={text.defaultNodeShapePicker}
          buildTriggerName={(triggerLabel) => `${text.defaultNodeShape} ${triggerLabel}`}
          triggerDescription={defaultTopicShapeValue.state === 'mixed'
              ? t('mindmap.topicStyle.mixed')
              : undefined}
          onChange={(value) => dispatchLayoutPatch({
            defaultTopicShape: value ?? DEFAULT_MIND_MAP_TOPIC_SHAPE
          })}
        />
      </div>

      <div className="mindmap-canvas-options__section">
      <MindMapIconPicker
        label={text.connector}
        value={connectorValue}
        isMixed={lineStyleValue.state === 'mixed'}
        displayLabel={text[effectiveDefault] ?? text.connectorDefault}
        options={SELECTABLE_CONNECTORS.map((lineStyle) => ({
          value: lineStyle,
          label: text[lineStyle],
          icon: <ConnectorStyleIcon style={lineStyle} />
        }))}
        columns={2}
        searchable={false}
        showClear={lineStyleValue.state === 'concrete' && !defaultIsSelectable}
        clearLabel={text.connectorDefault}
        onClear={() => dispatchLayoutPatch({ lineStyle: null })}
        dialogLabel={text.connector}
        triggerDescription={lineStyleValue.state === 'inherited'
          ? t('mindmap.topicStyle.stateInherited')
          : lineStyleValue.state === 'mixed'
            ? t('mindmap.topicStyle.mixed')
            : undefined}
        onChange={(value) => {
          if (value === undefined) {
            dispatchLayoutPatch({ lineStyle: null })
            return
          }
          dispatchLayoutPatch({ lineStyle: value as (typeof SELECTABLE_CONNECTORS)[number] })
        }}
      />
        <div className="mm-row">
          <label className="mm-row__label" htmlFor="mindmap-branch-line-width">
            {text.branchLineWidth}
          </label>
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
        <MindMapIconPicker
          label={text.branchLinePattern}
          value={linePatternValue.state === 'concrete' ? linePatternValue.value : 'solid'}
          isMixed={linePatternValue.state === 'mixed'}
          displayLabel={text.patternSolid}
          options={(['solid', 'dash', 'hand-drawn-solid', 'hand-drawn-dash'] as const).map((pattern) => ({
            value: pattern,
            label: text[`pattern${pattern.split('-').map((part) => part[0]!.toUpperCase() + part.slice(1)).join('')}`],
            icon: <LinePatternIcon pattern={pattern} />
          }))}
          searchable={false}
          dialogLabel={text.branchLinePattern}
          triggerDescription={linePatternValue.state === 'inherited'
            ? t('mindmap.topicStyle.stateInherited')
            : linePatternValue.state === 'mixed'
              ? t('mindmap.topicStyle.mixed')
              : undefined}
          onChange={(value) => {
            dispatchLayoutPatch({ linePattern: (value ?? 'solid') as 'solid' | 'dash' | 'hand-drawn-solid' | 'hand-drawn-dash' })
          }}
        />
        <label className="mm-row mm-row--switch">
          <span className="mm-row__label">
            {text.taperedLine}
          </span>
          <span className="mm-switch">
            <input
              type="checkbox"
              checked={taperedValue.state === 'concrete' && taperedValue.value === true}
              onChange={(event) => dispatchLayoutPatch({ tapered: event.currentTarget.checked })}
            />
            <span className="mm-switch__track" aria-hidden="true" />
          </span>
        </label>
      </div>

      <div className="mindmap-canvas-options__section mindmap-canvas-options__section--global-node">
        <div className="mindmap-canvas-options__subhead">
          <strong>{text.globalNode}</strong>
        </div>
        <MindMapDefaultNodeStyle
          value={defaultTopicStyle}
          onChange={(next) => setDefaultTopicStyle(Object.keys(next).length > 0 ? next : null)}
          resetLabel={text.globalNodeReset}
          theme={current?.theme ?? DEFAULT_MIND_MAP_THEME}
        />
      </div>
    </section>
  )
}
