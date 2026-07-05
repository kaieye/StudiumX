import type { AskAnswer } from '../../shared/teaching-types'

/**
 * In-flight ask-tool resolvers, keyed by `${streamId}:${toolCallId}`.
 *
 * The ask handler registers a pending entry and awaits its resolver; the
 * renderer-side `teach:agent-chat-tool-answer` IPC call resolves it. When
 * the agent stream is canceled, {@link cancelStreamAskPending} rejects all
 * pending entries for that stream so the agent loop's `isCanceled()` path
 * can take over.
 */
type PendingEntry = {
  resolve: (answers: AskAnswer[]) => void
  reject: (error: Error) => void
}

const pending = new Map<string, PendingEntry>()

function key(streamId: string, toolCallId: string): string {
  return `${streamId}:${toolCallId}`
}

/** Register a pending ask and return a promise that resolves when the user
 *  answers (via {@link resolveAskPending}) or rejects when the stream is
 *  canceled (via {@link cancelStreamAskPending}). */
export function registerAskPending(streamId: string, toolCallId: string): Promise<AskAnswer[]> {
  return new Promise<AskAnswer[]>((resolve, reject) => {
    pending.set(key(streamId, toolCallId), { resolve, reject })
  })
}

/** Resolve a pending ask with the user's answers. Returns true if a pending
 *  entry existed. Called from the renderer→main IPC handler. */
export function resolveAskPending(
  streamId: string,
  toolCallId: string,
  answers: AskAnswer[]
): boolean {
  const entry = pending.get(key(streamId, toolCallId))
  if (!entry) return false
  pending.delete(key(streamId, toolCallId))
  entry.resolve(answers)
  return true
}

/** Reject every pending ask for a stream (e.g. when the user cancels the
 *  agent chat). Used by the cancel-IPC handler so no resolver dangles. */
export function cancelStreamAskPending(streamId: string): void {
  const prefix = `${streamId}:`
  for (const [k, entry] of pending) {
    if (k.startsWith(prefix)) {
      pending.delete(k)
      entry.reject(new Error('ask canceled: stream aborted'))
    }
  }
}
