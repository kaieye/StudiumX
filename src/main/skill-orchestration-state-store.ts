/**
 * Durable per-conversation skill orchestration state store (ADR-0014).
 *
 * A rebuildable workflow projection with zero settlement authority: losing or
 * deleting these files only degrades the next turn to single-turn planning.
 * Reads are strict (schema-validated, bounded, fail-soft to null); writes are
 * atomic-replace (tmp + rename) and fail-soft.
 */

import { mkdir, readFile, rename, rm, writeFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  SKILL_ORCHESTRATION_STATE_SCHEMA_VERSION,
  type ConversationOrchestrationState,
  type SkillOrchestrationGateResult,
  type SkillOrchestrationStageProgress
} from '../shared/teaching-types/skill-orchestration'

const STATE_DIRECTORY = ['.agent-sessions', 'skill-orchestration'] as const
const MAX_STATE_BYTES = 64 * 1024
const SAFE_CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const STAGE_KINDS = new Set([
  'ground', 'diagnose', 'teach', 'elicit', 'artifact_authoring', 'enhance', 'verify', 'package'
])
const MODES = new Set(['instant_help', 'teaching_turn', 'artifact_workflow'])
const STAGE_STATUSES = new Set(['completed', 'active', 'pending'])

export type SkillOrchestrationStateStore = {
  load: (conversationId: string) => Promise<ConversationOrchestrationState | null>
  save: (conversationId: string, state: ConversationOrchestrationState) => Promise<boolean>
}

export function createSkillOrchestrationStateStore(input: {
  workspaceRoot: string
}): SkillOrchestrationStateStore {
  const sessionDirectory = join(input.workspaceRoot, STATE_DIRECTORY[0])
  const directory = join(sessionDirectory, STATE_DIRECTORY[1])

  return {
    async load(conversationId: string): Promise<ConversationOrchestrationState | null> {
      const id = normalizeConversationId(conversationId)
      if (!id) return null
      const path = join(directory, `${id}.json`)
      try {
        if (!(await hasSafeStorageDirectory(sessionDirectory, directory))) return null
        const info = await lstat(path)
        if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_STATE_BYTES) return null
        const content = await readFile(path, 'utf8')
        return normalizeConversationOrchestrationState(JSON.parse(content), id)
      } catch {
        return null
      }
    },

    async save(conversationId: string, state: ConversationOrchestrationState): Promise<boolean> {
      const id = normalizeConversationId(conversationId)
      if (!id || id !== normalizeConversationId(state.conversationId)) return false
      const path = join(directory, `${id}.json`)
      const staging = join(directory, `.${id}.json.tmp`)
      try {
        if (!(await ensureSafeStorageDirectory(sessionDirectory, directory))) return false
        const payload = `${JSON.stringify(state, null, 2)}\n`
        if (Buffer.byteLength(payload, 'utf8') > MAX_STATE_BYTES) return false
        await rm(staging, { force: true })
        await writeFile(staging, payload, { encoding: 'utf8', flag: 'wx' })
        await rename(staging, path)
        return true
      } catch {
        await rm(staging, { force: true }).catch(() => {})
        return false
      }
    }
  }
}

function normalizeConversationId(raw: string | null | undefined): string | null {
  const id = String(raw ?? '').trim()
  if (!SAFE_CONVERSATION_ID.test(id) || id === '.' || id === '..') return null
  return id
}

/** Strict fail-soft state parse; any malformed field rejects the whole file. */
export function normalizeConversationOrchestrationState(
  value: unknown,
  expectedConversationId?: string
): ConversationOrchestrationState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== SKILL_ORCHESTRATION_STATE_SCHEMA_VERSION) return null

  const conversationId = normalizeConversationId(record.conversationId as string)
  if (!conversationId) return null
  if (expectedConversationId && conversationId !== expectedConversationId) return null

  const planId = typeof record.planId === 'string' ? record.planId : ''
  if (!/^sop1_[0-9a-f]{8}$/.test(planId)) return null

  const planRevision = record.planRevision
  if (!Number.isInteger(planRevision) || (planRevision as number) < 1) return null

  const mode = record.mode
  if (typeof mode !== 'string' || !MODES.has(mode)) return null

  const stageCursor = record.stageCursor
  if (stageCursor !== null && (typeof stageCursor !== 'string' || !/^stage_[a-z_]{1,32}$/.test(stageCursor))) {
    return null
  }

  if (!Array.isArray(record.stages) || record.stages.length > 16) return null
  const stages: SkillOrchestrationStageProgress[] = []
  for (const raw of record.stages) {
    const stage = normalizeStageProgress(raw)
    if (!stage) return null
    stages.push(stage)
  }

  if (!Array.isArray(record.artifactFacts) || record.artifactFacts.length > 32) return null
  const artifactFacts: string[] = []
  for (const token of record.artifactFacts) {
    if (typeof token !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(token)) return null
    artifactFacts.push(token)
  }

  const updatedAt = record.updatedAt
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) return null

  return {
    schemaVersion: SKILL_ORCHESTRATION_STATE_SCHEMA_VERSION,
    conversationId,
    planId,
    planRevision: planRevision as number,
    mode: mode as ConversationOrchestrationState['mode'],
    stageCursor: stageCursor as string | null,
    stages,
    artifactFacts,
    updatedAt
  }
}

function normalizeStageProgress(value: unknown): SkillOrchestrationStageProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const stageId = record.stageId
  if (typeof stageId !== 'string' || !/^stage_[a-z_]{1,32}$/.test(stageId)) return null
  const kind = record.kind
  if (typeof kind !== 'string' || !STAGE_KINDS.has(kind)) return null
  const status = record.status
  if (typeof status !== 'string' || !STAGE_STATUSES.has(status)) return null
  if (!Array.isArray(record.gateResults) || record.gateResults.length > 8) return null
  const gateResults: SkillOrchestrationGateResult[] = []
  for (const raw of record.gateResults) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const gate = raw as Record<string, unknown>
    if (typeof gate.stageId !== 'string' || typeof gate.gateId !== 'string') return null
    if (typeof gate.passed !== 'boolean' || typeof gate.checkedFact !== 'string') return null
    if (gate.gateId.length > 64 || gate.checkedFact.length > 512) return null
    gateResults.push({
      stageId: gate.stageId,
      gateId: gate.gateId,
      passed: gate.passed,
      checkedFact: gate.checkedFact
    })
  }
  return {
    stageId,
    kind: kind as SkillOrchestrationStageProgress['kind'],
    status: status as SkillOrchestrationStageProgress['status'],
    gateResults
  }
}


/** Do not read or write through a workspace-controlled state-directory symlink. */
async function hasSafeStorageDirectory(sessionDirectory: string, directory: string): Promise<boolean> {
  return (await isRegularDirectory(sessionDirectory)) && (await isRegularDirectory(directory))
}

async function ensureSafeStorageDirectory(sessionDirectory: string, directory: string): Promise<boolean> {
  return (await ensureRegularDirectory(sessionDirectory)) && (await ensureRegularDirectory(directory))
}

async function ensureRegularDirectory(path: string): Promise<boolean> {
  const existing = await lstat(path).catch(() => null)
  if (existing) return existing.isDirectory() && !existing.isSymbolicLink()
  await mkdir(path)
  return isRegularDirectory(path)
}

async function isRegularDirectory(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null)
  return Boolean(info?.isDirectory() && !info.isSymbolicLink())
}
