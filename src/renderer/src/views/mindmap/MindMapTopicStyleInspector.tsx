import { useTranslation } from 'react-i18next'
import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'
import type { MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
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

/**
 * Small, command-backed inspector for the one topic style field with a visible
 * renderer effect today: a topic's structure-class layout override.
 *
 * The inspector edits only `style.structureClass`. Other style overrides stay
 * intact, and clearing the selector removes the override so the topic inherits
 * its sheet layout again. `updateNode` funnels both paths through the normal
 * undo/redo and revisioned persistence lane.
 */
export function MindMapTopicStyleInspector() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const selectedNodeId = useMindMapViewStore((state) => state.selectedNodeId)
  const updateNode = useMindMapViewStore((state) => state.updateNode)

  const activeSheet =
    current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0] ?? null
  const selectedTopic =
    activeSheet && selectedNodeId ? findMindMapTopic(activeSheet.root, selectedNodeId) : null
  const selectedStructureClass = selectedTopic?.style?.structureClass
  const effectiveStructureClass = selectedStructureClass ?? activeSheet?.layout.structureClass
  const hasSelection = selectedTopic !== null

  const updateStructureClass = (value: string): void => {
    if (!selectedTopic) return

    if (value === '') {
      if (selectedTopic.style?.structureClass === undefined) return
      const nextStyle = { ...(selectedTopic.style ?? {}) }
      delete nextStyle.structureClass
      updateNode(selectedTopic.id, {
        style: Object.keys(nextStyle).length > 0 ? nextStyle : null
      })
      return
    }

    const option = MIND_MAP_TOPIC_STYLE_LAYOUT_OPTIONS.find((candidate) => candidate.value === value)
    if (!option || selectedTopic.style?.structureClass === option.value) return

    updateNode(selectedTopic.id, {
      style: { ...(selectedTopic.style ?? {}), structureClass: option.value }
    })
  }

  return (
    <section className="mindmap-topic-style" aria-labelledby="mindmap-topic-style-title">
      <div className="mindmap-topic-style__head">
        <strong id="mindmap-topic-style-title">{t('mindmap.topicStyle.title')}</strong>
        {selectedTopic ? (
          <span title={selectedTopic.title || t('mindmap.untitledTopic')}>
            {selectedTopic.title || t('mindmap.untitledTopic')}
          </span>
        ) : null}
      </div>
      {!hasSelection ? (
        <p className="mindmap-topic-style__empty">{t('mindmap.topicStyle.noSelection')}</p>
      ) : (
        <div className="mindmap-topic-style__body">
          <label htmlFor="mindmap-topic-style-layout">
            {t('mindmap.topicStyle.layoutLabel')}
          </label>
          <select
            id="mindmap-topic-style-layout"
            value={selectedStructureClass ?? ''}
            onChange={(event) => updateStructureClass(event.currentTarget.value)}
          >
            <option value="">{t('mindmap.topicStyle.inherit')}</option>
            {MIND_MAP_TOPIC_STYLE_LAYOUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(`mindmap.topicStyle.layouts.${option.labelKey}`)}
              </option>
            ))}
          </select>
          {effectiveStructureClass ? (
            <span className="mindmap-topic-style__effective">
              {t('mindmap.topicStyle.effective', {
                layout: topicStyleLayoutLabel(t, effectiveStructureClass)
              })}
            </span>
          ) : null}
        </div>
      )}
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
