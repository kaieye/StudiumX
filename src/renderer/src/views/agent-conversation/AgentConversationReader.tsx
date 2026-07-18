import {
  AlertCircle,
  Archive,
  Bell,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  GitFork,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  Wrench
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  AgentConversationProvenanceItem,
  AgentConversationTurnPresentation
} from '../../agent-conversation-presentation'
import type {
  TeachingTurnAction,
  TeachingTurnPresentation
} from '../../teaching-turn-presentation'

/**
 * Older renderer fixtures and partial projections predate the structured status.
 * Their `active` flag remains the compatibility source of truth when it is absent.
 */
type AgentConversationReaderPresentation = Omit<AgentConversationTurnPresentation, 'status'> & {
  status?: AgentConversationTurnPresentation['status'] | null
}

/** Renders the live agent process or the learner-facing teaching projection. */
export function AgentConversationReader({
  presentation,
  teachingPresentation,
  onTeachingAction,
  compact = false
}: {
  presentation: AgentConversationReaderPresentation | undefined
  teachingPresentation?: TeachingTurnPresentation | undefined
  onTeachingAction?: (action: TeachingTurnAction) => void
  compact?: boolean
}) {
  if (teachingPresentation) {
    return <TeachingTurnReader presentation={teachingPresentation} onAction={onTeachingAction} compact={compact} />
  }
  if (!presentation || (presentation.items.length === 0 && presentation.answeredAsks.length === 0)) return null
  return <AgentProcessReader presentation={presentation} compact={compact} />
}

function TeachingTurnReader({ presentation, onAction, compact }: {
  presentation: TeachingTurnPresentation
  onAction?: (action: TeachingTurnAction) => void
  compact: boolean
}) {
  const actionRef = useRef<HTMLButtonElement>(null)
  const announcedIds = useRef(new Set<string>())
  const [liveAnnouncement, setLiveAnnouncement] = useState<string | null>(null)
  useEffect(() => { actionRef.current?.focus() }, [presentation.focusKey])
  useEffect(() => {
    const announcement = presentation.announcement
    if (!announcement || announcedIds.current.has(announcement.id)) return
    announcedIds.current.add(announcement.id)
    setLiveAnnouncement(announcement.message)
  }, [presentation.announcement])
  const activePhase = presentation.phases.find((phase) => phase.id === presentation.activePhaseId)
  return (
    <section className={`teaching-turn-panel${compact ? ' is-compact' : ''}`} aria-label={presentation.accessibleNames.region}>
      <ol className="teaching-turn-panel__phases" aria-label={presentation.accessibleNames.phaseList}>
        {presentation.phases.map((phase) => (
          <li key={phase.id} aria-current={phase.id === presentation.activePhaseId ? 'step' : undefined}>
            <strong>{phase.title}</strong><span>{phase.statusText}</span>
          </li>
        ))}
      </ol>
      {activePhase ? (
        <p className="teaching-turn-panel__status" role="note" aria-label={presentation.accessibleNames.currentPhase}>
          {presentation.accessibleNames.currentPhase}
        </p>
      ) : null}
      {presentation.action ? (
        <button ref={actionRef} type="button" className="teaching-turn-panel__action"
          onClick={() => onAction?.(presentation.action!)} aria-label={presentation.action.label}>
          {presentation.action.label}
        </button>
      ) : null}
      {presentation.sourceIds.length > 0 ? (
        <details className="teaching-turn-panel__sources">
          <summary>来源摘要</summary>
          <ul aria-label={presentation.accessibleNames.sourceList}>
            {presentation.sourceIds.map((sourceId) => <li key={sourceId}>来源 {sourceId}</li>)}
          </ul>
        </details>
      ) : null}
      {liveAnnouncement ? <p className="sr-only" role="status" aria-live="polite">{liveAnnouncement}</p> : null}
    </section>
  )
}

type AgentProcessDisplayRow =
  | { id: string; type: 'single'; item: AgentConversationProvenanceItem }
  | { id: string; type: 'rollup'; items: AgentConversationProvenanceItem[] }

type ProcessRollTransition = {
  from: AgentConversationProvenanceItem
  to: AgentConversationProvenanceItem
}

