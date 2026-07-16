import { useEffect, useRef, useState } from 'react'
import type { AgentConversationTurnPresentation } from '../../agent-conversation-presentation'
import type {
  TeachingTurnAction,
  TeachingTurnPresentation
} from '../../teaching-turn-presentation'

/**
 * Renders only the learner-safe teaching projection. Process and diagnostic
 * metadata remain available to the application but are not part of the chat UI.
 */
export function AgentConversationReader({
  presentation: _presentation,
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
  return null
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
    </section>
  )
}
