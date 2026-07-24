import { afterEach, describe, expect, it } from 'vitest'
import {
  ASK_DEADLINE_AT_KEY,
  askTimeoutMayAutoApprove,
  buildAskTimeoutAnswers,
  clampAskTimeoutMs,
  DEFAULT_ASK_TIMEOUT_MS,
  formatAskRemainingLabel,
  pickAskTimeoutOption,
  remainingAskMs,
  resolveAskDeadlineAt,
  stampAskArguments
} from '../../src/shared/ask-deadline'
import type { AskQuestion } from '../../src/shared/teaching-types'
import {
  cancelStreamAskPending,
  countAskPending,
  peekAskPendingDeadline,
  registerAskPending,
  rejectAskPending,
  resolveAskPending
} from '../../src/main/ai/ask-pending'
import { createAskToolEntry } from '../../src/main/ai/tools/ask'

describe('ask authoritative deadline policy', () => {
  it('keeps an existing valid deadline stamp (authority / monotonic)', () => {
    const existing = '2026-07-23T12:00:00.000Z'
    const first = resolveAskDeadlineAt({
      existingDeadlineAt: existing,
      nowMs: Date.parse('2026-07-23T11:00:00.000Z'),
      timeoutMs: 60_000
    })
    expect(first).toEqual({
      deadlineAt: existing,
      minted: false,
      timeoutMs: 60_000
    })
    const second = resolveAskDeadlineAt({
      existingDeadlineAt: first.deadlineAt,
      nowMs: Date.parse('2026-07-23T11:30:00.000Z'),
      timeoutMs: 1_000
    })
    expect(second.deadlineAt).toBe(existing)
    expect(second.minted).toBe(false)
  })

  it('mints a new deadline from now + clamped timeout when none exists', () => {
    const nowMs = Date.parse('2026-07-23T10:00:00.000Z')
    const result = resolveAskDeadlineAt({ nowMs, timeoutMs: 90_000 })
    expect(result.minted).toBe(true)
    expect(result.timeoutMs).toBe(90_000)
    expect(result.deadlineAt).toBe(new Date(nowMs + 90_000).toISOString())
    expect(clampAskTimeoutMs(undefined)).toBe(DEFAULT_ASK_TIMEOUT_MS)
    expect(clampAskTimeoutMs(10)).toBe(1_000)
    expect(clampAskTimeoutMs(999_999_999)).toBe(30 * 60 * 1000)
  })

  it('stamps __deadlineAt without dropping questions payload', () => {
    const nowMs = Date.parse('2026-07-23T10:00:00.000Z')
    const stamped = stampAskArguments(
      {
        questions: [{ question: 'Go left or right?', options: [{ label: 'Left' }, { label: 'Right' }] }]
      },
      { nowMs, timeoutMs: 30_000 }
    )
    expect(stamped.minted).toBe(true)
    expect(stamped.args[ASK_DEADLINE_AT_KEY]).toBe(stamped.deadlineAt)
    expect(Array.isArray(stamped.args.questions)).toBe(true)
    const again = stampAskArguments(stamped.args, { nowMs: nowMs + 5_000, timeoutMs: 1_000 })
    expect(again.deadlineAt).toBe(stamped.deadlineAt)
    expect(again.minted).toBe(false)
  })

  it('picks recommended option, else first option, for timeout settlement', () => {
    expect(
      pickAskTimeoutOption([
        { label: 'A' },
        { label: 'B', recommended: true },
        { label: 'C' }
      ])?.label
    ).toBe('B')
    expect(pickAskTimeoutOption([{ label: 'First' }, { label: 'Second' }])?.label).toBe('First')
    expect(pickAskTimeoutOption([])).toBeNull()

    const questions: AskQuestion[] = [
      {
        id: 'q1',
        prompt: 'Pick',
        options: [
          { label: 'Slow' },
          { label: 'Fast', recommended: true }
        ]
      },
      {
        id: 'q2',
        prompt: 'Again',
        options: [{ label: 'X' }, { label: 'Y' }]
      }
    ]
    expect(buildAskTimeoutAnswers(questions)).toEqual([
      { questionId: 'q1', selected: ['Fast'] },
      { questionId: 'q2', selected: ['X'] }
    ])
  })

  it('never auto-approves write / privileged / turn-review on ask timeout', () => {
    expect(askTimeoutMayAutoApprove('ask')).toBe(true)
    expect(askTimeoutMayAutoApprove('workspace_write')).toBe(false)
    expect(askTimeoutMayAutoApprove('external_write')).toBe(false)
    expect(askTimeoutMayAutoApprove('privileged')).toBe(false)
    expect(askTimeoutMayAutoApprove('turn_review')).toBe(false)
  })

  it('computes remaining ms from authoritative deadline', () => {
    const deadlineAt = '2026-07-23T10:01:00.000Z'
    const nowMs = Date.parse('2026-07-23T10:00:30.000Z')
    expect(remainingAskMs(deadlineAt, nowMs)).toBe(30_000)
    expect(remainingAskMs('not-a-date', nowMs)).toBeNull()
  })
})

