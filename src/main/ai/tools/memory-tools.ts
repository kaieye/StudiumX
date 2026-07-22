/**
 * Teaching memory tools: main-only lexical search + human-approved synthetic memory.
 * Zero-LLM hot path. Does not use SQLite FTS (ADR-0001).
 * Results are returned to the model as tool output only — never auto-baked into system prefix.
 */
import type { TeachingMemoryRecord } from '../../../shared/teaching-types'
import { sanitizeMemoryInjectionText } from '../../../shared/memory-sanitize'
import { searchLexicalDocuments, type LexicalDocument } from '../teaching-lexical-search'
import type { ToolContext, ToolEntry } from './registry'

const TEACHING_SYNTHETIC_TAG = 'teaching-synthetic'
const MAX_TITLE = 120
const MAX_BODY = 4_000
const MAX_SEARCH_HITS = 12

export type MemoryToolStore = Readonly<{
  list: (workspaceRoot?: string, includeDeleted?: boolean) => Promise<TeachingMemoryRecord[]>
  create: (payload: {
    content: string
    scope: 'user' | 'workspace' | 'project'
    tags?: string[]
    confidence?: number
    workspaceRoot?: string
  }) => Promise<TeachingMemoryRecord>
  delete: (id: string, workspaceRoot?: string) => Promise<void>
}>

