import { describe, expect, it } from 'vitest'
import type { TeachingMemoryRecord } from '../../src/shared/teaching-types'
import { buildToolContext } from '../../src/main/ai/tools/registry'
import {
  buildTeachingSyntheticMemoryIndexLines,
  createMemoryTools,
  TEACHING_SYNTHETIC_MEMORY_TAG
} from '../../src/main/ai/tools/memory-tools'
import { defaultSettings } from '../../src/main/teaching-settings'

function record(partial: Partial<TeachingMemoryRecord> & Pick<TeachingMemoryRecord, 'id' | 'content'>): TeachingMemoryRecord {
  return {
    id: partial.id,
    content: partial.content,
    scope: partial.scope ?? 'workspace',
    tags: partial.tags ?? [],
    confidence: partial.confidence ?? 1,
    createdAt: partial.createdAt ?? '2026-07-21T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-07-21T00:00:00.000Z',
    deletedAt: partial.deletedAt,
    disabledAt: partial.disabledAt
  }
}

describe('memory tools', () => {
  it('searches memory records with lexical scoring and keeps results tool-only', async () => {
    const store = {
      list: async () => [
        record({
          id: 'mem_1',
          content: '二次导数与一阶导数易混\n\n讲解时先画速度-时间图。',
          tags: [TEACHING_SYNTHETIC_MEMORY_TAG]
        }),
        record({ id: 'mem_2', content: '完全无关的条目' })
      ],
      create: async () => {
        throw new Error('create should not run')
      },
      delete: async () => {
        throw new Error('delete should not run')
      }
    }
    const tools = createMemoryTools({ memoryStore: store })
    const search = tools.find((tool) => tool.definition.function.name === 'memory_search')
    expect(search).toBeTruthy()
    const ctx = buildToolContext(defaultSettings('D:/tmp/memory-tools'), { workspaceRoot: 'D:/tmp/memory-tools' })
    const raw = await search!.handler({ query: '二次导数 易混', limit: 5 }, ctx)
    const parsed = JSON.parse(raw) as { ok: boolean; hits: Array<{ id: string }>; note: string }
    expect(parsed.ok).toBe(true)
    expect(parsed.hits[0]?.id).toBe('mem_1')
    expect(parsed.note).toMatch(/not auto-injected/i)
  })

  it('remember and forget only apply to teaching-synthetic memories', async () => {
    const created: TeachingMemoryRecord[] = []
    const deleted: string[] = []
    const store = {
      list: async () => [
        ...created,
        record({ id: 'profile_1', content: '学习者画像', tags: ['learner-profile'] })
      ],
      create: async (payload: { content: string; scope: 'user' | 'workspace' | 'project'; tags?: string[] }) => {
        const next = record({
          id: `mem_${created.length + 1}`,
          content: payload.content,
          scope: payload.scope,
          tags: payload.tags ?? []
        })
        created.push(next)
        return next
      },
      delete: async (id: string) => {
        deleted.push(id)
      }
    }
    const tools = createMemoryTools({ memoryStore: store })
    const remember = tools.find((tool) => tool.definition.function.name === 'remember_teaching_memory')!
    const forget = tools.find((tool) => tool.definition.function.name === 'forget_teaching_memory')!
    const ctx = buildToolContext(defaultSettings('D:/tmp/memory-tools'), { workspaceRoot: 'D:/tmp/memory-tools' })

    const remembered = JSON.parse(
      await remember.handler({ title: '易混：导数', body: '先速度后加速度', scope: 'workspace' }, ctx)
    ) as { ok: boolean; id: string }
    expect(remembered.ok).toBe(true)
    expect(created[0]?.tags).toContain(TEACHING_SYNTHETIC_MEMORY_TAG)

    const refused = JSON.parse(await forget.handler({ memoryId: 'profile_1' }, ctx)) as { ok: boolean; error: string }
    expect(refused.ok).toBe(false)
    expect(refused.error).toBe('not_synthetic_teaching_memory')

    const tombstoned = JSON.parse(await forget.handler({ memoryId: remembered.id }, ctx)) as {
      ok: boolean
      tombstoned?: boolean
    }
    expect(tombstoned.ok).toBe(true)
    expect(tombstoned.tombstoned).toBe(true)
    expect(deleted).toEqual([remembered.id])
  })

  it('indexes synthetic memories as title+scope only', () => {
    const lines = buildTeachingSyntheticMemoryIndexLines([
      record({
        id: 'mem_1',
        content: '短标题\n\n很长的正文不应出现在索引中',
        tags: [TEACHING_SYNTHETIC_MEMORY_TAG],
        scope: 'workspace'
      }),
      record({ id: 'mem_2', content: '画像', tags: ['learner-profile'] })
    ])
    expect(lines).toEqual(['- id=mem_1; scope=workspace; title=短标题'])
    expect(lines.join('\n')).not.toContain('很长的正文')
  })

  it('sanitizes memory content projected into memory_search tool results', async () => {
    const store = {
      list: async () => [
        record({
          id: 'mem_dirty',
          content:
            '导数易混\u0000\nBearer sk-abcdefghijklmnopqrstuvwxyz012345\nC:\\Users\\alice\\notes.md',
          tags: [TEACHING_SYNTHETIC_MEMORY_TAG]
        })
      ],
      create: async () => {
        throw new Error('create should not run')
      },
      delete: async () => {
        throw new Error('delete should not run')
      }
    }
    const tools = createMemoryTools({ memoryStore: store })
    const search = tools.find((tool) => tool.definition.function.name === 'memory_search')!
    const ctx = buildToolContext(defaultSettings('D:/tmp/memory-tools'), {
      workspaceRoot: 'D:/tmp/memory-tools'
    })
    const raw = await search.handler({ query: '导数 易混', limit: 5 }, ctx)
    const parsed = JSON.parse(raw) as {
      ok: boolean
      hits: Array<{ id: string; title: string | null; snippet: string }>
    }
    expect(parsed.ok).toBe(true)
    expect(parsed.hits[0]?.id).toBe('mem_dirty')
    const blob = JSON.stringify(parsed.hits)
    expect(blob).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz012345/)
    expect(blob).not.toContain('C:\\Users\\alice')
    expect(blob).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/)
    expect(blob).toMatch(/\[redacted\]|\[path\]/)
  })

  it('sanitizes titles in synthetic memory index lines', () => {
    const lines = buildTeachingSyntheticMemoryIndexLines([
      record({
        id: 'mem_1',
        content: 'Bearer sk-abcdefghijklmnopqrstuvwxyz012345 标题\n\nbody',
        tags: [TEACHING_SYNTHETIC_MEMORY_TAG],
        scope: 'workspace'
      })
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('id=mem_1')
    expect(lines.join('\n')).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz012345/)
    expect(lines.join('\n')).toContain('[redacted]')
  })
})
