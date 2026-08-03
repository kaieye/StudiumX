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
import { redactAgentSecretText } from '../../../../shared/agent-secret-redaction'

/**
 * Older renderer fixtures and partial projections predate the structured status.
 * Their `active` flag remains the compatibility source of truth when it is absent.
 */
type AgentConversationReaderPresentation = Omit<AgentConversationTurnPresentation, 'status'> & {
  status?: AgentConversationTurnPresentation['status'] | null
}

/**
 * Renders either the learner-safe teaching projection or the agent process panel.
 * Teaching technical diagnostics come only from TeachingTurnPresentation; process
 * secondary text and primary labels are allow-listed/redacted before they reach the DOM.
 */
export function AgentConversationReader({
  presentation,
  teachingPresentation,
  onTeachingAction,
  openTeachingSourcesKey = null,
  compact = false
}: {
  presentation: AgentConversationReaderPresentation | undefined
  teachingPresentation?: TeachingTurnPresentation | undefined
  onTeachingAction?: (action: TeachingTurnAction) => void
  /** When this key changes, expand the trusted-sources disclosure (show_source command). */
  openTeachingSourcesKey?: string | number | null
  compact?: boolean
}) {
  if (teachingPresentation) {
    return (
      <TeachingTurnReader
        presentation={teachingPresentation}
        onAction={onTeachingAction}
        openSourcesKey={openTeachingSourcesKey}
        compact={compact}
      />
    )
  }
  if (!presentation || (presentation.items.every((item) => item.kind === 'reasoning') && presentation.answeredAsks.length === 0)) {
    return null
  }
  return <AgentProcessReader presentation={presentation} compact={compact} />
}