export type CreateMemoryToolsOptions = Readonly<{
  memoryStore: MemoryToolStore
  /**
   * When false, only memory_search is registered. Write tools stay unregistered
   * under an unavailable durable_authority_write profile (ADR-0126).
   */
  writeAvailable?: boolean
  /**
   * Optional authorized local files (NOTES, learning-records, redacted archives).
   * Caller supplies already-bounded, workspace-trusted documents only.
   */
  loadAuthorizedDocuments?: (ctx: ToolContext) => Promise<
    Array<{ id: string; text: string; title?: string; meta?: Record<string, string | number | boolean | null | undefined> }>
  >
}>

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing ${field}.`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(max, Math.floor(value)))
}

function titleFromContent(content: string): string {
  const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? content.trim()
  return firstLine.length > MAX_TITLE ? `${firstLine.slice(0, MAX_TITLE - 1)}…` : firstLine
}

function isSyntheticTeachingMemory(record: TeachingMemoryRecord): boolean {
  return record.tags.includes(TEACHING_SYNTHETIC_TAG)
}

function memoryToDocument(record: TeachingMemoryRecord): {
  id: string
  text: string
  title: string
  meta: Record<string, string | number | boolean | null | undefined>
} {
  // Sanitize at tool-result / model-facing projection only; catalog storage stays raw.
  const text = sanitizeMemoryInjectionText(record.content)
  return {
    id: record.id,
    text,
    title: titleFromContent(text),
    meta: {
      kind: isSyntheticTeachingMemory(record) ? 'teaching_synthetic' : 'memory',
      scope: record.scope,
      tags: record.tags.join(','),
      updatedAt: record.updatedAt
    }
  }
}

export function createMemoryTools(options: CreateMemoryToolsOptions): ToolEntry[] {
  const memorySearchTool: ToolEntry = {
    definition: {
      type: 'function',
      function: {
        name: 'memory_search',
        description:
          '在教学记忆与已授权本地笔记中做词法检索（main 进程、零 LLM）。返回 snippet 与邻接元数据；默认不写入 system 前缀。不要用它搜索未授权路径，也不要假设结果已注入上下文。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索查询（自然语言关键词）' },
            limit: { type: 'number', description: '最多返回条数，默认 8，最大 12' },
            includeAuthorizedFiles: {
              type: 'boolean',
              description: '是否同时检索已授权本地文件（NOTES / learning-records 等），默认 true'
            }
          },
          required: ['query']
        }
      }
    },
    handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
      const input = asRecord(args)
      const query = requireString(input.query, 'query')
      const limit = clampLimit(input.limit, 8, MAX_SEARCH_HITS)
      const includeAuthorizedFiles = input.includeAuthorizedFiles !== false

      const records = (await options.memoryStore.list(ctx.workspaceRoot)).filter(
        (record) => !record.deletedAt && !record.disabledAt
      )
      const documents: LexicalDocument[] = records.map(memoryToDocument)
      if (includeAuthorizedFiles && options.loadAuthorizedDocuments) {
        try {
          const extra = await options.loadAuthorizedDocuments(ctx)
          for (const doc of extra) documents.push(doc)
        } catch {
          // Authorized-file failures must not block memory catalog search.
        }
      }

      const hits = searchLexicalDocuments(query, documents, { limit })
      return JSON.stringify({
        ok: true,
        query,
        count: hits.length,
        hits: hits.map((hit) => ({
          id: hit.id,
          score: Number(hit.score.toFixed(3)),
          title: hit.title ?? null,
          snippet: hit.snippet,
          meta: hit.meta ?? null
        })),
        note: 'Results are tool-only; they are not auto-injected into the system prompt.'
      })
    }
  }

  const rememberTeachingMemoryTool: ToolEntry = {
    definition: {
      type: 'function',
      function: {
        name: 'remember_teaching_memory',
        description:
          '写入一条教学合成记忆（如易混概念、下次如何教）。必须经人批后才会持久化；前缀仅可索引 title+scope，正文需 memory_search 按需取。勿静默改写学习者画像。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '短标题（将进入索引；不超过约 120 字）' },
            body: { type: 'string', description: '正文（按需检索；不自动进入 system 前缀）' },
            scope: {
              type: 'string',
              enum: ['workspace', 'project', 'user'],
              description: '记忆作用域，默认 workspace'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: '可选附加标签（系统会自动加 teaching-synthetic）'
            }
          },
          required: ['title', 'body']
        }
      }
    },
    permission: {
      kind: 'workspace_write',
      describe: (args) => {
        const input = asRecord(args)
        const title = optionalString(input.title) ?? 'teaching memory'
        return {
          operation: 'remember_teaching_memory',
          targetPath: `memory://${title.slice(0, 80)}`,
          reason: '将写入一条需批准的教学合成记忆（title+scope 可进索引；正文仅按需检索）。',
          creates: true,
          availableScopes: ['once', 'run']
        }
      }
    },
    handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
      const input = asRecord(args)
      const title = requireString(input.title, 'title').slice(0, MAX_TITLE)
      const body = requireString(input.body, 'body').slice(0, MAX_BODY)
      const scopeRaw = optionalString(input.scope) ?? 'workspace'
      const scope =
        scopeRaw === 'user' || scopeRaw === 'project' || scopeRaw === 'workspace' ? scopeRaw : 'workspace'
      const extraTags = Array.isArray(input.tags)
        ? input.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim())
        : []
      const content = `${title}\n\n${body}`
      const record = await options.memoryStore.create({
        content,
        scope,
        tags: [...new Set([TEACHING_SYNTHETIC_TAG, ...extraTags])],
        confidence: 0.9,
        workspaceRoot: ctx.workspaceRoot
      })
      return JSON.stringify({
        ok: true,
        id: record.id,
        scope: record.scope,
        title,
        indexOnly: true,
        note: 'Persisted after human approval. Prefix may index title+scope only; use memory_search for body.'
      })
    }
  }

  const forgetTeachingMemoryTool: ToolEntry = {
    definition: {
      type: 'function',
      function: {
        name: 'forget_teaching_memory',
        description:
          '对教学合成记忆做墓碑删除（软删除）。需人批；仅作用于带 teaching-synthetic 标签的条目，不会静默改学习者画像。',
        parameters: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: 'memory_search 返回的记忆 id' }
          },
          required: ['memoryId']
        }
      }
    },
    permission: {
      kind: 'workspace_write',
      describe: (args) => {
        const input = asRecord(args)
        const memoryId = optionalString(input.memoryId) ?? 'unknown'
        return {
          operation: 'forget_teaching_memory',
          targetPath: `memory://${memoryId}`,
          reason: '将墓碑删除一条教学合成记忆（软删除；需批准）。',
          creates: false,
          availableScopes: ['once', 'run']
        }
      }
    },
    handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
      const input = asRecord(args)
      const memoryId = requireString(input.memoryId, 'memoryId')
      const records = await options.memoryStore.list(ctx.workspaceRoot, true)
      const match = records.find((record) => record.id === memoryId)
      if (!match) {
        return JSON.stringify({ ok: false, error: 'memory_not_found', memoryId })
      }
      if (!isSyntheticTeachingMemory(match)) {
        return JSON.stringify({
          ok: false,
          error: 'not_synthetic_teaching_memory',
          memoryId,
          note: 'Only teaching-synthetic memories may be forgotten via this tool.'
        })
      }
      if (match.deletedAt) {
        return JSON.stringify({ ok: true, memoryId, alreadyDeleted: true })
      }
      await options.memoryStore.delete(memoryId, ctx.workspaceRoot)
      return JSON.stringify({ ok: true, memoryId, tombstoned: true })
    }
  }

  if (options.writeAvailable === false) {
    return [memorySearchTool]
  }
  return [memorySearchTool, rememberTeachingMemoryTool, forgetTeachingMemoryTool]
}

/** Build a stable prefix index of synthetic teaching memories (title + scope only). */
export function buildTeachingSyntheticMemoryIndexLines(
  records: readonly TeachingMemoryRecord[],
  limit = 12
): string[] {
  return records
    .filter((record) => !record.deletedAt && !record.disabledAt && isSyntheticTeachingMemory(record))
    .slice(0, limit)
    .map((record) => {
      const title = titleFromContent(sanitizeMemoryInjectionText(record.content))
        .replace(/\s+/g, ' ')
        .trim()
      return `- id=${record.id}; scope=${record.scope}; title=${title}`
    })
}

export const TEACHING_SYNTHETIC_MEMORY_TAG = TEACHING_SYNTHETIC_TAG
