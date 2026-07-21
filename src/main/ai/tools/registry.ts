import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { ToolDefinition } from '../provider-adapter'
import type { AgentArtifactRef, TeachingSettingsV1 } from '../../../shared/teaching-types'
import type { AgentOperationJournal, AgentOperationRecord } from '../agent-operation-journal'
import { webSearchTool } from './web_search'
import { webFetchTool } from './web_fetch'
import {
  annotationsForEffectClass,
  enforceToolResultBudget,
  type ToolRiskAnnotations,
  type ToolResultBudgetPolicy
} from './annotations'
import { classifyToolEffect } from './effect-policy'
import {
  DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT,
  evaluateRegistryToolPolicyGate,
  journalPermissionDecisionFromGateAndResolution,
  type JournalPermissionDecision,
  type ToolPolicyDocument
} from './tool-policy'
import { capabilitiesForTool, type ToolCapabilities } from './tool-capabilities'
import {
  getWorkspaceWriteToolAvailability,
  workspaceReadTools,
  writeWorkspaceFileTool
} from './workspace'
import {
  isForcedHumanMemoryApprovalTool,
  recordForcedHumanApprovalReceipt,
  shouldRecordForcedHumanApproval
} from './approval-receipt'

export type ToolPermissionKind =
  | 'workspace_write'
  | 'workspace_read'
  | 'external_network'

export type ToolPermissionRequest = {
  id: string
  kind: ToolPermissionKind
  toolName: string
  operation: string
  targetPath?: string
  reason?: string
  creates?: boolean
  availableScopes?: Array<'once' | 'run' | 'directory'>
  directoryScopePath?: string
}

export type ToolPermissionDecision = {
  decision: 'allow' | 'allow_once' | 'allow_for_run' | 'allow_for_directory' | 'deny'
  reason?: string
  scopePath?: string
}

export type ToolPermissionDescriptor = {
  kind: ToolPermissionKind
  describe: (args: unknown, ctx: ToolContext, callCtx?: ToolCallContext) =>
    | Omit<ToolPermissionRequest, 'id' | 'kind' | 'toolName'>
    | Promise<Omit<ToolPermissionRequest, 'id' | 'kind' | 'toolName'>>
}

export type ToolPermissionResolver = (
  request: ToolPermissionRequest,
  callCtx?: ToolCallContext
) => Promise<ToolPermissionDecision>

export type ToolContext = {
  settings: TeachingSettingsV1
  proxyUrl: string
  workspaceRoot?: string
  requestToolPermission?: ToolPermissionResolver
  runId?: string
  operationJournal?: ToolOperationJournal | { readonly operations: ToolOperationJournal }
  permissionGrants: ToolRunPermissionGrants
  /** Abort signal for the current agent run. Tools should compose this with their own timeouts. */
  signal?: AbortSignal
  /**
   * Optional declarative tool-policy document (ADR-0063).
   * When omitted, DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT is used (defaultDecision allow:
   * existing approvalMode lattice remains in charge until rules are supplied).
   */
  toolPolicyDocument?: ToolPolicyDocument | null
  /**
   * Optional journal audit only (ADR-0063 residual / B-08 capture wire / ADR-0108).
   * Set by registry after permission resolve when a decision is known, immediately
   * before invoking the tool handler for that call.
   * Never used to re-authorize writes; capture may read and pass through.
   * Per-call overwrite; agent loop serializes write tools (single-threaded assumption).
   */
  lastJournalPermissionDecision?: JournalPermissionDecision
}

export type ToolRuntimeChildRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'

export type ToolRuntimeChildRunRecord = {
  id: string
  label: string
  profile: string
  status: ToolRuntimeChildRunStatus
  summary?: string
  error?: string
  startedAt?: string
  completedAt?: string
  archive?: AgentArtifactRef
  usage?: {
    providerCalls?: number
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    toolCalls: number
  }
}

