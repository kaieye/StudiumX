import { useTranslation } from 'react-i18next'
import type { MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import { useMindMapViewStore } from './mind-map-view-store'
import { MARKER_GROUPS } from './mind-map-marker-icons'

/**
 * Markers/icons picker panel for the selected topic (StudiumX-style).
 *
 * Offers a curated set of SVG marker icons (priority, task progress, flags,
 * stars, symbols) that can be attached to or removed
 * from the selected topic.  Uses original SVG icons inspired by StudiumX's
 * marker system.
 */

export function MindMapMarkersPanel() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const selectedNodeId = useMindMapViewStore((state) => state.selectedNodeId)
  const updateNode = useMindMapViewStore((state) => state.updateNode)

  const activeSheet =
    current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0] ?? null
  const selectedTopic =
    activeSheet && selectedNodeId ? findMindMapTopic(activeSheet.root, selectedNodeId) : null

  if (!selectedTopic) return null

  const markers = selectedTopic.markers ?? []
  const hasMarker = (markerId: string): boolean =>
    markers.some((m) => m.id === markerId || m.label === markerId)

  const toggleMarker = (markerId: string, labelKey: string): void => {
    const isActive = hasMarker(markerId)
    let nextMarkers
    if (isActive) {
      nextMarkers = markers.filter((m) => m.id !== markerId && m.label !== markerId)
    } else {
      nextMarkers = [
        ...markers,
        {
          id: markerId,
          symbol: markerId,
          label: t(`mindmap.markers.${labelKey}`)
        }
      ]
    }
    updateNode(selectedTopic.id, { markers: nextMarkers.length > 0 ? nextMarkers : null })
  }

  return (
    <section className="mindmap-markers-panel" aria-labelledby="mindmap-markers-title">
      <div className="mindmap-markers-panel__head">
        <strong id="mindmap-markers-title">{t('mindmap.markersPanel.title')}</strong>
      </div>
      <div className="mindmap-markers-panel__body">
        {MARKER_GROUPS.map((group) => (
          <div key={group.labelKey} className="mindmap-markers-panel__group">
            <span className="mindmap-markers-panel__group-label">
              {t(`mindmap.markersPanel.${group.labelKey}`)}
            </span>
            <div className="mindmap-markers-panel__icons">
              {group.markers.map((marker) => {
                const active = hasMarker(marker.id)
                return (
                  <button
                    key={marker.id}
                    type="button"
                    className={`mindmap-markers-panel__icon${active ? ' is-active' : ''}`}
                    title={t(`mindmap.markers.${marker.labelKey}`)}
                    aria-label={t(`mindmap.markers.${marker.labelKey}`)}
                    aria-pressed={active}
                    onClick={() => toggleMarker(marker.id, marker.labelKey)}
                  >
                    {marker.render()}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function findMindMapTopic(node: MindMapTopicV2, id: string): MindMapTopicV2 | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findMindMapTopic(child, id)
    if (found) return found
  }
  return null
}
