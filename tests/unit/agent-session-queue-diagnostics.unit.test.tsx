import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSessionQueueDiagnostics } from '../../src/renderer/src/views/settings/sections/AgentSessionQueueDiagnostics'
import type { TeachingSystemApi } from '../../src/shared/teaching-types'
import type { AgentSessionQueueProjection } from '../../src/shared/teaching-types/agent-session-queue'
import '../../src/renderer/src/i18n'

const originalTeachingSystem = window.teachingSystem

function installTeachingSystem(api: Partial<TeachingSystemApi> | undefined): void {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    writable: true,
    value: api as TeachingSystemApi
  })
}

const sampleProjection: AgentSessionQueueProjection = {
  busy: true,
  phase: 'running',
  autoDrain: false,
  queueDepth: 2,
  queueCapacity: 8,
  closed: false,
  entries: [
    {
      id: 'entry-follow-1',
      kind: 'follow_up',
      enqueuedAt: '2026-07-21T12:00:00.000Z'
    },
    {
      id: 'entry-steer-1',
      kind: 'steer',
      enqueuedAt: '2026-07-21T12:01:00.000Z'
    }
  ]
}

beforeEach(() => {
  installTeachingSystem(undefined)
})

afterEach(() => {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    writable: true,
    value: originalTeachingSystem
  })
})

describe('AgentSessionQueueDiagnostics', () => {
  it('refreshes queue projection and renders depth + autoDrain false badge', async () => {
    const user = userEvent.setup()
    const projectAgentSessionQueue = vi.fn(async () => ({
      ok: true as const,
      projection: sampleProjection
    }))
    installTeachingSystem({ projectAgentSessionQueue })

    render(<AgentSessionQueueDiagnostics />)

    expect(screen.getByTestId('queue-diagnostics-empty')).toBeInTheDocument()
    expect(projectAgentSessionQueue).not.toHaveBeenCalled()

    const input = screen.getByPlaceholderText(/conversation id/i)
    await user.clear(input)
    await user.type(input, 'conv-test-1')
    await user.click(screen.getByTestId('queue-diagnostics-refresh'))

    await waitFor(() => {
      expect(screen.getByTestId('queue-diagnostics-depth')).toHaveTextContent('2 / 8')
    })

    expect(projectAgentSessionQueue).toHaveBeenCalledTimes(1)
    expect(projectAgentSessionQueue).toHaveBeenCalledWith({ streamId: 'conv-test-1' })
    const payload = projectAgentSessionQueue.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('includeTextPreview')

    expect(screen.getByTestId('queue-diagnostics-autodrain')).toHaveAttribute(
      'data-autodrain',
      'false'
    )
    expect(screen.getByTestId('queue-diagnostics-busy')).toHaveAttribute('data-state', 'warning')
    expect(screen.getByTestId('queue-diagnostics-phase')).toHaveTextContent('running')
    expect(screen.getAllByTestId('queue-diagnostics-entry')).toHaveLength(2)
    expect(screen.queryByText(/secret|preview text/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drain|steer|abort|autoDrain/i })).not.toBeInTheDocument()
  })

  it('shows no_active_session without inventing queue state', async () => {
    const user = userEvent.setup()
    const projectAgentSessionQueue = vi.fn(async () => ({
      ok: false as const,
      reason: 'no_active_session' as const
    }))
    installTeachingSystem({ projectAgentSessionQueue })

    render(<AgentSessionQueueDiagnostics initialStreamId="missing-session" />)
    await user.click(screen.getByTestId('queue-diagnostics-refresh'))

    const alert = await screen.findByTestId('queue-diagnostics-error')
    expect(alert.textContent).toMatch(/no active agent session|没有活动 agent session/i)
    expect(screen.queryByTestId('queue-diagnostics-depth')).not.toBeInTheDocument()
  })
})