export type ToolRuntimeEvent =
  | { type: 'child_run_queued'; child: ToolRuntimeChildRunRecord }
  | { type: 'child_run_started'; child: ToolRuntimeChildRunRecord }
  | { type: 'child_run_delta'; childRunId: string; message: string }
  | { type: 'child_run_completed'; child: ToolRuntimeChildRunRecord }
  | { type: 'child_run_failed'; child: ToolRuntimeChildRunRecord }
  | { type: 'child_run_canceled'; child: ToolRuntimeChildRunRecord }

/** Contextual information about the specific tool call being executed,
 *  passed into handlers so they can correlate back-ends (e.g. the `ask`
 *  tool needs `toolCallId` to route the user's answer back). Optional so
 *  legacy handlers can ignore it. */
export type ToolCallContext = {
  toolCallId: string
  toolName: string
  emit?: (event: ToolRuntimeEvent) => void
  /** Abort signal for this tool call / parent agent run. */
  signal?: AbortSignal
  runId?: string
}

/** A tool handler with its ToolContext already bound (ctx curried in). */
export type BoundToolHandler = (args: unknown, callCtx?: ToolCallContext) => Promise<string>

export type ToolHandlerMap = Record<string, BoundToolHandler>

/** The narrow tool-execution seam. Registry code cannot reach checkpoint lifecycle methods. */
export type ToolOperationJournal = Pick<AgentOperationJournal, 'startOperation' | 'completeOperation' | 'failOperation'>

export type ToolEntry = {
  definition: ToolDefinition
  permission?: ToolPermissionDescriptor
  /** Optional risk annotations; defaults from classifyToolEffect when omitted. */
  annotations?: ToolRiskAnnotations
  /** Optional capability metadata; defaults from capabilitiesForTool when omitted. */
  capabilities?: ToolCapabilities
  /** Optional hard result byte budget; defaults to DEFAULT_TOOL_RESULT_BUDGET_BYTES. */
  resultBudget?: number | ToolResultBudgetPolicy
  handler: (args: unknown, ctx: ToolContext, callCtx?: ToolCallContext) => Promise<string>
}


export function resolveToolEntryAnnotations(entry: ToolEntry): ToolRiskAnnotations {
  return entry.annotations ?? annotationsForEffectClass(classifyToolEffect(entry.definition.function.name))
}

export function resolveToolEntryCapabilities(entry: ToolEntry): ToolCapabilities {
  return entry.capabilities ?? capabilitiesForTool(entry.definition.function.name)
}

export class ToolRegistry {
  private entries = new Map<string, ToolEntry>()

  register(entry: ToolEntry): void {
    this.entries.set(entry.definition.function.name, entry)
  }

  names(): string[] {
    return [...this.entries.keys()]
  }

  project(options: { allow?: Iterable<string>; deny?: Iterable<string> }): ToolRegistry {
    const allow = options.allow ? new Set(options.allow) : null
    const deny = options.deny ? new Set(options.deny) : new Set<string>()
    const registry = new ToolRegistry()
    for (const [name, entry] of this.entries) {
      if (allow && !allow.has(name)) continue
      if (deny.has(name)) continue
      registry.register(entry)
    }
    return registry
  }

  definitions(): ToolDefinition[] {
    return [...this.entries.values()].map((e) => e.definition)
  }

