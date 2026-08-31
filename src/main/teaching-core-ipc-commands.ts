/**
 * Teaching kernel / knowledge IPC command group.
 *
 * Wires memory, diagnostics, teaching presentation, TeachingDoctor,
 * teaching-turn review, study planning, sandbox readiness and system-font
 * commands that used to live in `teaching-ipc-gateway.ts`. The gateway
 * registers this group through `createTeachingCoreCommands`.
 *
 * ADR-0011 study-planning snapshots and ADR-0001 review projections stay
 * read/apply boundaries; memory stays consent-gated (ADR-0009); the doctor
 * lane remains a learner-safe redacted read boundary (ADR-0007 / ADR-0013).
 */
import { app, shell } from 'electron'
import { normalizeAgentSandboxMode, resolveAgentSandboxReadiness } from './ai/tools/agent-sandbox-policy'
import { createLearningSessionLedger } from './learning-session-ledger'
import {
  createTeachingDoctorCatalogDriftFactsCollector,
  createTeachingDoctorConfigFactsCollector,
  createTeachingDoctorMcpFactsCollector,
  createTeachingDoctorSessionOutcomeScanFactsCollector,
  createTeachingDoctorSourceGapFactsCollector,
  runProductTeachingDoctor
} from './observability'
import { planLessonIndexReconciliation } from './teaching-workspace/catalog-reconciliation'
import { listSystemFonts } from './system-fonts'
import {
  runDecideTeachingTurnReviewIpc,
  runProjectTeachingTurnReviewHandoffIpc,
  runProjectTeachingTurnReviewIpc
} from './teaching-turn-review-ipc'
import {
  runGetTeachingTurnReviewLastBundleIpc,
  runSaveTeachingTurnReviewLastBundleIpc
} from './teaching-turn-review-last-bundle-ipc'
import {
  parseApplyStudyPlanningPayload,
  parseReadStudyPlanningPayload,
  runApplyStudyPlanningIpc,
  runReadStudyPlanningIpc
} from './study-planning-ipc'
import { resolveOptionalRegisteredWorkspaceRoot, resolveRegisteredWorkspaceRoot } from './teaching-workspace-access'
import {
  optionalString,
  parseCreateMemoryPayload,
  parseDecideTeachingTurnReviewPayload,
  parseGetTeachingPresentationPayload,
  parseGetTeachingTurnReviewLastBundlePayload,
  parseProjectTeachingTurnReviewHandoffPayload,
  parseProjectTeachingTurnReviewPayload,
  parseRunTeachingDoctorPayload,
  parseSaveTeachingTurnReviewLastBundlePayload,
  parseTeachingPresentationActionPayload,
  parseTeachingPresentationActionResult,
  parseTeachingPresentationSnapshot,
  parseUpdateMemoryPayload,
  requireString
} from './teaching-ipc-commands'
import { teachingInvokeChannels } from '../shared/teaching-ipc-contract'
import {
  command,
  type GatewayCommand,
  type GatewayContext,
  identityReply,
  noStreamCleanup
} from './teaching-ipc-gateway-context'