function TeachingTurnReader({ presentation, onAction, openSourcesKey, compact }: {
  presentation: TeachingTurnPresentation
  onAction?: (action: TeachingTurnAction) => void
  openSourcesKey?: string | number | null
  compact: boolean
}) {
  const actionRef = useRef<HTMLButtonElement>(null)
  const sourcesRef = useRef<HTMLDetailsElement>(null)
  const announcedIds = useRef(new Set<string>())
  const [liveAnnouncement, setLiveAnnouncement] = useState<string | null>(null)
  useEffect(() => { actionRef.current?.focus() }, [presentation.focusKey])
  useEffect(() => {
    const announcement = presentation.announcement
    if (!announcement || announcedIds.current.has(announcement.id)) return
    announcedIds.current.add(announcement.id)
    setLiveAnnouncement(announcement.message)
  }, [presentation.announcement])
  useEffect(() => {
    if (openSourcesKey == null) return
    const node = sourcesRef.current
    if (!node) return
    node.open = true
  }, [openSourcesKey])
  const activePhase = presentation.phases.find((phase) => phase.id === presentation.activePhaseId)
  const needsYou = activePhase?.state === 'needs_you'
  const yourTurnId = `teaching-your-turn-${presentation.focusKey}`
  return (
    <section
      className={`teaching-turn-panel${compact ? ' is-compact' : ''}${needsYou ? ' is-your-turn' : ''}`}
      aria-label={presentation.accessibleNames.region}
      data-focus-key={presentation.focusKey}
    >
      <ol className="teaching-turn-panel__phases" aria-label={presentation.accessibleNames.phaseList}>
        {presentation.phases.map((phase) => (
          <li key={phase.id} aria-current={phase.id === presentation.activePhaseId ? 'step' : undefined}>
            <strong>{phase.title}</strong><span>{phase.statusText}</span>
          </li>
        ))}
      </ol>
      {activePhase ? (
        <p
          id={yourTurnId}
          className="teaching-turn-panel__status teaching-turn-panel__your-turn"
          role={needsYou ? 'status' : 'note'}
          aria-live={needsYou ? 'polite' : 'off'}
          aria-atomic="true"
          aria-label={presentation.accessibleNames.currentPhase}
          data-phase-state={activePhase.state}
        >
          {presentation.accessibleNames.currentPhase}
        </p>
      ) : null}
      {presentation.action ? (
        <button
          ref={actionRef}
          type="button"
          className="teaching-turn-panel__action"
          onClick={() => onAction?.(presentation.action!)}
          aria-label={presentation.action.label}
          aria-describedby={activePhase ? yourTurnId : undefined}
        >
          {presentation.action.label}
        </button>
      ) : null}
      {presentation.sourceIds.length > 0 ? (
        <details ref={sourcesRef} className="teaching-turn-panel__sources">
          <summary aria-label={presentation.accessibleNames.sourceList}>来源摘要</summary>
          <ul aria-label={presentation.accessibleNames.sourceList}>
            {presentation.sourceIds.map((sourceId) => <li key={sourceId}>来源 {sourceId}</li>)}
          </ul>
        </details>
      ) : null}
      {liveAnnouncement ? <p className="sr-only" role="status" aria-live="polite">{liveAnnouncement}</p> : null}
      <details className="teaching-turn-panel__diagnostic">
        <summary aria-label={`技术诊断：${presentation.technicalDiagnostic.label}`}>技术诊断</summary>
        <p data-diagnostic-state={presentation.technicalDiagnostic.state}>{presentation.technicalDiagnostic.label}</p>
      </details>
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
  // Raw provider reasoning is not a learner-facing diagnostic. This second
  // boundary also protects legacy or malformed presentations that bypass the
  // normal conversation projector.
  const rows = groupRepeatedProcessDescriptions(presentation.items.filter((item) => item.kind !== 'reasoning'))
  const header = processHeaderFor(presentation.status?.kind, presentation.active)
  const canCollapse = header.title === '思考结束' && !presentation.active
  const [expanded, setExpanded] = useState(() => !canCollapse)
  const previous = useRef({ turnId: presentation.turnId, canCollapse })
  const contentId = `agent-process-content-${presentation.turnId}`

  useEffect(() => {
    if (previous.current.turnId !== presentation.turnId) {
      setExpanded(!canCollapse)
    } else if (!previous.current.canCollapse && canCollapse) {
      // The active thinking panel stays open until the turn settles, then folds away.
      setExpanded(false)
    } else if (previous.current.canCollapse && !canCollapse) {
      setExpanded(true)
    }
    previous.current = { turnId: presentation.turnId, canCollapse }
  }, [canCollapse, presentation.turnId])

  return (
    <section
      className={`agent-process-panel${compact ? ' is-compact' : ''}${canCollapse && !expanded ? ' is-collapsed' : ''}`}
      aria-label="AI 处理过程"
    >
      {canCollapse ? (
        <button
          type="button"
          className="agent-process-header agent-process-header--toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={expanded ? '收起思考过程' : '展开思考过程'}
          onClick={() => setExpanded((value) => !value)}
        >
          <BrainCircuit size={compact ? 13 : 14} />
          <strong>{header.title}</strong>
          <span>{header.label}</span>
          <ChevronDown className={expanded ? 'is-open' : undefined} size={15} aria-hidden="true" />
        </button>
      ) : (
        <header className="agent-process-header">
          {header.icon === 'attention' ? <Bell size={compact ? 13 : 14} /> : <BrainCircuit size={compact ? 13 : 14} />}
          <strong>{header.title}</strong>
          <span>{header.label}</span>
        </header>
      )}
      <div
        id={contentId}
        className="agent-process-content"
        aria-hidden={canCollapse && !expanded ? true : undefined}
        inert={canCollapse && !expanded ? true : undefined}
      >
        <div className="agent-process-list" aria-live="polite">
          {rows.map((row) => row.type === 'rollup'
            ? <RepeatedProcessRow key={`${presentation.turnId}:${row.id}`} items={row.items} />
            : <AgentProcessRow key={row.id} item={row.item} />)}
        </div>
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
    case 'active': return { title: '思考中', label: '进行中' }
    case 'completed': return { title: '思考结束', label: '已完成' }
    case 'failed': return { title: '处理失败', label: '发生错误' }
    case 'canceled': return { title: '处理已取消', label: '已取消' }
    case 'interrupted': return { title: '运行中断', label: '需确认', icon: 'attention' }
    default: return { title: active ? '思考中' : '思考结束', label: active ? '进行中' : '已完成' }
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
    const rollupId = `rollup:${item.kind}:${processPrimaryLabel(item)}`
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
  return Boolean(safeProcessSecondaryText(item)) && (item.kind === 'status' || item.kind === 'child_run' || item.kind === 'compaction')
}

function RepeatedProcessRow({ items }: { items: AgentConversationProvenanceItem[] }) {
  const latest = items[items.length - 1]
  const primaryLabel = processPrimaryLabel(latest)
  const [expanded, setExpanded] = useState(false)
  const hasHistory = items.length > 1
  return (
    <div className={`agent-process-event${latest.state === 'error' ? ' is-error' : ''}${latest.state === 'active' ? ' is-active' : ''}`}>
      <span className="agent-process-event-icon"><ProcessIcon item={latest} /></span>
      <div className="agent-process-event-copy">
        <div className="agent-process-event-title">
          <strong>{primaryLabel}</strong>
          {hasHistory ? (
            <button
              type="button"
              className="agent-process-reasoning-toggle"
              aria-expanded={expanded}
              aria-label={expanded ? `折叠${primaryLabel}历史` : `展开${primaryLabel}历史`}
              onClick={() => setExpanded((value) => !value)}
            >
              <ChevronDown className={expanded ? 'is-open' : undefined} size={14} />
            </button>
          ) : null}
        </div>
        {expanded ? (
          <div className="agent-process-rollup-history" role="list" aria-label={`${primaryLabel}历史`}>
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
  return safeProcessSecondaryText(item) || processPrimaryLabel(item)
}

/**
 * Single learner-safe primary-label projector for process rows.
 * Raw provenance labels are read only here, then redacted and rejected when
 * they look like secrets, paths, learner answers, or provider/system payloads.
 * Safe learner-visible copy is preserved; unsafe labels fall back to a stable
 * kind-based diagnostic label without echoing the original.
 *
 * Secret contract: if redactAgentSecretText mutates the label or the result
 * contains a `[redacted` remnant (PEM/JWT/Bearer/ghp/sk and other formats
 * owned by the shared redactor), always fall back to the kind label — never
 * surface redaction remnants in DOM, rollup ids, or aria names.
 * Absolute path contract: any Windows drive / UNC / Unix absolute / home path
 * fails closed, not only Users/Windows/private keyword hits.
 * Unmarked ordinary answer sentences without typed markers are intentionally
 * not guessed here; that remains an upstream typed-title contract follow-up.
 */
function processPrimaryLabel(item: AgentConversationProvenanceItem): string {
  const candidate = item.label.replace(/\s+/g, ' ').trim()
  if (!candidate) return safeDiagnosticLabel(item.kind)
  const redacted = redactAgentSecretText(candidate)
  if (redacted !== candidate || containsRedactionRemnant(redacted)) {
    return safeDiagnosticLabel(item.kind)
  }
  if (isUnsafeDiagnosticText(candidate)) return safeDiagnosticLabel(item.kind)
  return candidate
}

function AgentProcessRow({ item }: { item: AgentConversationProvenanceItem }) {
  const secondary = safeProcessSecondaryText(item)
  return (
    <div className={`agent-process-event${item.state === 'error' ? ' is-error' : ''}${item.state === 'active' ? ' is-active' : ''}`}>
      <span className="agent-process-event-icon"><ProcessIcon item={item} /></span>
      <div className="agent-process-event-copy">
        <strong>{processPrimaryLabel(item)}</strong>
        {secondary ? <small>{secondary}</small> : null}
      </div>
    </div>
  )
}

/**
 * Typed diagnostic adapter for process secondary text. Raw provenance detail is
 * read only here, then redacted and rejected when it looks like secrets, paths,
 * learner answers, or provider/system payloads. Secret mutations and redaction
 * remnants fail closed the same way as primary labels.
 */
function safeProcessSecondaryText(item: AgentConversationProvenanceItem): string | undefined {
  const candidate = item.detail?.replace(/\s+/g, ' ').trim()
  if (!candidate) return undefined
  const redacted = redactAgentSecretText(candidate)
  if (redacted !== candidate || containsRedactionRemnant(redacted) || isUnsafeDiagnosticText(candidate)) {
    return safeDiagnosticState(item.state)
  }
  return candidate
}

function containsRedactionRemnant(value: string): boolean {
  return /\[redacted/i.test(value)
}

function isUnsafeDiagnosticText(value: string): boolean {
  if (!value || containsRedactionRemnant(value)) return true
  if (/(?:secret|token|password|api[_-]?key|sk-[A-Za-z0-9]{8,}|BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY)/i.test(value)) return true
  if (containsAbsoluteOrHomePath(value)) return true
  if (/(?:RAW-(?:ANSWER|PROMPT)|CHAIN-OF-THOUGHT|provider\s*payload|system\s*prompt)/i.test(value)) return true
  if (/^\{[\s\S]*\}$/.test(value) && /"(?:prompt|answer|arguments|apiKey|token)"/.test(value)) return true
  return false
}

/**
 * Absolute / home filesystem path detector for learner-facing diagnostics.
 * Intentionally keyword-agnostic: any Windows drive root, UNC share, Unix
 * absolute path, or home prefix fails closed — not only Users/Windows/private.
 */
function containsAbsoluteOrHomePath(value: string): boolean {
  // Windows drive absolute: D:\project\x or C:/data/x
  if (/(?:^|[^A-Za-z0-9_])[A-Za-z]:(?:\\|\/)\S/.test(value)) return true
  // UNC: \\server\share\... (and //server/share/...)
  if (/(?:^|[\s"'`(=])(?:\\\\[^\s\\/]+\\[^\s"'`]+|\/\/[A-Za-z0-9._$-]+\/[^\s"'`]+)/.test(value)) return true
  if (/\\\\[A-Za-z0-9._$-]+\\[A-Za-z0-9._$\\\/-]+/.test(value)) return true
  // Unix absolute with one or more path segments after the root slash
  if (/(?:^|[\s"'`(=])\/(?:[A-Za-z0-9._+-]+\/)+[A-Za-z0-9._+-]+/.test(value)) return true
  if (/(?:^|[\s"'`(=])\/[A-Za-z0-9._+-]{2,}(?=[\s"'`)]|$)/.test(value)) return true
  // Home prefixes: ~/... and $HOME/...
  if (/(?:^|[\s"'`(=])(?:~|\$HOME)(?:\/[^\s"'`]*)?(?=[\s"'`)]|$)/.test(value)) return true
  return false
}

/** Allow-listed kind labels for technical diagnostics when projected labels are absent. */
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
    case 'reasoning':
      return '思考过程'
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
    case 'interrupted': return '需确认'
    default: return '已记录'
  }
}

function ProcessIcon({ item }: { item: AgentConversationProvenanceItem }) {
  if (item.state === 'interrupted') return <Bell size={13} />
  if (item.state === 'error') return <AlertCircle size={13} />
  if (item.state === 'active') return <Loader2 className="spin" size={13} />
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
