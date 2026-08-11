import { useTranslation } from 'react-i18next'
import type { MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import { useMindMapViewStore } from './mind-map-view-store'

/**
 * Notes editor panel for the selected topic (Xmind-style).
 *
 * Displays and edits the `note` field of the selected topic.
 * Changes funnel through the normal command/undo-redo path.
 */
export function MindMapNotesPanel() {
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

  const handleNoteChange = (value: string): void => {
    updateNode(selectedTopic.id, { note: value || null })
  }

  return (
    <section className="mindmap-notes-panel" aria-labelledby="mindmap-notes-title">
      <div className="mindmap-notes-panel__head">
        <strong id="mindmap-notes-title">{t('mindmap.notesPanel.title')}</strong>
        <span title={selectedTopic.title || t('mindmap.untitledTopic')}>
          {selectedTopic.title || t('mindmap.untitledTopic')}
        </span>
      </div>
      <textarea
        className="mindmap-notes-panel__input"
        value={selectedTopic.note ?? ''}
        placeholder={t('mindmap.notesPanel.placeholder')}
        onChange={(event) => handleNoteChange(event.currentTarget.value)}
        rows={4}
      />
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
