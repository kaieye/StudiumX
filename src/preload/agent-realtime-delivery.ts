import type {
  AgentEventBusReplay,
  AgentRealtimeEvent,
  AgentChatStreamChunk,
  AgentChatStreamStatus,
  AgentChatStreamToolEvent,
  AgentProjectionInvalidation
} from '../shared/teaching-types'

export function createAgentRealtimeDelivery(options: {
  streamId?: string
  replay: (streamId: string, afterSequence: number) => Promise<AgentEventBusReplay>
  onChunk: (chunk: AgentChatStreamChunk) => void
  onStatus: (status: AgentChatStreamStatus) => void
  onTool: (event: AgentChatStreamToolEvent) => void
  onInvalidation?: (event: AgentProjectionInvalidation) => void
}) {
  let activeStreamId = options.streamId
  let lastSequence = 0
  let queue = Promise.resolve()
  const invalidations = new Set<AgentProjectionInvalidation['reason']>()

  const invalidate = (reason: AgentProjectionInvalidation['reason'], replay: AgentEventBusReplay): void => {
    if (invalidations.has(reason)) return
    invalidations.add(reason)
    options.onInvalidation?.({
      streamId: replay.streamId,
      reason,
      requestedAfterSequence: replay.requestedAfterSequence,
      fromSequence: replay.fromSequence,
      nextSequence: replay.nextSequence
    })
  }

  const dispatch = (event: AgentRealtimeEvent): void => {
    if (event.sequence <= lastSequence) return
    lastSequence = event.sequence
    if (event.kind === 'chunk') options.onChunk(event.payload)
    else if (event.kind === 'status') options.onStatus(event.payload)
    else if (event.kind === 'tool') options.onTool(event.payload)
  }

  const recoverAndDispatch = async (event: AgentRealtimeEvent): Promise<void> => {
    if (!activeStreamId) activeStreamId = event.streamId
    if (event.streamId !== activeStreamId || event.sequence <= lastSequence) return
    if (event.sequence > lastSequence + 1) {
      const replay = await options.replay(activeStreamId, lastSequence)
      if (replay.available) {
        if (replay.hasGap) {
          invalidate('replay_gap', replay)
          lastSequence = Math.max(lastSequence, replay.fromSequence - 1)
        }
        for (const replayedEvent of replay.events) dispatch(replayedEvent)
      } else {
        invalidate('replay_unavailable', replay)
      }
    }
    dispatch(event)
  }

  return {
    accept(event: AgentRealtimeEvent): Promise<void> {
      queue = queue.then(() => recoverAndDispatch(event))
      return queue
    },
    flush(): Promise<void> {
      return queue
    },
    lastSequence(): number {
      return lastSequence
    }
  }
}