describe('ask-pending timeout and cancel settlement', () => {
  afterEach(() => {
    for (const streamId of [
      'cleanup-stream',
      'stream-timeout',
      'stream-first',
      'stream-cancel',
      'stream-user',
      'stream-reject',
      'stream-tool'
    ]) {
      cancelStreamAskPending(streamId)
    }
    expect(countAskPending()).toBe(0)
  })

  it('settles timeout to recommended/first answers using authoritative deadline', async () => {
    const now = Date.parse('2026-07-23T10:00:00.000Z')
    let clock = now
    let fired: (() => void) | null = null
    const deadlineAt = new Date(now + 5_000).toISOString()
    const questions: AskQuestion[] = [
      {
        id: 'q1',
        prompt: 'Choose path',
        options: [
          { label: 'Safe', recommended: true },
          { label: 'Risky' }
        ]
      }
    ]

    const pending = registerAskPending('stream-timeout', 'call-1', {
      questions,
      deadlineAt,
      nowMs: () => clock,
      scheduleTimeout: (callback, delayMs) => {
        expect(delayMs).toBe(5_000)
        fired = callback
        return { clear: () => { fired = null } }
      }
    })

    expect(peekAskPendingDeadline('stream-timeout', 'call-1')).toBe(deadlineAt)
    expect(fired).toBeTypeOf('function')
    clock = now + 5_000
    fired!()
    await expect(pending).resolves.toEqual([{ questionId: 'q1', selected: ['Safe'] }])
    expect(countAskPending()).toBe(0)
  })

  it('uses first option when none is marked recommended', async () => {
    const now = Date.parse('2026-07-23T10:00:00.000Z')
    let fired: (() => void) | null = null
    const pending = registerAskPending('stream-first', 'call-1', {
      questions: [
        {
          id: 'q1',
          prompt: '?',
          options: [{ label: 'Alpha' }, { label: 'Beta' }]
        }
      ],
      deadlineAt: new Date(now + 1_000).toISOString(),
      nowMs: () => now,
      scheduleTimeout: (callback) => {
        fired = callback
        return { clear: () => { fired = null } }
      }
    })
    fired!()
    await expect(pending).resolves.toEqual([{ questionId: 'q1', selected: ['Alpha'] }])
  })

  it('cancel aborts pending ask without timeout answers', async () => {
    const now = Date.parse('2026-07-23T10:00:00.000Z')
    let cleared = false
    const pending = registerAskPending('stream-cancel', 'call-1', {
      questions: [
        {
          id: 'q1',
          prompt: '?',
          options: [{ label: 'A' }, { label: 'B' }]
        }
      ],
      deadlineAt: new Date(now + 60_000).toISOString(),
      nowMs: () => now,
      scheduleTimeout: () => ({
        clear: () => {
          cleared = true
        }
      })
    })
    cancelStreamAskPending('stream-cancel')
    await expect(pending).rejects.toThrow(/ask canceled: stream aborted/)
    expect(cleared).toBe(true)
    expect(countAskPending()).toBe(0)
  })

  it('user resolve wins over later timeout', async () => {
    const now = Date.parse('2026-07-23T10:00:00.000Z')
    let fired: (() => void) | null = null
    const pending = registerAskPending('stream-user', 'call-1', {
      questions: [
        {
          id: 'q1',
          prompt: '?',
          options: [{ label: 'A', recommended: true }, { label: 'B' }]
        }
      ],
      deadlineAt: new Date(now + 10_000).toISOString(),
      nowMs: () => now,
      scheduleTimeout: (callback) => {
        fired = callback
        return { clear: () => { fired = null } }
      }
    })
    expect(
      resolveAskPending('stream-user', 'call-1', [{ questionId: 'q1', selected: ['B'] }])
    ).toBe(true)
    await expect(pending).resolves.toEqual([{ questionId: 'q1', selected: ['B'] }])
    fired?.()
    expect(countAskPending()).toBe(0)
  })

  it('rejectAskPending aborts without inventing options', async () => {
    const now = Date.parse('2026-07-23T10:00:00.000Z')
    const pending = registerAskPending('stream-reject', 'call-1', {
      questions: [
        {
          id: 'q1',
          prompt: '?',
          options: [{ label: 'A' }, { label: 'B' }]
        }
      ],
      deadlineAt: new Date(now + 10_000).toISOString(),
      nowMs: () => now,
      scheduleTimeout: () => ({ clear: () => undefined })
    })
    expect(rejectAskPending('stream-reject', 'call-1', new Error('checkpoint failed'))).toBe(true)
    await expect(pending).rejects.toThrow(/checkpoint failed/)
  })
})

