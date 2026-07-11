import type { AskAnswer } from '../../shared/teaching-types'
import type { ToolPermissionDecision } from './tools/registry'

type PendingEntry = {
  resolve: (decision: ToolPermissionDecision) => void
  reject: (error: Error) => void
}

const pending = new Map<string, PendingEntry>()

function key(streamId: string, requestId: string): string {
  return `${streamId}:${requestId}`
}

export function registerToolPermissionPending(
  streamId: string,
  requestId: string,
  signal?: AbortSignal
): Promise<ToolPermissionDecision> {
  if (signal?.aborted) {
    return Promise.reject(new Error('permission canceled: stream aborted'))
  }
  return new Promise<ToolPermissionDecision>((resolve, reject) => {
    const mapKey = key(streamId, requestId)
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort)
      pending.delete(mapKey)
    }
    const onAbort = (): void => {
      cleanup()
      reject(new Error('permission canceled: stream aborted'))
    }
    pending.set(mapKey, {
      resolve: (decision) => {
        cleanup()
        resolve(decision)
      },
      reject: (error) => {
        cleanup()
        reject(error)
      }
    })
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function resolveToolPermissionPending(
  streamId: string,
  requestId: string,
  answers: AskAnswer[]
): boolean {
  const entry = pending.get(key(streamId, requestId))
  if (!entry) return false
  const selected = answers.flatMap((answer) => answer.selected).map((item) => item.toLowerCase())
  entry.resolve({
    decision: selected.includes('allow') ? 'allow' : 'deny',
    reason: selected.includes('allow') ? undefined : '用户拒绝了本次写入。'
  })
  return true
}

export function cancelStreamToolPermissionPending(streamId: string): void {
  const prefix = `${streamId}:`
  for (const [mapKey, entry] of pending) {
    if (mapKey.startsWith(prefix)) {
      pending.delete(mapKey)
      entry.reject(new Error('permission canceled: stream aborted'))
    }
  }
}
