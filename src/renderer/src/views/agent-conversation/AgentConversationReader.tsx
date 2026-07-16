import {
  AlertCircle,
  Archive,
  Bell,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  FileText,
  GitFork,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  Wrench
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type {
  AgentConversationProvenanceItem,
  AgentConversationTurnPresentation
} from '../../agent-conversation-presentation'
import type {
  TeachingTurnAction,
  TeachingTurnPresentation
} from '../../teaching-turn-presentation'

/**
 * Renders either the learner-safe teaching projection or a deliberately
 * collapsed technical diagnostic adapter. Raw process labels, tool details,
 * answers, and provider payloads never reach the learner-facing DOM here.
 */
export function AgentConversationReader({
  presentation,
  teachingPresentation,
  onTeachingAction,
  compact = false
}: {
  presentation: AgentConversationTurnPresentation | undefined
  teachingPresentation?: TeachingTurnPresentation | undefined
  onTeachingAction?: (action: TeachingTurnAction) => void
  compact?: boolean
}) {
  if (teachingPresentation) {
    return <TeachingTurnReader presentation={teachingPresentation} onAction={onTeachingAction} compact={compact} />
  }
  if (!presentation || (presentation.items.length === 0 && presentation.answeredAsks.length === 0)) return null
  return <TechnicalConversationDiagnostics presentation={presentation} compact={compact} />
}

function TeachingTurnReader({
  presentation,
  onAction,
  compact
}: {
  presentation: TeachingTurnPresentation
  onAction?: (action: TeachingTurnAction) => void
  compact: boolean
}) {
  const actionRef = useRef<HTMLButtonElement>(null)
  const announcedIds = useRef(new Set<string>())
  const [liveAnnouncement, setLiveAnnouncement] = useState<string | null>(null)

  useEffect(() => {
    actionRef.current?.focus()
  }, [presentation.focusKey])

  useEffect(() => {
    const announcement = presentation.announcement
    if (!announcement || announcedIds.current.has(announcement.id)) return
    announcedIds.current.add(announcement.id)
    setLiveAnnouncement(announcement.message)
  }, [presentation.announcement])

  const activePhase = presentation.phases.find((phase) => phase.id === presentation.activePhaseId)
  return (
    <section className={`teaching-turn-panel${compact ? ' is-compact' : ''}`} aria-label="学习流程">
      <ol className="teaching-turn-panel__phases" aria-label="学习流程阶段">
        {presentation.phases.map((phase) => (
          <li key={phase.id} aria-current={phase.id === presentation.activePhaseId ? 'step' : undefined}>
            <strong>{phase.title}</strong>
            <span>{phase.statusText}</span>
          </li>
        ))}
      </ol>
      {activePhase ? (
        <p className="teaching-turn-panel__status" aria-label={`当前阶段：${activePhase.title}。${activePhase.statusText}`}>
          当前阶段：{activePhase.title}。{activePhase.statusText}
        </p>
      ) : null}
      {presentation.action ? (
        <button
          ref={actionRef}
          type="button"
          className="teaching-turn-panel__action"
          onClick={() => onAction?.(presentation.action!)}
          aria-label={presentation.action.label}
        >
          {presentation.action.label}
        </button>
      ) : null}
      {presentation.sourceIds.length > 0 ? (
        <details className="teaching-turn-panel__sources">
          <summary>来源摘要</summary>
          <ul aria-label="可信来源标识">
            {presentation.sourceIds.map((sourceId) => <li key={sourceId}>来源 {sourceId}</li>)}
          </ul>
        </details>
      ) : null}
      {liveAnnouncement ? <p className="sr-only" role="status" aria-live="polite">{liveAnnouncement}</p> : null}
      <details className="teaching-turn-panel__diagnostic">
        <summary>技术诊断</summary>
        <p>{presentation.technicalDiagnostic.label}</p>
      </details>
    </section>
  )
}

function TechnicalConversationDiagnostics({
  presentation,
  compact
}: {
  presentation: AgentConversationTurnPresentation
  compact: boolean
}) {
  return (
    <details className={`agent-process-panel${compact ? ' is-compact' : ''}`}>
      <summary className="agent-process-header">
        <BrainCircuit size={compact ? 13 : 14} />
        <strong>技术诊断</strong>
        <span>{presentation.active ? '进行中' : '已记录'}</span>
      </summary>
      <div className="agent-process-list" aria-label="技术处理状态">
        {presentation.items.map((item) => <TechnicalDiagnosticRow key={item.id} item={item} />)}
        {presentation.answeredAsks.length > 0 ? <p>已收到对话输入。</p> : null}
      </div>
    </details>
  )
}

function TechnicalDiagnosticRow({ item }: { item: AgentConversationProvenanceItem }) {
  return (
    <div className={`agent-process-event${item.state === 'error' ? ' is-error' : ''}${item.state === 'active' ? ' is-active' : ''}`}>
      <span className="agent-process-event-icon"><ProvenanceIcon item={item} /></span>
      <div className="agent-process-event-copy">
        <strong>{safeDiagnosticLabel(item.kind)}</strong>
        <small>{safeDiagnosticState(item.state)}</small>
      </div>
    </div>
  )
}

function safeDiagnosticLabel(kind: AgentConversationProvenanceItem['kind']): string {
  switch (kind) {
    case 'permission_request':
    case 'permission_resolved':
      return '权限处理'
    case 'elicitation_request':
    case 'elicitation_resolved':
      return '对话输入处理'
    case 'tool_call':
    case 'tool_result':
      return '技术步骤'
    case 'child_run':
      return '辅助任务'
    case 'compaction':
      return '上下文整理'
    case 'source':
      return '来源处理'
    case 'status':
      return '处理状态'
    default:
      return '技术活动'
  }
}

function safeDiagnosticState(state: AgentConversationProvenanceItem['state']): string {
  switch (state) {
    case 'active': return '正在处理'
    case 'complete': return '已完成'
    case 'error': return '需要注意'
    case 'canceled': return '已取消'
    case 'pending': return '等待处理'
  }
}

function ProvenanceIcon({ item }: { item: AgentConversationProvenanceItem }) {
  if (item.state === 'error') return <AlertCircle size={13} />
  if (item.state === 'active') return <Loader2 className="spin" size={13} />
  if (item.kind === 'permission_request') return <Bell size={13} />
  if (item.kind === 'permission_resolved' || item.kind === 'elicitation_resolved' || item.kind === 'tool_result') {
    return <CheckCircle2 size={13} />
  }
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