export function createTeachingCoreCommands(context: GatewayContext): GatewayCommand[] {
  const { workspaceService: service, settingsService: settings } = context

  const resolveOptionalWorkspaceRoot = async (rawWorkspaceRoot: string | undefined) =>
    resolveOptionalRegisteredWorkspaceRoot((await service.getState()).workspaces, rawWorkspaceRoot)

  const resolveGitWorkspaceRoot = async (rawWorkspaceRoot: string) =>
    resolveRegisteredWorkspaceRoot((await service.getState()).workspaces, rawWorkspaceRoot)

  return [
    command({
      channel: teachingInvokeChannels.listMemory, parser: (workspaceRoot) => optionalString(workspaceRoot),
      action: async (_event, workspaceRoot) => { const access = await resolveOptionalWorkspaceRoot(workspaceRoot); if (!access.ok) throw new Error(access.message); return service.listMemory(access.rootPath) },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.getMemoryDiagnostics, parser: () => undefined, action: () => service.getMemoryDiagnostics(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getConnectorStatuses, parser: () => undefined, action: () => service.getConnectorStatuses(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.getAgentSandboxReadiness,
      parser: () => undefined,
      action: async () => {
        const loadedSettings = await settings.load()
        const mode = normalizeAgentSandboxMode(loadedSettings.tools?.sandboxMode, 'workspace_write')
        return resolveAgentSandboxReadiness({
          mode,
          windowsSandboxLevel: loadedSettings.tools?.windowsSandboxLevel
        })
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.getTeachingPresentation,
      parser: (payload) => parseGetTeachingPresentationPayload(payload),
      action: async () => {
        try {
          const workspaceId = (await service.getState()).activeWorkspace?.id
          if (!workspaceId || !context.turnCoordinatorHost) return null
          // This is a learner-safe read boundary. Do not surface host/ledger
          // failures (which may contain paths or diagnostic details) to renderer.
          return await context.turnCoordinatorHost.getTeachingPresentation(workspaceId)
            .then((snapshot) => parseTeachingPresentationSnapshot(snapshot))
            .catch(() => null)
        } catch {
          return null
        }
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.actOnTeachingPresentation,
      parser: (payload) => parseTeachingPresentationActionPayload(payload),
      action: async (_event, payload) => {
        try {
          const workspaceId = (await service.getState()).activeWorkspace?.id
          if (!workspaceId || !context.turnCoordinatorHost) return { status: 'unavailable' as const, snapshot: null }
          // Fail closed rather than forwarding host/ledger diagnostics through IPC.
          return await context.turnCoordinatorHost.actOnTeachingPresentation(workspaceId, payload)
            .then((result) => parseTeachingPresentationActionResult(result))
            .catch(() => ({ status: 'unavailable' as const, snapshot: null }))
        } catch {
          return { status: 'unavailable' as const, snapshot: null }
        }
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.createMemory, parser: (payload) => parseCreateMemoryPayload(payload),
      action: async (_event, request) => {
        const access = await resolveOptionalWorkspaceRoot(request.workspaceRoot)
        if (!access.ok) throw new Error(access.message)
        if (request.scope !== 'user' && !access.rootPath) throw new Error('Workspace memory requires a registered teaching workspace.')
        return service.createMemory({ ...request, workspaceRoot: access.rootPath })
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.updateMemory,
      parser: (memoryId, patch) => ({ patch: parseUpdateMemoryPayload(patch), memoryId: requireString(memoryId, 'memoryId') }),
      action: async (_event, request) => { const access = await resolveOptionalWorkspaceRoot(request.patch.workspaceRoot); if (!access.ok) throw new Error(access.message); return service.updateMemory(request.memoryId, { ...request.patch, workspaceRoot: access.rootPath }) },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.deleteMemory,
      parser: (memoryId, workspaceRoot) => ({ memoryId: requireString(memoryId, 'memoryId'), workspaceRoot: optionalString(workspaceRoot) }),
      action: async (_event, request) => { const access = await resolveOptionalWorkspaceRoot(request.workspaceRoot); if (!access.ok) throw new Error(access.message); return service.deleteMemory(request.memoryId, access.rootPath) },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.openLogFile, parser: () => undefined,
      action: async () => { const message = await shell.openPath(context.logger.path); return { ok: message.length === 0, message: message || undefined } },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.openAppDataDir, parser: () => undefined,
      action: async () => { const message = await shell.openPath(app.getPath('userData')); return { ok: message.length === 0, message: message || undefined } },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.runTeachingDoctor,
      parser: (payload) => parseRunTeachingDoctorPayload(payload),
      action: async (_event, request) => runProductTeachingDoctor(request, {
        crashMarkerStore: context.crashMarkerStore ?? null,
        factsCollectors: [
          createTeachingDoctorConfigFactsCollector({
            load: () => context.settingsService.load()
          }),
          createTeachingDoctorSessionOutcomeScanFactsCollector({
            loadScan: async () => {
              const state = await context.workspaceService.getState()
              const ws = state.activeWorkspace
              if (!ws?.rootPath) return null
              // Thin composition: public ledger factory only — no peel of FileLearningSessionLedger internals.
              return createLearningSessionLedger({ workspaceRoot: ws.rootPath }).scan()
            }
          }),
          createTeachingDoctorCatalogDriftFactsCollector({
            loadPlan: async () => {
              const state = await context.workspaceService.getState()
              const ws = state.activeWorkspace
              if (!ws) return null
              const plan = await planLessonIndexReconciliation({
                rootPath: ws.rootPath,
                workspaceName: ws.name,
                workspaceId: ws.id,
                lessons: ws.lessons
              })
              return {
                requiresPersist: plan.requiresPersist,
                recoveredRelativePaths: plan.recoveredRelativePaths,
                removedRelativePaths: plan.removedRelativePaths
              }
            }
          }),
          createTeachingDoctorSourceGapFactsCollector({
            loadSummary: async () => {
              const state = await context.workspaceService.getState()
              const ws = state.activeWorkspace
              if (!ws) return null
              return {
                resourcesCount: Array.isArray(ws.resources) ? ws.resources.length : 0,
                referenceCount: typeof ws.referenceCount === 'number' ? ws.referenceCount : 0,
                assetsReady: ws.assetsReady === true
              }
            }
          }),
          ...(context.mcpFactsSource
            ? [
                createTeachingDoctorMcpFactsCollector({
                  loadConfig: () => context.mcpFactsSource!.loadConfig(),
                  listRuntime: () => context.mcpFactsSource!.listRuntime(),
                  getHostAggregates: () =>
                    context.mcpFactsSource!.getHostAggregates?.() ?? null
                })
              ]
            : [])
        ]
      }),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.projectTeachingTurnReview,
      parser: (payload) => parseProjectTeachingTurnReviewPayload(payload),
      // Pure projection only — never auto-apply / installSkill / createMemory / write files.
      action: (_event, payload) => runProjectTeachingTurnReviewIpc(payload),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.decideTeachingTurnReview,
      parser: (payload) => parseDecideTeachingTurnReviewPayload(payload),
      // Decision submit maps to the same pure project path; approved ids are not an apply plan.
      action: (_event, payload) => runDecideTeachingTurnReviewIpc(payload),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.projectTeachingTurnReviewHandoff,
      parser: (payload) => parseProjectTeachingTurnReviewHandoffPayload(payload),
      // Pure handoff intents only — never auto-apply / installSkill / createMemory / write files.
      action: (_event, payload) => runProjectTeachingTurnReviewHandoffIpc(payload),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.getTeachingTurnReviewLastBundle,
      parser: (payload) => parseGetTeachingTurnReviewLastBundlePayload(payload),
      // Durable last-bundle read only — never auto-apply / installSkill / createMemory.
      action: async () =>
        runGetTeachingTurnReviewLastBundleIpc({ rootPath: app.getPath('userData') }),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.saveTeachingTurnReviewLastBundle,
      parser: (payload) => parseSaveTeachingTurnReviewLastBundlePayload(payload),
      // Durable last-bundle write only — never auto-apply after save.
      action: async (_event, payload) =>
        runSaveTeachingTurnReviewLastBundleIpc(payload, { rootPath: app.getPath('userData') }),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.readStudyPlanning,
      parser: (payload) => parseReadStudyPlanningPayload(payload),
      // ADR-0011: workspace-scoped snapshot read; registered roots only.
      action: async (_event, payload) =>
        runReadStudyPlanningIpc(payload, async (raw) => {
          const access = await resolveGitWorkspaceRoot(raw)
          return access.ok
            ? { ok: true as const, rootPath: access.rootPath }
            : { ok: false as const, message: access.message }
        }),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.applyStudyPlanning,
      parser: (payload) => parseApplyStudyPlanningPayload(payload),
      // ADR-0011: sole-writer apply with revision CAS; no silent first-task bind here.
      action: async (_event, payload) =>
        runApplyStudyPlanningIpc(payload, async (raw) => {
          const access = await resolveGitWorkspaceRoot(raw)
          return access.ok
            ? { ok: true as const, rootPath: access.rootPath }
            : { ok: false as const, message: access.message }
        }),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.listSystemFonts,
      parser: () => undefined,
      action: async () => listSystemFonts(),
      reply: identityReply, streamCleanup: noStreamCleanup
    })
  ]
}
