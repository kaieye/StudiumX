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
import { useState } from 'react'
import type {
  AgentConversationProvenanceItem,
  AgentConversationTurnPresentation
} from '../../agent-conversation-presentation'

export function AgentConversationReader({
  presentation,
  compact = false
}: {
  presentation: AgentConversationTurnPresentation | undefined
  compact?: boolean
}) {
  if (!presentation || presentation.items.length === 0) return null
  return (
    <>
      <div className={`agent-process-panel${compact ? ' is-compact' : ''}`}>
        <div className="agent-process-header">
          <BrainCircuit size={compact ? 13 : 14} />
          <strong>思考过程</strong>
          <span>{presentation.active ? '进行中' : '已记录'}</span>
        </div>
        <div className="agent-process-list">
          {presentation.items.map((item) => <ProvenanceRow key={item.id} item={item} />)}
        </div>
      </div>
      {presentation.answeredAsks.map((ask) => <AnsweredAskBlock key={ask.id} answer={ask.answer} />)}
    </>
  )
}

function ProvenanceRow({ item }: { item: AgentConversationProvenanceItem }) {
  const [open, setOpen] = useState(false)
  const disclosure = item.disclosure
  return (
    <div className={`agent-process-event${item.state === 'error' ? ' is-error' : ''}${item.state === 'active' ? ' is-active' : ''}`}>
      <span className="agent-process-event-icon">
        <ProvenanceIcon item={item} />
      </span>
      <div className="agent-process-event-copy">
        <strong>{item.label}</strong>
        {item.detail ? <small>{item.detail}</small> : null}
        {disclosure?.eligible ? (
          <div className="agent-process-tool-detail">
            <button
              aria-expanded={open}
              className="agent-process-tool-detail-trigger"
              type="button"
              onClick={() => setOpen((current) => !current)}
            >
              <span>{disclosure.label}</span>
              <ChevronDown className={open ? 'is-open' : ''} size={12} />
            </button>
            {open ? (
              <div className="tool-call-body is-inline">
                {disclosure.arguments ? <DisclosureSection title="参数" value={disclosure.arguments} /> : null}
                {disclosure.result ? <DisclosureSection title="结果" value={disclosure.result} /> : null}
                {disclosure.notice ? <DisclosureSection title="结果" value={disclosure.notice} /> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function DisclosureSection({ title, value }: { title: string; value: string }) {
  return (
    <div className="tool-call-section">
      <div>{title}</div>
      <pre>{value}</pre>
    </div>
  )
}

function AnsweredAskBlock({ answer }: { answer: string }) {
  return (
    <div className="ask-qa-block">
      <div className="ask-qa-block__head">
        <CheckCircle2 size={13} />
        <span>已询问用户</span>
      </div>
      <div className="ask-qa-block__body">
        {answer.split(/\n\n/).map((block, index) => (
          <div key={index} className="ask-qa-block__item">
            {block.split('\n').map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}
          </div>
        ))}
      </div>
    </div>
  )
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
