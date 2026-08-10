/**
 * Strict IPC boundary for applying reviewed AI mind-map proposals.
 *
 * Provider output is data until it crosses this parser. The main process then
 * performs the document read and CAS settlement; this module deliberately has
 * no filesystem or reducer side effects.
 */
import {
  mindMapProviderProposalSchema,
  type MindMapProposalDecision
} from '../../shared/mindmap/commands/mind-map-proposal'
import type { MindMapProposalApplyPayload } from '../../shared/teaching-types/mindmap'

function requireNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function requireNonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function requireExactKeys(value: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) return null
  return record
}

function isProposalDecision(value: unknown): value is MindMapProposalDecision {
  return value === 'accept' || value === 'reject'
}

/**
 * Validate the complete review envelope before the gateway resolves a
 * workspace or reads a document. Unknown decision ids are rejected instead of
 * silently ignored at the IPC boundary; omitted current item ids remain safe
 * and are treated as rejected by the pure proposal resolver.
 */
export function parseMindMapProposalApplyPayload(
  value: unknown
): MindMapProposalApplyPayload | null {
  const record = requireExactKeys(value, [
    'workspaceId',
    'id',
    'expectedRevision',
    'proposal',
    'decisions'
  ])
  if (!record) return null

  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  const expectedRevision = requireNonNegativeSafeInteger(record.expectedRevision)
  if (!workspaceId || !id || expectedRevision === null) return null

  const proposal = mindMapProviderProposalSchema.safeParse(record.proposal)
  if (!proposal.success) return null

  const decisionsRecord = requireDecisionRecord(record.decisions)
  if (!decisionsRecord) return null
  const itemIds = new Set(proposal.data.items.map((item) => item.id))
  for (const [itemId, decision] of Object.entries(decisionsRecord)) {
    if (!itemIds.has(itemId) || !isProposalDecision(decision)) return null
  }

  return {
    workspaceId,
    id,
    expectedRevision,
    proposal: proposal.data,
    decisions: decisionsRecord as Record<string, MindMapProposalDecision>
  }
}

function requireDecisionRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