function AgentProcessReader({ presentation, compact }: {
  presentation: AgentConversationReaderPresentation
  compact: boolean
}) {
  const rows = groupRepeatedProcessDescriptions(presentation.items)
  const header = processHeaderFor(presentation.status?.kind, presentation.active)
  return (
    <section className={`agent-process-panel${compact ? ' is-compact' : ''}`} aria-label="AI 处理过程">
      <header className="agent-process-header">
        {header.icon === 'attention' ? <Bell size={compact ? 13 : 14} /> : <BrainCircuit size={compact ? 13 : 14} />}
        <strong>{header.title}</strong>
        <span>{header.label}</span>
      </header>
      <div className="agent-process-list" aria-live="polite">
        {rows.map((row) => row.type === 'rollup'
          ? <RepeatedProcessRow key={`${presentation.turnId}:${row.id}`} items={row.items} />
          : <AgentProcessRow key={row.id} item={row.item} />)}
      </div>
    </section>
  )
}

function processHeaderFor(status: unknown, active: boolean): {
  title: string
  label: string
  icon?: 'attention'
} {
  switch (status) {
    case 'active': return { title: '规划中', label: '进行中' }
    case 'completed': return { title: '规划中', label: '已完成' }
    case 'failed': return { title: '处理失败', label: '发生错误' }
    case 'canceled': return { title: '处理已取消', label: '已取消' }
    case 'interrupted': return { title: '运行中断', label: '需确认', icon: 'attention' }
    default: return { title: '规划中', label: active ? '进行中' : '已完成' }
  }
}

function groupRepeatedProcessDescriptions(items: AgentConversationProvenanceItem[]): AgentProcessDisplayRow[] {
  const rows: AgentProcessDisplayRow[] = []
  const rollups = new Map<string, Extract<AgentProcessDisplayRow, { type: 'rollup' }>>()
  for (const item of items) {
    if (!isRollupDescription(item)) {
      rows.push({ id: item.id, type: 'single', item })
      continue
    }
    const rollupId = `rollup:${item.kind}:${item.label}`
    const existing = rollups.get(rollupId)
    if (existing) {
      existing.items.push(item)
      continue
    }
    const rollup: Extract<AgentProcessDisplayRow, { type: 'rollup' }> = {
      id: rollupId,
      type: 'rollup',
      items: [item]
    }
    rollups.set(rollupId, rollup)
    rows.push(rollup)
  }
  return rows
}

function isRollupDescription(item: AgentConversationProvenanceItem): boolean {
  return Boolean(item.detail) && (item.kind === 'status' || item.kind === 'child_run' || item.kind === 'compaction')
}

function RepeatedProcessRow({ items }: { items: AgentConversationProvenanceItem[] }) {
  const latest = items[items.length - 1]
  const [expanded, setExpanded] = useState(false)
  const hasHistory = items.length > 1
  return (
    <div className={`agent-process-event${latest.state === 'error' ? ' is-error' : ''}${latest.state === 'active' ? ' is-active' : ''}`}>
      <span className="agent-process-event-icon"><ProcessIcon item={latest} /></span>
      <div className="agent-process-event-copy">
        <div className="agent-process-event-title">
          <strong>{latest.label}</strong>
          {hasHistory ? (
            <button
              type="button"
              className="agent-process-reasoning-toggle"
              aria-expanded={expanded}
              aria-label={expanded ? `折叠${latest.label}历史` : `展开${latest.label}历史`}
              onClick={() => setExpanded((value) => !value)}
            >
              <ChevronDown className={expanded ? 'is-open' : undefined} size={14} />
            </button>
          ) : null}
        </div>
        {expanded ? (
          <div className="agent-process-rollup-history" role="list" aria-label={`${latest.label}历史`}>
            {items.map((item) => (
              <small key={item.id} role="listitem">{processDescription(item)}</small>
            ))}
          </div>
        ) : (
          <RollingProcessDescription item={latest} />
        )}
      </div>
    </div>
  )
}

function RollingProcessDescription({ item }: { item: AgentConversationProvenanceItem }) {
  const [displayed, setDisplayed] = useState(item)
  const [transition, setTransition] = useState<ProcessRollTransition | null>(null)
  useLayoutEffect(() => {
    if (item.id === displayed.id) return
    setTransition({ from: displayed, to: item })
  }, [displayed, item])

  const finishTransition = (target: AgentConversationProvenanceItem) => {
    setDisplayed(target)
    setTransition(null)
  }

  useEffect(() => {
    if (!transition) return
    const timeoutId = window.setTimeout(() => finishTransition(transition.to), 280)
    return () => window.clearTimeout(timeoutId)
  }, [transition])

  if (!transition) {
    return <small className="agent-process-rollup-line">{processDescription(displayed)}</small>
  }
  return (
    <span className="agent-process-rollup-viewport">
      <small className="agent-process-rollup-line is-leaving" aria-hidden="true">
        {processDescription(transition.from)}
      </small>
      <small
        className="agent-process-rollup-line is-entering"
        onAnimationEnd={() => finishTransition(transition.to)}
      >
        {processDescription(transition.to)}
      </small>
    </span>
  )
}

