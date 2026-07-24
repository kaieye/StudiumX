import { describe, expect, it } from 'vitest'

import { buildSummaryRequestMessages as buildCompactorSummaryMessages } from '../../src/main/ai/context-compactor'
import {
  appendFileTouchLedgerDataMessage,
  buildFileTouchLedgerProjectionData,
  buildSummarizerInputMessages,
  emptyContextFileLedger,
  FILE_TOUCH_LEDGER_DATA_TYPE,
  mergeContextFileLedgers,
  recordFileTouchesFromToolBatch,
  rebuildFileTouchLedgerFromTranscript,
  sanitizeFileTouchPath,
  stripFileTouchLedgerMessages
} from '../../src/main/ai/context-file-ledger'
import type { ChatMessage, ToolCall } from '../../src/main/ai/provider-adapter'

function makeCall(id: string, name: string, args: unknown): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  }
}

describe('sanitizeFileTouchPath', () => {
  it('normalizes relative paths and rejects absolute / traversal breakout', () => {
    expect(sanitizeFileTouchPath('src\\\\main\\\\ai\\\\x.ts')).toBe('src/main/ai/x.ts')
    expect(sanitizeFileTouchPath('./lessons/intro.md')).toBe('lessons/intro.md')
    expect(sanitizeFileTouchPath('a/./b/../c.md')).toBe('a/c.md')

    expect(sanitizeFileTouchPath('/etc/passwd')).toBeNull()
    expect(sanitizeFileTouchPath('C:\\Windows\\system32')).toBeNull()
    expect(sanitizeFileTouchPath('\\\\server\\share')).toBeNull()
    expect(sanitizeFileTouchPath('../escape.md')).toBeNull()
    expect(sanitizeFileTouchPath('a/../../b.md')).toBeNull()
    expect(sanitizeFileTouchPath('file:///tmp/x')).toBeNull()
  })

  it('drops over-long paths instead of truncating mid-path', () => {
    const long = `lessons/${'a'.repeat(300)}.md`
    expect(sanitizeFileTouchPath(long, 240)).toBeNull()
    expect(sanitizeFileTouchPath('short.md', 240)).toBe('short.md')
  })
})

describe('mergeContextFileLedgers', () => {
  it('merges in message order and keeps modified sticky', () => {
    const first = {
      entries: [
        { path: 'a.ts', kind: 'read' as const, order: 1 },
        { path: 'b.ts', kind: 'read' as const, order: 2 }
      ]
    }
    const second = {
      entries: [
        { path: 'a.ts', kind: 'modified' as const, order: 5 },
        { path: 'c.ts', kind: 'read' as const, order: 6 }
      ]
    }
    const third = {
      entries: [{ path: 'a.ts', kind: 'read' as const, order: 9 }]
    }

    const merged = mergeContextFileLedgers([first, second, third])
    const byPath = Object.fromEntries(merged.entries.map((e) => [e.path, e]))

    expect(byPath['a.ts']?.kind).toBe('modified')
    expect(byPath['a.ts']?.order).toBe(9)
    expect(byPath['b.ts']?.kind).toBe('read')
    expect(byPath['c.ts']?.kind).toBe('read')

    const orders = merged.entries.map((e) => e.order)
    expect(orders).toEqual([...orders].sort((x, y) => x - y))
  })

  it('drops oldest whole entries when over maxEntries budget', () => {
    const ledger = {
      entries: [
        { path: 'one.ts', kind: 'read' as const, order: 1 },
        { path: 'two.ts', kind: 'read' as const, order: 2 },
        { path: 'three.ts', kind: 'modified' as const, order: 3 }
      ]
    }
    const merged = mergeContextFileLedgers([ledger], { maxEntries: 2 })
    expect(merged.entries.map((e) => e.path)).toEqual(['two.ts', 'three.ts'])
    expect(merged.entries.every((e) => e.path === e.path)).toBe(true)
  })
})