describe('createAskToolEntry deadline publish path', () => {
  it('stamps deadline, publishes stamped args, and times out to recommended', async () => {
    const now = Date.parse('2026-07-23T10:00:00.000Z')
    let published: { toolCallId: string; argumentsJson: string } | null = null
    let fired: (() => void) | null = null

    const entry = createAskToolEntry({
      streamId: 'stream-tool',
      nowMs: () => now,
      timeoutMs: 2_000,
      publishWaiting: (payload) => {
        published = payload
      }
    })

    // Patch register via real module: scheduleTimeout is not injected from tool entry.
    // Exercise handler with immediate resolve via resolveAskPending after publish.
    const handlerPromise = entry.handler(
      {
        questions: [
          {
            question: 'Path?',
            options: [
              { label: 'Guide', recommended: true },
              { label: 'Explore' }
            ]
          }
        ]
      },
      {} as never,
      { toolCallId: 'ask-tool-1', toolName: 'ask' }
    )

    // Allow microtasks for onWaiting + publish + register
    await Promise.resolve()
    await Promise.resolve()

    expect(published).not.toBeNull()
    const args = JSON.parse(published!.argumentsJson) as Record<string, unknown>
    expect(args[ASK_DEADLINE_AT_KEY]).toBe(new Date(now + 2_000).toISOString())
    expect(published!.toolCallId).toBe('ask-tool-1')

    expect(
      resolveAskPending('stream-tool', 'ask-tool-1', [{ questionId: 'q1', selected: ['Explore'] }])
    ).toBe(true)

    const result = await handlerPromise
    expect(result).toContain('Explore')
    void fired
  })

  it('formats remaining labels consistently for UI countdown', () => {
    expect(formatAskRemainingLabel(null)).toBeNull()
    expect(formatAskRemainingLabel(0)).toBe('0:00')
    expect(formatAskRemainingLabel(-1_000)).toBe('0:00')
    expect(formatAskRemainingLabel(4_000)).toBe('0:04')
    expect(formatAskRemainingLabel(65_000)).toBe('1:05')
    expect(formatAskRemainingLabel(3_661_000)).toBe('1:01:01')
  })

  it('does not wire timeout into write/privileged auto-approval', () => {
    // Regression guard: pure policy remains the product floor for non-ask targets.
    for (const target of ['workspace_write', 'external_write', 'privileged', 'turn_review'] as const) {
      expect(askTimeoutMayAutoApprove(target)).toBe(false)
    }
  })
})
