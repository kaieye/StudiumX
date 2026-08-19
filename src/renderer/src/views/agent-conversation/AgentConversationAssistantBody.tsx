import type { ComponentPropsWithoutRef } from 'react'
import type { AgentConversationTurnPresentation } from '../../agent-conversation-presentation'
import type { TeachingTurnAction, TeachingTurnPresentation } from '../../teaching-turn-presentation'
import { MarkdownMessage } from '../../ui/MarkdownMessage'
import { AgentConversationReader } from './AgentConversationReader'
import { AgentConversationTurnFlow } from './AgentConversationTurnFlow'

export function AgentConversationMessageFrame({
  messageRole,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<'div'>, 'className'> & {
  messageRole: 'user' | 'assistant'
  className?: string
}) {
  return (
    <div
      {...props}
      className={`overview-dialog-message is-${messageRole}${className ? ` ${className}` : ''}`}
    />
  )
}

/**
 * Shared assistant-turn body used by the homepage conversation and embedded
 * Agent surfaces. The ordered flow is the single owner of Think/tool/text
 * arrival order; the Markdown fallback remains for legacy turns without a
 * presentation timeline.
 */
export function AgentConversationAssistantBody({
  content,
  presentation,
  teachingPresentation,
  onTeachingAction,
  compact = true
}: {
  content: string
  presentation: AgentConversationTurnPresentation | undefined
  teachingPresentation?: TeachingTurnPresentation
  onTeachingAction?: (action: TeachingTurnAction) => void
  compact?: boolean
}) {
  const flow = presentation?.flow
  const hasFlow = Boolean(flow?.length)
  return (
    <>
      {hasFlow ? <AgentConversationTurnFlow flow={flow!} /> : null}
      <AgentConversationReader
        presentation={presentation}
        teachingPresentation={teachingPresentation}
        onTeachingAction={onTeachingAction}
        omitProcessItemIds={flow
          ?.filter((item) => item.kind === 'process')
          .map((item) => item.item.id)}
        compact={compact}
      />
      {content && !hasFlow
        ? <MarkdownMessage content={content} tone="assistant" compact={compact} />
        : null}
    </>
  )
}
