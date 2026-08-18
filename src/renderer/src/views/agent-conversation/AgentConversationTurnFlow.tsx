import type { AgentConversationFlowItem } from '../../agent-conversation-presentation'
import { MarkdownMessage } from '../../ui/MarkdownMessage'
import { AgentProcessRow } from './AgentConversationReader'

/**
 * Direct siblings deliberately preserve the host message layout: an ordered
 * assistant flow can alternate Think/tool rows and Markdown without inserting
 * a visual card or changing the composer hierarchy.
 */
export function AgentConversationTurnFlow({ flow }: {
  flow: readonly AgentConversationFlowItem[]
}) {
  return (
    <>
      {flow.map((entry) => entry.kind === 'process'
        ? <AgentProcessRow key={entry.id} item={entry.item} />
        : <MarkdownMessage key={entry.id} content={entry.content} tone="assistant" />)}
    </>
  )
}