function processDescription(item: AgentConversationProvenanceItem): string {
  return item.detail || item.label
}

function AgentProcessRow({ item }: { item: AgentConversationProvenanceItem }) {
  if (item.kind === 'reasoning' && item.detail) return <ReasoningProcessRow item={item} />
  return (
    <div className={`agent-process-event${item.state === 'error' ? ' is-error' : ''}${item.state === 'active' ? ' is-active' : ''}`}>
      <span className="agent-process-event-icon"><ProcessIcon item={item} /></span>
      <div className="agent-process-event-copy">
        <strong>{item.label}</strong>
        {item.detail ? <small>{item.detail}</small> : null}
      </div>
    </div>
  )
}

function ReasoningProcessRow({ item }: { item: AgentConversationProvenanceItem }) {
  const [expanded, setExpanded] = useState(false)
  const [detailMaxHeight, setDetailMaxHeight] = useState<number | null>(null)
  const [hasOverflow, setHasOverflow] = useState(false)
  const detailRef = useRef<HTMLElement>(null)
  const isActive = item.state === 'active'
  const isCollapsed = !isActive && !expanded
  useLayoutEffect(() => {
    const node = detailRef.current
    if (!node) return
    const computedLineHeight = Number.parseFloat(window.getComputedStyle(node).lineHeight)
    const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : 16.675
    const collapsedHeight = lineHeight * 3
    const fullHeight = Math.max(node.scrollHeight, collapsedHeight)
    setHasOverflow(node.scrollHeight > collapsedHeight + 1)
    setDetailMaxHeight(isCollapsed ? collapsedHeight : fullHeight)
  }, [isCollapsed, item.detail])
  return (
    <div className={`agent-process-event${isActive ? ' is-active' : ''}`}>
      <span className="agent-process-event-icon"><ProcessIcon item={item} /></span>
      <div className="agent-process-event-copy">
        <div className="agent-process-event-title">
          <strong>{item.label}</strong>
          {!isActive ? (
            <button
              type="button"
              className="agent-process-reasoning-toggle"
              aria-expanded={expanded}
              aria-label={expanded ? '折叠思考过程' : '展开思考过程'}
              onClick={() => setExpanded((value) => !value)}
            >
              <ChevronDown className={expanded ? 'is-open' : undefined} size={14} />
            </button>
          ) : null}
        </div>
        <small
          ref={detailRef}
          className={`has-height-transition${isCollapsed ? ' is-collapsed' : ''}${hasOverflow ? ' has-overflow' : ''}`}
          style={detailMaxHeight === null ? undefined : { maxHeight: `${detailMaxHeight}px` }}
        >
          {item.detail}
        </small>
      </div>
    </div>
  )
}

function ProcessIcon({ item }: { item: AgentConversationProvenanceItem }) {
  if (item.state === 'interrupted') return <Bell size={13} />
  if (item.state === 'error') return <AlertCircle size={13} />
  if (item.state === 'active') return <Loader2 className="spin" size={13} />
  if (item.kind === 'reasoning') return <BrainCircuit size={13} />
  if (item.kind === 'permission_request') return <Bell size={13} />
  if (item.kind === 'permission_resolved' || item.kind === 'elicitation_resolved' || item.kind === 'tool_result') return <CheckCircle2 size={13} />
  if (item.kind === 'elicitation_request') return <MessageSquare size={13} />
  if (item.kind === 'child_run') return <GitFork size={13} />
  if (item.kind === 'compaction') return <Archive size={13} />
  if (item.kind === 'source') return <FileText size={13} />
  if (item.kind === 'tool_call') return <Search size={13} />
  if (item.state === 'complete') return <CheckCircle2 size={13} />
  if (item.kind === 'status') return <Sparkles size={13} />
  if (item.state === 'pending') return <Wrench size={13} />
  return <Clock3 size={13} />
}
