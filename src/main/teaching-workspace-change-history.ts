import { readFile } from 'node:fs/promises'
import type { TeachingWorkspaceChangeSummary } from '../shared/teaching-types'
import { replaceDurably, type DurableFileOperations } from './persistence/durable-file'

const HISTORY_VERSION = 1
export const MAX_WORKSPACE_CHANGE_HISTORY_ENTRIES = 20

type PersistedChangeHistory = {
  version: 1
  workspaces: Record<string, TeachingWorkspaceChangeSummary[]>
}

export class TeachingWorkspaceChangeHistoryStore {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly options: {
      filePath: string
      maxEntriesPerWorkspace?: number
      durableFileOperations?: DurableFileOperations
      durableWarn?: (message: string) => void
    }
  ) {}

  async append(
    workspaceId: string,
    summary: TeachingWorkspaceChangeSummary
  ): Promise<TeachingWorkspaceChangeSummary> {
    const normalizedWorkspaceId = requireWorkspaceId(workspaceId)
    if (summary.workspaceId !== normalizedWorkspaceId) {
      throw new Error('Workspace change summary does not belong to the requested workspace.')
    }
    const normalizedSummary = normalizeSummary(summary)
    if (!normalizedSummary) throw new Error('Workspace change summary is invalid.')

    await this.enqueueWrite(async () => {
      const history = await this.readHistory()
      const current = history.workspaces[normalizedWorkspaceId] ?? []
      const next = [
        normalizedSummary,
        ...current.filter((entry) => entry.id !== normalizedSummary.id)
      ]
        .sort(compareNewestFirst)
        .slice(0, this.maxEntriesPerWorkspace())
      history.workspaces[normalizedWorkspaceId] = next
      await replaceDurably({
        path: this.options.filePath,
        content: `${JSON.stringify(history, null, 2)}\n`,
        mode: 0o666,
        operations: this.options.durableFileOperations,
        warn: this.options.durableWarn
      })
    })

    return normalizedSummary
  }

  async list(workspaceId: string): Promise<TeachingWorkspaceChangeSummary[]> {
    await this.writeQueue
    const normalizedWorkspaceId = requireWorkspaceId(workspaceId)
    const history = await this.readHistory()
    return [...(history.workspaces[normalizedWorkspaceId] ?? [])].sort(compareNewestFirst)
  }

  async latest(workspaceId: string): Promise<TeachingWorkspaceChangeSummary | null> {
    return (await this.list(workspaceId))[0] ?? null
  }

  async get(workspaceId: string, changeId: string): Promise<TeachingWorkspaceChangeSummary | null> {
    const normalizedChangeId = changeId.trim()
    if (!normalizedChangeId) return null
    return (await this.list(workspaceId)).find((entry) => entry.id === normalizedChangeId) ?? null
  }

  private async readHistory(): Promise<PersistedChangeHistory> {
    const content = await readFile(this.options.filePath, 'utf8').catch(() => '')
    return parseChangeHistory(content, this.maxEntriesPerWorkspace())
  }

  private maxEntriesPerWorkspace(): number {
    const configured = this.options.maxEntriesPerWorkspace
    if (!Number.isInteger(configured) || (configured ?? 0) < 1) {
      return MAX_WORKSPACE_CHANGE_HISTORY_ENTRIES
    }
    return configured as number
  }

  private async enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const queued = this.writeQueue.then(operation, operation)
    this.writeQueue = queued.catch(() => {})
    await queued
  }
}

function parseChangeHistory(content: string, maxEntries: number): PersistedChangeHistory {
  const empty: PersistedChangeHistory = { version: HISTORY_VERSION, workspaces: {} }
  if (!content.trim()) return empty
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object') return empty
    const rawWorkspaces = (parsed as Record<string, unknown>).workspaces
    if (!rawWorkspaces || typeof rawWorkspaces !== 'object' || Array.isArray(rawWorkspaces)) return empty
    const workspaces: Record<string, TeachingWorkspaceChangeSummary[]> = {}
    for (const [workspaceId, rawEntries] of Object.entries(rawWorkspaces)) {
      if (!workspaceId.trim() || !Array.isArray(rawEntries)) continue
      const entries = rawEntries
        .map(normalizeSummary)
        .filter((entry): entry is TeachingWorkspaceChangeSummary => Boolean(entry))
        .filter((entry) => entry.workspaceId === workspaceId)
        .sort(compareNewestFirst)
        .slice(0, maxEntries)
      if (entries.length > 0) workspaces[workspaceId] = entries
    }
    return { version: HISTORY_VERSION, workspaces }
  } catch {
    return empty
  }
}

function normalizeSummary(value: unknown): TeachingWorkspaceChangeSummary | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const workspaceId = stringValue(record.workspaceId)
  const timestamp = stringValue(record.timestamp)
  const summary = stringValue(record.summary)
  if (!id || !workspaceId || !timestamp || !summary) return null
  if (!record.trigger || typeof record.trigger !== 'object') return null
  if (!record.git || typeof record.git !== 'object') return null
  if (!Array.isArray(record.changedFiles)) return null
  const additions = finiteNonNegativeInteger(record.additions)
  const deletions = finiteNonNegativeInteger(record.deletions)
  if (additions === null || deletions === null) return null
  return {
    ...(record as unknown as TeachingWorkspaceChangeSummary),
    id,
    workspaceId,
    timestamp,
    summary,
    additions,
    deletions
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null
}

function requireWorkspaceId(value: string): string {
  const workspaceId = value.trim()
  if (!workspaceId) throw new Error('workspaceId is required.')
  return workspaceId
}

function compareNewestFirst(
  left: TeachingWorkspaceChangeSummary,
  right: TeachingWorkspaceChangeSummary
): number {
  return right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id)
}
