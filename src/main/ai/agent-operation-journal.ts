import { createHash } from 'node:crypto'

import { AgentRunPersistence } from './agent-run-persistence'
import { agentOperationId, assertSafeId } from './agent-run-types'
import type { AgentOperationRecord } from './agent-run-types'

const MAX_RESULT_BYTES = 16 * 1024

/**
 * The tool-facing seam for persisted write operations. It owns idempotency decisions and
 * uncertainty handling, while keeping file layout, containment, validation, and serialization
 * behind the persistence implementation.
 */
export class AgentOperationJournal {
  constructor(private readonly persistence: AgentRunPersistence) {}

  async startOperation(input: {
    runId: string
    toolCallId: string
    toolName: string
    normalizedTarget?: string
    artifactPointer?: string
  }): Promise<{ action: 'execute' | 'reuse' | 'review'; record: AgentOperationRecord }> {
    assertSafeId(input.runId, 'runId')
    const operationId = agentOperationId(input.runId, input.toolCallId)
    return this.persistence.serialize(() => this.startOperationPersisted(input, operationId))
  }

  async completeOperation(record: AgentOperationRecord, result: string): Promise<AgentOperationRecord> {
    return this.persistence.serialize(async () => {
      const now = this.persistence.timestamp()
      const compact = Buffer.byteLength(result, 'utf8') <= MAX_RESULT_BYTES ? result : undefined
      const next: AgentOperationRecord = {
        ...record,
        state: 'completed',
        disposition: 'first_execution',
        resultHash: createHash('sha256').update(result).digest('hex'),
        ...(compact !== undefined ? { result: compact } : {}),
        updatedAt: now,
        completedAt: now
      }
      await this.persistence.writeOperation(next, true)
      return next
    })
  }

  async failOperation(record: AgentOperationRecord, error: unknown, interrupted = false): Promise<AgentOperationRecord> {
    return this.persistence.serialize(async () => {
      const next: AgentOperationRecord = {
        ...record,
        state: interrupted ? 'interrupted' : 'failed',
        error: cleanDiagnostic(error),
        updatedAt: this.persistence.timestamp()
      }
      await this.persistence.writeOperation(next, true)
      return next
    })
  }

  /** @internal Used by the lifecycle module inside the shared serialization transaction. */
  async reconcileInterruptedOperations(runId: string): Promise<number> {
    let count = 0
    for (const name of await this.persistence.listOperationFiles(runId)) {
      try {
        const record = await this.persistence.readOperation(runId, name.slice(0, -5))
        if (record.state !== 'started') continue
        await this.markNeedsReview(record)
        count += 1
      } catch {
        // Invalid operation records are quarantined by the private persistence implementation.
      }
    }
    return count
  }

  /** @internal Used by the lifecycle module while assembling interrupted-run summaries. */
  async countReviewOperations(runId: string): Promise<number> {
    let count = 0
    for (const name of await this.persistence.listOperationFiles(runId)) {
      try {
        const record = await this.persistence.readOperation(runId, name.slice(0, -5))
        if (record.state === 'needs_review' || record.state === 'interrupted') count += 1
      } catch {
        // Invalid records are excluded from the renderer-facing summary.
      }
    }
    return count
  }

  private async startOperationPersisted(
    input: {
      runId: string
      toolCallId: string
      toolName: string
      normalizedTarget?: string
      artifactPointer?: string
    },
    operationId: string
  ): Promise<{ action: 'execute' | 'reuse' | 'review'; record: AgentOperationRecord }> {
    const existing = await this.persistence.readOperation(input.runId, operationId).catch((error) => {
      if (isNotFound(error)) return null
      throw error
    })
    if (existing?.state === 'completed') {
      if (existing.result === undefined) return { action: 'review', record: await this.markNeedsReview(existing) }
      return { action: 'reuse', record: { ...existing, disposition: 'idempotent_reuse' } }
    }
    if (existing) return { action: 'review', record: await this.markNeedsReview(existing) }

    const now = this.persistence.timestamp()
    const record: AgentOperationRecord = {
      version: 1,
      operationId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      ...(input.normalizedTarget ? { normalizedTarget: input.normalizedTarget } : {}),
      ...(input.artifactPointer ? { artifactPointer: input.artifactPointer } : {}),
      state: 'started',
      disposition: 'first_execution',
      createdAt: now,
      updatedAt: now
    }
    await this.persistence.writeOperation(record, false)
    return { action: 'execute', record }
  }

  private async markNeedsReview(record: AgentOperationRecord): Promise<AgentOperationRecord> {
    const artifactExists = record.artifactPointer
      ? await this.persistence.artifactExists(record.artifactPointer).catch(() => undefined)
      : undefined
    const next: AgentOperationRecord = {
      ...record,
      state: 'needs_review',
      disposition: 'manual_review',
      ...(artifactExists !== undefined ? { artifactExists } : {}),
      updatedAt: this.persistence.timestamp()
    }
    await this.persistence.writeOperation(next, true)
    return next
  }
}

export type { AgentOperationRecord } from './agent-run-types'

function cleanDiagnostic(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/\b(?:authorization|proxy-authorization)\s*[:=]\s*[^\r\n]*/gi, '[redacted]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:api[-_ ]?key|token|secret|password|proxy)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .slice(0, 1000)
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}