  handlerMap(ctx: ToolContext): ToolHandlerMap {
    const out: ToolHandlerMap = {}
    for (const [name, entry] of this.entries) {
      out[name] = async (args, callCtx) => {
        const permission = entry.permission
        let request: ToolPermissionRequest | undefined
        if (permission) {
          try {
            request = await describeToolPermission(name, permission, args, ctx, callCtx)
          } catch (error) {
            delete ctx.lastJournalPermissionDecision
            return JSON.stringify({
              tool: name,
              error: error instanceof Error ? error.message : String(error),
              permission: {
                kind: permission.kind,
                decision: 'deny'
              }
            }, null, 2)
          }
          const resolved = await resolveToolPermission(request, ctx, callCtx, args)
          // Journal audit slot only — never re-authorizes. Deny paths do not run capture.
          if (resolved.journalPermissionDecision !== undefined) {
            ctx.lastJournalPermissionDecision = resolved.journalPermissionDecision
          } else {
            delete ctx.lastJournalPermissionDecision
          }
          if (resolved.decision.decision === 'deny') {
            return JSON.stringify({
              tool: name,
              error: resolved.decision.reason ?? '工具调用未获批准。',
              permission: {
                kind: permission.kind,
                decision: resolved.decision.decision
              }
            }, null, 2)
          }
        } else {
          delete ctx.lastJournalPermissionDecision
        }
        const operationJournal = resolveOperationJournal(ctx.operationJournal)
        if (permission?.kind !== 'workspace_write' || !operationJournal || !ctx.runId || !callCtx?.toolCallId) {
          return applyEntryResultBudget(await entry.handler(args, ctx, callCtx), entry)
        }
        const normalizedTarget = request?.kind === 'workspace_write'
          ? await workspaceRelativePointer(ctx, request.targetPath)
          : undefined
        const started = await operationJournal.startOperation({
          runId: ctx.runId,
          toolCallId: callCtx.toolCallId,
          toolName: name,
          normalizedTarget,
          artifactPointer: normalizedTarget
        })
        if (started.action === 'review') {
          return JSON.stringify({
            tool: name,
            error: '该写入在上次进程退出前已开始，但没有可靠的完成回执。为避免重复副作用，本次不会自动执行；请人工检查目标后再发起新运行。',
            operation: operationSummary(started.record, 'manual_review')
          }, null, 2)
        }
        if (started.action === 'reuse') {
          return decorateOperationResult(started.record.result ?? '', started.record, 'idempotent_reuse')
        }
        try {
          const result = await entry.handler(args, ctx, callCtx)
          const artifactPointer = await resultArtifactPointer(result, ctx) ?? started.record.artifactPointer
          const completed = await operationJournal.completeOperation(
            artifactPointer ? { ...started.record, artifactPointer } : started.record,
            result
          )
          return decorateOperationResult(applyEntryResultBudget(result, entry), completed, 'first_execution')
        } catch (error) {
          await operationJournal.failOperation(started.record, error, Boolean(callCtx.signal?.aborted || ctx.signal?.aborted))
          throw error
        }
      }
    }
    return out
  }
}

function resolveOperationJournal(
  source: ToolContext['operationJournal']
): ToolOperationJournal | undefined {
  if (!source) return undefined
  return 'operations' in source ? source.operations : source
}

export function buildToolContext(
  settings: TeachingSettingsV1,
  options: {
    workspaceRoot?: string | null
    requestToolPermission?: ToolPermissionResolver
    signal?: AbortSignal
    runId?: string
    operationJournal?: ToolOperationJournal | { readonly operations: ToolOperationJournal }
    permissionGrants?: ToolRunPermissionGrants
    toolPolicyDocument?: ToolPolicyDocument | null
  } = {}
): ToolContext {
  const proxyUrl = settings.provider.proxy.enabled ? settings.provider.proxy.url.trim() : ''
  const workspaceRoot = options.workspaceRoot?.trim() || undefined
  return {
    settings,
    proxyUrl,
    workspaceRoot,
    requestToolPermission: options.requestToolPermission,
    signal: options.signal,
    runId: options.runId,
    operationJournal: options.operationJournal,
    permissionGrants: options.permissionGrants ?? new ToolRunPermissionGrants(),
    toolPolicyDocument: options.toolPolicyDocument
  }
}

