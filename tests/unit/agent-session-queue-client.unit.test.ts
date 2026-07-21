import { describe, expect, it, vi } from 'vitest'
import { projectActiveAgentSessionQueue } from '../../src/renderer/src/app-shell/agent-session-queue-client'
import type { ProjectAgentSessionQueueResult } from '../../src/shared/teaching-types/agent-session-queue'

describe('projectActiveAgentSessionQueue', () => {
  it('rejects empty streamId without calling IPC', async () => {
    const projectAgentSessionQueue = vi.fn()
    const result = await projectActiveAgentSessionQueue(
      { projectAgentSessionQueue },
      '   '
    )
    expect(result).toEqual({ ok: false, reason: 'missing_stream_id' })
    expect(projectAgentSessionQueue).not.toHaveBeenCalled()
  })

  it('returns api_unavailable when projectAgentSessionQueue is missing', async () => {
    const result = await projectActiveAgentSessionQueue(undefined, 'conv-1')
    expect(result).toEqual({ ok: false, reason: 'api_unavailable' })
  })

  it('calls IPC with streamId only (no includeTextPreview)', async () => {
    const projection: ProjectAgentSessionQueueResult = {
      ok: true,
      projection: {
        busy: true,
        phase: 'running',
        autoDrain: false,
        queueDepth: 1,
        queueCapacity: 8,
        entries: [
          {
            id: 'q-1',
            kind: 'follow_up',
            enqueuedAt: '2026-07-21T12:00:00.000Z'
          }
        ]
      }
    }
    const projectAgentSessionQueue = vi.fn(async () => projection)
    const result = await projectActiveAgentSessionQueue(
      { projectAgentSessionQueue },
      '  conv-42  '
    )
    expect(result).toEqual(projection)
    expect(projectAgentSessionQueue).toHaveBeenCalledTimes(1)
    expect(projectAgentSessionQueue).toHaveBeenCalledWith({ streamId: 'conv-42' })
    const payload = projectAgentSessionQueue.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('includeTextPreview')
    expect(payload).not.toHaveProperty('textPreviewMax')
  })
})
