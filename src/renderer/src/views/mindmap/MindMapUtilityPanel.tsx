import { ListTree, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MindMapSheetV2 } from '../../../../shared/mindmap/domain/types'
import { MindMapOutline } from './MindMapOutline'
import { MindMapSearchPanel } from './MindMapSearchPanel'

export type MindMapUtilityPanelKind = 'search' | 'outline'

type MindMapUtilityPanelProps = {
  panel: MindMapUtilityPanelKind
  sheet: MindMapSheetV2
  selectedNodeId: string | null
  onClose: () => void
  onSelect: (nodeId: string) => void
  onToggleCollapse: (nodeId: string) => void
  onReplace: (nodeId: string, query: string, replacement: string) => void
  onReplaceAll: (nodeIds: string[], query: string, replacement: string) => void
}

/**
 * One focused, right-side utility surface for the editor's search and outline
 * tools. Keeping the tools in a single surface avoids reintroducing a
 * persistent left navigation rail while preserving their existing behavior.
 */
export function MindMapUtilityPanel({
  panel,
  sheet,
  selectedNodeId,
  onClose,
  onSelect,
  onToggleCollapse,
  onReplace,
  onReplaceAll
}: MindMapUtilityPanelProps) {
  const { t } = useTranslation()
  const label = panelLabel(panel, t)

  return (
    <aside
      className={`mindmap-utility-panel mindmap-utility-panel--${panel}`}
      aria-label={label}
    >
      <div className="mindmap-utility-panel__header">
        <strong>
          {panel === 'search' ? <Search size={15} aria-hidden="true" /> : null}
          {panel === 'outline' ? <ListTree size={15} aria-hidden="true" /> : null}
          {label}
        </strong>
        <button
          type="button"
          className="mindmap-utility-panel__close"
          onClick={onClose}
          title={t('mindmap.closeUtilityPanel')}
          aria-label={t('mindmap.closeUtilityPanel')}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="mindmap-utility-panel__content">
        {panel === 'search' ? (
          <MindMapSearchPanel
            root={sheet.root}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
            onReplace={onReplace}
            onReplaceAll={onReplaceAll}
          />
        ) : null}
        {panel === 'outline' ? (
          <MindMapOutline
            sheet={sheet}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
            onToggleCollapse={onToggleCollapse}
          />
        ) : null}
      </div>
    </aside>
  )
}

function panelLabel(
  panel: MindMapUtilityPanelKind,
  t: (key: string) => string
): string {
  if (panel === 'search') return t('mindmap.search')
  return t('mindmap.outline')
}