export function buildDefaultRegistry(
  settings: TeachingSettingsV1,
  options: { workspaceRoot?: string | null; workspaceWrite?: boolean } = {}
): ToolRegistry {
  const registry = new ToolRegistry()
  if (settings.tools.workspaceRead && options.workspaceRoot) {
    for (const tool of workspaceReadTools) registry.register(tool)
    // Do not expose a write capability that this host cannot execute safely.
    // The durable publisher has no pathname fallback, so leaving the tool out
    // prevents an approval UI from promising a write which would only fail at
    // execution time. Read-only workspace tools stay available.
    if (options.workspaceWrite === true && getWorkspaceWriteToolAvailability().available) {
      registry.register(writeWorkspaceFileTool)
    }
  }
  if (settings.tools.webSearch) registry.register(webSearchTool)
  if (settings.tools.webFetch) registry.register(webFetchTool)
  return registry
}

type ResolvedToolPermission = {
  decision: ToolPermissionDecision
  /** Journal audit vocab only; omit when unknown. */
  journalPermissionDecision?: JournalPermissionDecision
}

async function resolveToolPermission(
  request: ToolPermissionRequest,
  ctx: ToolContext,
  callCtx?: ToolCallContext,
  args?: unknown
): Promise<ResolvedToolPermission> {
  if (request.kind !== 'workspace_write') {
    return {
      decision: { decision: 'allow_once' },
      journalPermissionDecision: 'allow'
    }
  }

  // Declarative tool-policy (ADR-0063): forbidden short-circuits full_access /
  // based_on_approval creates auto-allow. prompt forces interactive path.
  // allow only defers to existing approvalMode — never invents YOLO bypass.
  const effectClass = classifyToolEffect(request.toolName)
  const policyDocument = ctx.toolPolicyDocument ?? DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT
  const policyGate = evaluateRegistryToolPolicyGate({
    toolName: request.toolName,
    effectClass,
    path: request.targetPath,
    document: policyDocument
  })
  if (policyGate.action === 'deny') {
    return {
      decision: {
        decision: 'deny',
        reason: `声明式工具策略禁止 ${request.operation}${request.targetPath ? `：${request.targetPath}` : ''}（${policyGate.policyReason}）。`
      },
      journalPermissionDecision: journalPermissionDecisionFromGateAndResolution({
        policyAction: 'deny',
        interactiveDecision: 'deny'
      })
    }
  }
  const forceInteractive = policyGate.action === 'force_interactive'
  const policyAction = forceInteractive ? 'force_interactive' : 'defer_to_approval_mode'

  // Synthetic teaching memory mutations always require human approval
  // (Slice F / ADR-0050). Prior run grants still apply after an explicit allow.
  const requiresHumanMemoryApproval = isForcedHumanMemoryApprovalTool(request.toolName)

  if (!requiresHumanMemoryApproval && !forceInteractive) {
    switch (ctx.settings.tools.approvalMode) {
      case 'full_access': {
        const decision: ToolPermissionDecision = { decision: 'allow_for_run' }
        return {
          decision,
          journalPermissionDecision: journalPermissionDecisionFromGateAndResolution({
            policyAction,
            interactiveDecision: decision.decision
          })
        }
      }
      case 'based_on_approval':
        // Creating a new in-workspace text file is reversible and constrained by
        // the workspace path guard. Replacing an existing file remains a risk and
        // therefore flows through the same explicit approval mechanism below.
        if (request.creates === true) {
          const decision: ToolPermissionDecision = { decision: 'allow_for_run' }
          return {
            decision,
            journalPermissionDecision: journalPermissionDecisionFromGateAndResolution({
              policyAction,
              interactiveDecision: decision.decision
            })
          }
        }
        break
      case 'request_approval':
        break
    }
  }

  if (await ctx.permissionGrants.allows(request, ctx)) {
    const decision: ToolPermissionDecision = { decision: 'allow_for_run' }
    return {
      decision,
      journalPermissionDecision: journalPermissionDecisionFromGateAndResolution({
        policyAction,
        interactiveDecision: decision.decision
      })
    }
  }
  if (!ctx.requestToolPermission) {
    return {
      decision: {
        decision: 'deny',
        reason: `需要用户批准 ${request.operation}${request.targetPath ? `：${request.targetPath}` : ''}，但当前会话没有审批通道。`
      },
      journalPermissionDecision: journalPermissionDecisionFromGateAndResolution({
        policyAction,
        interactiveDecision: 'deny'
      })
    }
  }
  const rawDecision = await ctx.requestToolPermission(request, callCtx)
  const decision =
    rawDecision.decision === 'allow'
      ? { ...rawDecision, decision: 'allow_once' as const }
      : rawDecision
  if (decision.decision !== 'deny') await ctx.permissionGrants.remember(request, decision, ctx)

  // Durable one-shot receipt for forced human decisions (high-risk + synthetic memory).
  // Receipts are evidence only and are never read back as authorization grants.
  if (shouldRecordForcedHumanApproval(request)) {
    try {
      await recordForcedHumanApprovalReceipt({
        rootPath: ctx.workspaceRoot,
        request,
        decision,
        args,
        traceId: callCtx?.runId ?? ctx.runId ?? callCtx?.toolCallId ?? request.id,
        toolCallId: callCtx?.toolCallId ?? request.id
      })
    } catch {
      // Receipt durability failures must not change the interactive gate outcome.
    }
  }

  return {
    decision,
    journalPermissionDecision: journalPermissionDecisionFromGateAndResolution({
      policyAction,
      interactiveDecision: decision.decision
    })
  }
}

