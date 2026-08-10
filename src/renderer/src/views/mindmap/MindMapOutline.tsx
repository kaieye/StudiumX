import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MindMapSheetV2, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'

type MindMapOutlineProps = {
  sheet: MindMapSheetV2
  selectedNodeId: string | null
  onSelect: (nodeId: string) => void
  onToggleCollapse: (nodeId: string) => void
}

/**
 * Keyboard-friendly outline for the active sheet.
 *
 * The outline deliberately shares the canvas selection and collapse command
 * rather than maintaining a second tree state. This keeps navigation and
 * editing in sync when the user switches between the outline and the canvas.
 */
export function MindMapOutline({
  sheet,
  selectedNodeId,
  onSelect,
  onToggleCollapse
}: MindMapOutlineProps) {
  const { t } = useTranslation()
  const topicCount = countTopics(sheet.root)

  return (
    <section className="mindmap-outline" aria-labelledby="mindmap-outline-title">
      <div className="mindmap-outline__head">
        <strong id="mindmap-outline-title">{t('mindmap.outline')}</strong>
        <span>{t('mindmap.outlineTopics', { count: topicCount })}</span>
      </div>
      <div
        className="mindmap-outline__tree"
        role="tree"
        aria-label={`${sheet.title} outline`}
        aria-orientation="vertical"
      >
        <MindMapOutlineItem
          node={sheet.root}
          level={1}
          selectedNodeId={selectedNodeId}
          onSelect={onSelect}
          onToggleCollapse={onToggleCollapse}
          untitledLabel={t('mindmap.untitledTopic')}
          collapseLabel={(title) => t('mindmap.collapseTopic', { title })}
          expandLabel={(title) => t('mindmap.expandTopic', { title })}
        />
      </div>
    </section>
  )
}

type MindMapOutlineItemProps = {
  node: MindMapTopicV2
  level: number
  selectedNodeId: string | null
  onSelect: (nodeId: string) => void
  onToggleCollapse: (nodeId: string) => void
  untitledLabel: string
  collapseLabel: (title: string) => string
  expandLabel: (title: string) => string
}

function MindMapOutlineItem({
  node,
  level,
  selectedNodeId,
  onSelect,
  onToggleCollapse,
  untitledLabel,
  collapseLabel,
  expandLabel
}: MindMapOutlineItemProps) {
  const hasChildren = node.children.length > 0
  const isCollapsed = node.collapsed === true
  const isSelected = node.id === selectedNodeId
  const title = node.title.trim() || untitledLabel

  const selectNode = (): void => {
    onSelect(node.id)
  }

  return (
    <div role="none" className="mindmap-outline__item-wrap">
      <div
        className={`mindmap-outline__item${isSelected ? ' is-selected' : ''}`}
        role="treeitem"
        aria-selected={isSelected}
        aria-level={level}
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        tabIndex={isSelected || (selectedNodeId === null && level === 1) ? 0 : -1}
        data-node-id={node.id}
        onClick={selectNode}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            selectNode()
          } else if (event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault()
            event.stopPropagation()
            if (hasChildren) onToggleCollapse(node.id)
          } else if (event.key === 'ArrowRight' && hasChildren && isCollapsed) {
            event.preventDefault()
            event.stopPropagation()
            onToggleCollapse(node.id)
          } else if (event.key === 'ArrowLeft' && hasChildren && !isCollapsed) {
            event.preventDefault()
            event.stopPropagation()
            onToggleCollapse(node.id)
          }
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="mindmap-outline__toggle"
            aria-label={isCollapsed ? expandLabel(title) : collapseLabel(title)}
            onClick={(event) => {
              event.stopPropagation()
              onSelect(node.id)
              onToggleCollapse(node.id)
            }}
          >
            {isCollapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
          </button>
        ) : (
          <span className="mindmap-outline__toggle-placeholder" aria-hidden="true" />
        )}
        <span className="mindmap-outline__title">{title}</span>
      </div>
      {hasChildren && !isCollapsed ? (
        <div role="group" className="mindmap-outline__children">
          {node.children.map((child) => (
            <MindMapOutlineItem
              key={child.id}
              node={child}
              level={level + 1}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              onToggleCollapse={onToggleCollapse}
              untitledLabel={untitledLabel}
              collapseLabel={collapseLabel}
              expandLabel={expandLabel}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function countTopics(node: MindMapTopicV2): number {
  return 1 + node.children.reduce((total, child) => total + countTopics(child), 0)
}
