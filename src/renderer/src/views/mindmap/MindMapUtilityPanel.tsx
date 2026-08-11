import { FileText, ListTree, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MindMapSourceRef, MindMapSheetV2 } from '../../../../shared/mindmap/domain/types'
import type { MindMapSourceRefreshApplyResult } from '../../../../shared/teaching-types/mindmap'
import { MindMapOutline } from './MindMapOutline'
import { MindMapSearchPanel } from './MindMapSearchPanel'
import { MindMapSourcePanel } from './MindMapSourcePanel'

export type MindMapUtilityPanelKind = 'search' | 'sources' | 'outline'

type MindMapUtilityPanelProps = {
  panel: MindMapUtilityPanelKind
  sheet: MindMapSheetV2
  selectedNodeId: string | null
  workspaceId?: string | null
  documentId?: string | null
  onClose: () => void
  onSelect: (nodeId: string) => void
  onToggleCollapse: (nodeId: string) => void
  onReplace: (nodeId: string, query: string, replacement: string) => void
  onReplaceAll: (nodeIds: string[], query: string, replacement: string) => void
  onOpenSource: (sourceRef: MindMapSourceRef) => void
  onSourceRefreshApplied?: (
    result: Extract<MindMapSourceRefreshApplyResult, { ok: true }>
  ) => void
}

/**
 * One focused, right-side utility surface for the editor's search, source, and
 * outline tools. Keeping the tools in a single surface avoids reintroducing a
 * persistent left navigation rail while preserving their existing behavior.
 */
export function MindMapUtilityPanel({
  panel,
  sheet,
  selectedNodeId,
  workspaceId,
  documentId,
  onClose,
  onSelect,
  onToggleCollapse,
  onReplace,
  onReplaceAll,
  onOpenSource,
  onSourceRefreshApplied
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
          {panel === 'sources' ? <FileText size={15} aria-hidden="true" /> : null}
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
        {panel === 'sources' ? (
          <MindMapSourcePanel
            root={sheet.root}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
            onOpenSource={onOpenSource}
            workspaceId={workspaceId}
            documentId={documentId}
            onSourceRefreshApplied={onSourceRefreshApplied}
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
  if (panel === 'sources') return t('mindmap.sources')
  return t('mindmap.outline')
}