describe('recordFileTouchesFromToolBatch', () => {
  it('excludes failed calls and records successful single-path tools', () => {
    const calls = [
      makeCall('c1', 'read_workspace_file', { path: 'notes/a.md' }),
      makeCall('c2', 'write_workspace_file', { path: 'notes/b.md' }),
      makeCall('c3', 'read_workspace_file', { path: 'notes/c.md' }),
      makeCall('c4', 'search_workspace', { path: 'notes' }),
      makeCall('c5', 'read_workspace_file', { file_path: 'notes/d.md' })
    ]
    const results = [
      { toolCallId: 'c1', name: 'read_workspace_file', isError: false },
      { toolCallId: 'c2', name: 'write_workspace_file', isError: true },
      {
        toolCallId: 'c3',
        name: 'read_workspace_file',
        isError: false,
        content: JSON.stringify({ error: 'not found' })
      },
      { toolCallId: 'c4', name: 'search_workspace', isError: false },
      { toolCallId: 'c5', name: 'read_workspace_file', isError: false }
    ]

    const ledger = recordFileTouchesFromToolBatch({
      ledger: emptyContextFileLedger(),
      calls,
      results
    })

    expect(ledger.entries.map((e) => e.path).sort()).toEqual(['notes/a.md', 'notes/d.md'])
    expect(ledger.entries.every((e) => e.kind === 'read')).toBe(true)
  })

  it('marks writes as modified and keeps stickiness on later read', () => {
    const writeCall = makeCall('w1', 'write_workspace_file', { path: 'lesson.md' })
    const readCall = makeCall('r1', 'read_workspace_file', { path: 'lesson.md' })

    let ledger = recordFileTouchesFromToolBatch({
      ledger: emptyContextFileLedger(),
      calls: [writeCall],
      results: [{ toolCallId: 'w1', name: 'write_workspace_file', isError: false }]
    })
    ledger = recordFileTouchesFromToolBatch({
      ledger,
      calls: [readCall],
      results: [{ toolCallId: 'r1', name: 'read_workspace_file', isError: false }]
    })

    expect(ledger.entries).toHaveLength(1)
    expect(ledger.entries[0]?.path).toBe('lesson.md')
    expect(ledger.entries[0]?.kind).toBe('modified')
  })
})

describe('rebuildFileTouchLedgerFromTranscript', () => {
  it('rebuilds in message order from assistant tool_calls + tool results', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          makeCall('t1', 'read_workspace_file', { path: 'first.md' }),
          makeCall('t2', 'write_workspace_file', { path: 'second.md' })
        ]
      },
      { role: 'tool', tool_call_id: 't1', content: '{"ok":true}' },
      {
        role: 'tool',
        tool_call_id: 't2',
        content: JSON.stringify({ error: 'denied' })
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [makeCall('t3', 'read_workspace_file', { path: 'third.md' })]
      },
      { role: 'tool', tool_call_id: 't3', content: 'body' }
    ]

    const ledger = rebuildFileTouchLedgerFromTranscript(messages)
    expect(ledger.entries.map((e) => e.path)).toEqual(['first.md', 'third.md'])
    expect(ledger.entries[0]?.order).toBeLessThan(ledger.entries[1]!.order)
  })
})

describe('summarizer exclusion / projection separation', () => {
  it('buildSummarizerInputMessages strips ledger data payloads', () => {
    const ledger = {
      entries: [{ path: 'a.ts', kind: 'read' as const, order: 1 }]
    }
    const withLedger = appendFileTouchLedgerDataMessage(
      [{ role: 'user', content: 'hello' }],
      ledger
    )
    expect(withLedger.some((m) => m.role === 'system')).toBe(true)

    const forSummarizer = buildSummarizerInputMessages(withLedger)
    expect(forSummarizer).toEqual([{ role: 'user', content: 'hello' }])
    expect(
      forSummarizer.every(
        (m) => typeof m.content !== 'string' || !m.content.includes(FILE_TOUCH_LEDGER_DATA_TYPE)
      )
    ).toBe(true)
  })

  it('projection data is JSON reference_data not free-text instructions', () => {
    const data = buildFileTouchLedgerProjectionData({
      entries: [{ path: 'x.md', kind: 'modified', order: 2 }]
    })
    expect(data.type).toBe(FILE_TOUCH_LEDGER_DATA_TYPE)
    expect(data.role).toBe('reference_data')
    expect(data.files).toEqual([{ path: 'x.md', kind: 'modified' }])
    const serialized = JSON.stringify(data)
    expect(serialized).not.toMatch(/you must|always approve|execute shell/i)
  })

  it('ContextCompactor buildSummaryRequestMessages has no ledger field or marker', () => {
    const messages = buildCompactorSummaryMessages({
      renderedMessages: 'user: hi\nassistant: ok',
      mode: 'normal',
      reason: 'soft_threshold',
      sourceDigest: 'abc',
      toolSchemaTokens: 12
    })
    const joined = messages.map((m) => m.content).join('\n')
    expect(joined).not.toContain(FILE_TOUCH_LEDGER_DATA_TYPE)
    expect(joined).not.toContain('workspace_file_touch_ledger')
    expect(Object.keys(messages[1] as object)).not.toContain('fileTouchLedger')
  })

  it('stripFileTouchLedgerMessages is idempotent for non-ledger content', () => {
    const base: ChatMessage[] = [
      { role: 'system', content: 'policy' },
      { role: 'user', content: 'q' }
    ]
    expect(stripFileTouchLedgerMessages(base)).toEqual(base)
  })
})