async function describeToolPermission(
  toolName: string,
  descriptor: ToolPermissionDescriptor,
  args: unknown,
  ctx: ToolContext,
  callCtx?: ToolCallContext
): Promise<ToolPermissionRequest> {
  try {
    const detail = await descriptor.describe(args, ctx, callCtx)
    return {
      id: callCtx?.toolCallId ?? `${toolName}:${Date.now()}`,
      kind: descriptor.kind,
      toolName,
      ...detail,
      ...(descriptor.kind === 'workspace_write'
        ? {
            availableScopes: ['once', 'run', 'directory'] as Array<'once' | 'run' | 'directory'>,
            directoryScopePath: await canonicalDirectoryScope(ctx, detail.targetPath, detail.creates === true)
          }
        : {})
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

export class ToolRunPermissionGrants {
  private readonly run = new Set<string>()
  private readonly directories = new Map<string, Set<string>>()

  async allows(request: ToolPermissionRequest, ctx: ToolContext): Promise<boolean> {
    const key = permissionClassKey(request)
    if (this.run.has(key)) return true
    const target = await canonicalPermissionTarget(ctx, request.targetPath)
    if (!target) return false
    for (const scope of this.directories.get(key) ?? []) {
      if (isInside(scope, target)) return true
    }
    return false
  }

  async remember(request: ToolPermissionRequest, decision: ToolPermissionDecision, ctx: ToolContext): Promise<void> {
    const key = permissionClassKey(request)
    if (decision.decision === 'allow_for_run') {
      this.run.add(key)
      return
    }
    if (decision.decision !== 'allow_for_directory') return
    const scope = await canonicalDirectoryScopeAbsolute(ctx, decision.scopePath ?? request.directoryScopePath ?? request.targetPath, request.creates === true)
    if (!scope) throw new Error('目录授权缺少可验证的工作区范围。')
    const scopes = this.directories.get(key) ?? new Set<string>()
    scopes.add(scope)
    this.directories.set(key, scopes)
  }

  clear(): void {
    this.run.clear()
    this.directories.clear()
  }
}

async function canonicalDirectoryScope(ctx: ToolContext, targetPath?: string, creates = false): Promise<string | undefined> {
  const absolute = await canonicalDirectoryScopeAbsolute(ctx, targetPath, creates)
  if (!absolute || !ctx.workspaceRoot) return undefined
  return toPosix(relative(await realpath(resolve(ctx.workspaceRoot)), absolute)) || '.'
}

async function canonicalDirectoryScopeAbsolute(ctx: ToolContext, targetPath?: string, creates = false): Promise<string | undefined> {
  const target = await canonicalPermissionTarget(ctx, targetPath)
  if (!target) return undefined
  const raw = targetPath?.trim() ?? ''
  const directory = creates && !raw.endsWith('/') && raw.split('/').at(-1)?.includes('.') ? dirname(target) : target
  const info = await lstat(directory).catch(() => null)
  return info?.isDirectory() ? directory : dirname(directory)
}

async function canonicalPermissionTarget(ctx: ToolContext, targetPath?: string): Promise<string | undefined> {
  if (!ctx.workspaceRoot || !targetPath?.trim()) return undefined
  if (isAbsolute(targetPath)) throw new Error('目录授权不接受绝对路径。')
  const lexicalRoot = resolve(ctx.workspaceRoot)
  const lexicalTarget = resolve(lexicalRoot, targetPath)
  if (!isInside(lexicalRoot, lexicalTarget)) throw new Error('授权目标超出当前工作区。')
  const realRoot = await realpath(lexicalRoot)
  let ancestor = lexicalTarget
  const remainder: string[] = []
  while (true) {
    try {
      const realAncestor = await realpath(ancestor)
      if (!isInside(realRoot, realAncestor)) throw new Error('授权目标经过符号链接后超出当前工作区。')
      const candidate = resolve(realAncestor, ...remainder.reverse())
      if (!isInside(realRoot, candidate)) throw new Error('授权目标超出当前工作区。')
      return candidate
    } catch (error) {
      if (!isMissingPathError(error)) throw error
      if (ancestor === lexicalRoot) throw error
      remainder.push(ancestor.split(sep).at(-1) ?? '')
      ancestor = dirname(ancestor)
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function permissionClassKey(request: ToolPermissionRequest): string {
  return `${request.kind}\0${request.toolName}\0${request.operation}`
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

async function workspaceRelativePointer(ctx: ToolContext, targetPath?: string): Promise<string | undefined> {
  const target = await canonicalPermissionTarget(ctx, targetPath)
  if (!target || !ctx.workspaceRoot) return undefined
  const root = await realpath(resolve(ctx.workspaceRoot))
  const pointer = toPosix(relative(root, target))
  return pointer && pointer !== '.' ? pointer : undefined
}

async function resultArtifactPointer(result: string, ctx: ToolContext): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>
    const path = typeof parsed.path === 'string' ? parsed.path : typeof parsed.relativePath === 'string' ? parsed.relativePath : undefined
    return await workspaceRelativePointer(ctx, path?.trim() || undefined)
  } catch {
    return undefined
  }
}


function applyEntryResultBudget(result: string, entry: ToolEntry): string {
  const annotations = entry.annotations ?? annotationsForEffectClass(classifyToolEffect(entry.definition.function.name))
  void annotations // annotations are metadata for UI/permission; budget is independent
  return enforceToolResultBudget(result, entry.resultBudget).content
}
function decorateOperationResult(result: string, record: AgentOperationRecord, disposition: AgentOperationRecord['disposition']): string {
  const operation = operationSummary(record, disposition)
  try {
    const parsed = JSON.parse(result) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify({ ...(parsed as Record<string, unknown>), operation }, null, 2)
    }
  } catch {
    // Plain-text tool results are wrapped so the disposition remains auditable.
  }
  return JSON.stringify({ ok: true, result, operation }, null, 2)
}

function operationSummary(record: AgentOperationRecord, disposition: AgentOperationRecord['disposition']): Record<string, unknown> {
  return {
    operationId: record.operationId,
    disposition,
    state: record.state,
    ...(record.normalizedTarget ? { targetPath: record.normalizedTarget } : {}),
    ...(record.artifactPointer ? { artifactPointer: record.artifactPointer } : {})
  }
}
