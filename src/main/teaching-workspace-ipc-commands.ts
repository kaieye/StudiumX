/**
 * Teaching workspace / app IPC command group.
 *
 * Wires the workspace, lesson, skill, agent-conversation repository, git,
 * provider and app-surface commands that used to live in
 * `teaching-ipc-gateway.ts`. The gateway registers this group through
 * `createTeachingWorkspaceCommands`.
 *
 * Preview-lesson binding, git worktree resolution and provider proxy remain
 * the only shared wiring helpers; settlement and teaching authority are not
 * touched here (ADR-0001 / ADR-0002 / ADR-0004).
 */
import { app, BrowserWindow, dialog, Notification, shell } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { actOnAppUpdate, checkForAppUpdates, openAppUpdateDialog } from './app-updater'
import { getSkillOrchestrationEligibility } from './builtin-skill-orchestration-policy'
import { openExternalHttpUrl } from './external-links'
import { isPathInsideConfiguredRoot, isRealPathInsideRoot } from './path-access'
import { fetchUpstreamModels, probeModelProvider } from './provider-connection'
import {
  createAndSwitchGitBranchForWorkspace,
  getGitBranchesForWorkspace,
  listGitWorktreesForWorkspace,
  removeGitWorktreeForWorkspace,
  switchGitBranchForWorkspace
} from './teaching-git'
import { resolveRegisteredWorkspaceRoot } from './teaching-workspace-access'
import {
  PreviewLessonInteractionBindingError,
  type PreviewLessonNavigation
} from './teaching-workspace'
import {
  optionalString,
  parseApplyLessonStylePayload,
  parseCommitLearningOutcomeRequest,
  parseCreateAgentConversationCheckpointPayload,
  parseCreateWorkspacePayload,
  parseDirectLessonActionStatusPayload,
  parseForkAgentConversationBranchPayload,
  parseGenerateLessonPayload,
  parseGitBranchPayload,
  parseListAgentWriteRewindJournalPayload,
  parseListUpstreamModelsPayload,
  parseNotificationPayload,
  parseOpenAgentConversationBranchPayload,
  parsePreviewLessonInteractionIntent,
  parsePreviewSkillOrchestrationPayload,
  parseProbeProviderPayload,
  parseProjectAgentConversationSummariesPayload,
  parseQueryAgentArchivedHistoryPayload,
  parseReadAgentConversationPayload,
  parseReadAgentConversationSessionTreePayload,
  parseReadLessonPayload,
  parseReadWorkspaceChangeDiffPayload,
  parseReadWorkspaceMarkdownPayload,
  parseRebuildAgentHistoryIndexPayload,
  parseRecordProgressPayload,
  parseRemoveGitWorktreePayload,
  parseRenameAgentConversationPayload,
  parseReplayAgentConversationBranchPayload,
  parseResolveAgentConversationCheckpointPayload,
  parseRestoreAgentWriteRewindPayload,
  parseSaveAgentConversationPayload,
  parseSaveWorkspaceMarkdownPayload,
  parseSettingsPatch,
  parseSetWorkspaceTrustPayload,
  parseUpdateAgentConversationBranchStatusPayload,
  parseUpdateMissionPayload,
  parseWorkspaceItemMetaPayload,
  parseWorkspaceItemRemovePayload,
  parseWorkspaceRemovePayload,
  requireString,
  requireWindowControlAction
} from './teaching-ipc-commands'
import type {
  AnalyticsExportRequest,
  AppUpdateAction,
  ClearAnalyticsRequest,
  LearningAnalyticsRequest,
  TeachingSettingsV1
} from '../shared/teaching-types'
import { teachingEventChannels, teachingInvokeChannels } from '../shared/teaching-ipc-contract'
import {
  command,
  errorMessage,
  type GatewayCommand,
  type GatewayContext,
  identityReply,
  noStreamCleanup,
  safeSend
} from './teaching-ipc-gateway-context'

export function createTeachingWorkspaceCommands(context: GatewayContext): GatewayCommand[] {
  const { workspaceService: service, settingsService: settings, skillLibraryService: skills, learningAnalyticsService: analytics } = context

  const resolveGitWorkspaceRoot = async (rawWorkspaceRoot: string) =>
    resolveRegisteredWorkspaceRoot((await service.getState()).workspaces, rawWorkspaceRoot)

  return [
    command({ channel: teachingInvokeChannels.getState, parser: () => undefined, action: () => service.getState(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getLearningAnalytics, parser: (query) => query as LearningAnalyticsRequest, action: (_event, query) => analytics.getLearningAnalytics(query), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.clearLearningAnalytics, parser: (request) => request as ClearAnalyticsRequest, action: (_event, request) => analytics.clearLearningAnalytics(request), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.exportLearningAnalytics,
      parser: (request) => request as AnalyticsExportRequest,
      action: async (_event, exportRequest) => {
        const prepared = await analytics.prepareExport(exportRequest)
        const options: Electron.SaveDialogOptions = { title: '导出学习分析', defaultPath: prepared.fileName, filters: exportRequest.format === 'json' ? [{ name: 'JSON', extensions: ['json'] }] : [{ name: 'CSV', extensions: ['csv'] }] }
        const mainWindow = BrowserWindow.getFocusedWindow()
        const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return { canceled: true as const }
        await writeFile(result.filePath, prepared.content, { encoding: 'utf8', mode: 0o600 })
        return { canceled: false as const, fileName: basename(result.filePath), bytesWritten: Buffer.byteLength(prepared.content, 'utf8'), manifest: prepared.manifest }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.checkForAppUpdates, parser: () => undefined, action: () => checkForAppUpdates(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.openAppUpdateDialog, parser: () => undefined, action: () => openAppUpdateDialog(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.appUpdateAction, parser: (action) => action as AppUpdateAction, action: (_event, action) => actOnAppUpdate(action), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getAppVersion, parser: () => undefined, action: () => app.getVersion(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getSettings, parser: () => undefined, action: () => settings.load(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.listInterruptedAgentRuns, parser: () => undefined, action: () => service.listInterruptedAgentRuns(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.listTerminalAgentRunNotices, parser: () => undefined, action: () => service.listTerminalAgentRunNotices(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.updateSettings, parser: (payload) => parseSettingsPatch(payload),
      action: async (_event, payload) => { const updated = await settings.patch(payload); void context.applyAppBehavior(updated); return updated },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.selectWorkspace, parser: (workspaceId) => requireString(workspaceId, 'workspaceId'), action: (event, workspaceId) => { clearPreviewLessonBindingForSender(context, event); return service.selectWorkspace(workspaceId) }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.createWorkspace, parser: (payload) => parseCreateWorkspacePayload(payload), action: (_event, payload) => service.createWorkspace(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.importWorkspace, parser: () => undefined,
      action: async () => {
        const mainWindow = BrowserWindow.getFocusedWindow()
        const result = mainWindow ? await dialog.showOpenDialog(mainWindow, { title: '选择教学工作区', properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] }) : await dialog.showOpenDialog({ title: '选择教学工作区', properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] })
        const rootPath = result.filePaths[0]
        return result.canceled || !rootPath ? { canceled: true, state: null } : { canceled: false, state: await service.importWorkspace(rootPath) }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.importWorkspacePath, parser: (rootPath) => requireString(rootPath, 'rootPath').trim(), action: (_event, rootPath) => service.importWorkspace(rootPath), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.pickDirectory, parser: (defaultPath) => defaultPath,
      action: async (_event, defaultPath) => {
        const options: Electron.OpenDialogOptions = { title: '选择目录', properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'], ...(typeof defaultPath === 'string' && defaultPath.trim() ? { defaultPath: defaultPath.trim() } : {}) }
        const mainWindow = BrowserWindow.getFocusedWindow()
        const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
        const path = result.filePaths[0] ?? null
        return { canceled: result.canceled || !path, path }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.openImportLocation, parser: (rawPath) => optionalString(rawPath),
      action: async (_event, requestedPath) => {
        const loadedSettings = await settings.load()
        const target = resolve(requestedPath ?? (loadedSettings.workspace.defaultRoot || app.getPath('documents')))
        if (!requestedPath) await mkdir(target, { recursive: true }).catch(() => {})
        const message = await shell.openPath(target)
        return { ok: message.length === 0, message: message || undefined }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.updateMission, parser: (payload) => parseUpdateMissionPayload(payload), action: (_event, payload) => service.updateMission(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.setWorkspaceTrust, parser: (payload) => parseSetWorkspaceTrustPayload(payload), action: (_event, payload) => service.setWorkspaceTrust(payload.workspaceId, payload.trust), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.applyLessonStyle, parser: (payload) => parseApplyLessonStylePayload(payload), action: (_event, payload) => service.applyLessonStyle(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.listSkills,
      parser: () => undefined,
      action: async () => {
        const catalog = await skills.listSkills()
        // The renderer consumes this projection for product surfaces only. The
        // planner retains the host registry as its final fail-closed authority.
        return {
          ...catalog,
          skills: catalog.skills.map((skill) => ({
            ...skill,
            orchestration: getSkillOrchestrationEligibility(skill)
          }))
        }
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.previewSkillOrchestration,
      parser: (payload) => parsePreviewSkillOrchestrationPayload(payload),
      action: (_event, payload) => {
        // Read-only preview (ADR-0014): reuses the turn's host assembly + pure
        // plan(), reads the ADR-0014 continuity state but never advances or
        // persists it. No ledger write, no outcome, no Evidence, no tool run.
        return service.previewSkillOrchestration(payload)
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.installSkill, parser: (skillId) => requireString(skillId, 'skillId'), action: (_event, skillId) => skills.installSkill(skillId), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.uninstallSkill, parser: (skillId) => requireString(skillId, 'skillId'), action: (_event, skillId) => skills.uninstallSkill(skillId), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.generateLesson, parser: (payload) => parseGenerateLessonPayload(payload), action: (_event, payload) => service.generateLesson(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getDirectLessonActionStatus, parser: (payload) => parseDirectLessonActionStatusPayload(payload), action: (_event, payload) => service.getDirectLessonActionStatus(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.generateLessonStream, parser: (payload) => parseGenerateLessonPayload(payload),
      action: async (event, payload) => {
        const streamId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
        try {
          const result = await service.generateLessonStream(payload, { streamId, onChunk: (chunk) => safeSend(event.sender, teachingEventChannels.lessonStreamChunk, chunk), onStatus: (status) => safeSend(event.sender, teachingEventChannels.lessonStreamStatus, status) })
          return { streamId, ...result }
        } catch (error) {
          const message = errorMessage(error); context.logger.error(`Lesson stream failed: ${message}`); return { streamId, error: true as const, message }
        }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.renameAgentConversation,
      parser: (payload) => parseRenameAgentConversationPayload(payload),
      action: async (_event, payload) => { const result = await service.renameAgentConversation(payload); analytics.invalidate(['conversation']); return result },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.saveAgentConversation,
      parser: (payload) => parseSaveAgentConversationPayload(payload),
      action: async (_event, payload) => {
        const result = await service.saveAgentConversation(payload)
        analytics.invalidate(['conversation'])
        return result
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.readAgentConversation, parser: (payload) => parseReadAgentConversationPayload(payload), action: (_event, payload) => service.readAgentConversation(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.projectAgentConversationSummaries, parser: (payload) => parseProjectAgentConversationSummariesPayload(payload), action: (_event, payload) => service.projectAgentConversationSummaries(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.readAgentConversationSessionTree, parser: (payload) => parseReadAgentConversationSessionTreePayload(payload), action: (_event, payload) => service.readAgentConversationSessionTree(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.openAgentConversationBranch, parser: (payload) => parseOpenAgentConversationBranchPayload(payload), action: (_event, payload) => service.openAgentConversationBranch(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.forkAgentConversationBranch, parser: (payload) => parseForkAgentConversationBranchPayload(payload), action: async (_event, payload) => { const result = await service.forkAgentConversationBranch(payload); analytics.invalidate(['conversation']); return result }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.replayAgentConversationBranch, parser: (payload) => parseReplayAgentConversationBranchPayload(payload), action: (_event, payload) => service.replayAgentConversationBranch(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.updateAgentConversationBranchStatus, parser: (payload) => parseUpdateAgentConversationBranchStatusPayload(payload), action: async (_event, payload) => { const result = await service.updateAgentConversationBranchStatus(payload); analytics.invalidate(['conversation']); return result }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.createAgentConversationCheckpoint, parser: (payload) => parseCreateAgentConversationCheckpointPayload(payload), action: (_event, payload) => service.createAgentConversationCheckpoint(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.resolveAgentConversationCheckpoint, parser: (payload) => parseResolveAgentConversationCheckpointPayload(payload), action: (_event, payload) => service.resolveAgentConversationCheckpoint(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.restoreAgentWriteRewind, parser: (payload) => parseRestoreAgentWriteRewindPayload(payload), action: (_event, payload) => service.restoreAgentWriteRewind(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.listAgentWriteRewindJournal, parser: (payload) => parseListAgentWriteRewindJournalPayload(payload), action: (_event, payload) => service.listAgentWriteRewindJournal(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.queryAgentArchivedHistory, parser: (payload) => parseQueryAgentArchivedHistoryPayload(payload), action: (_event, payload) => service.queryAgentArchivedHistory(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.rebuildAgentHistoryIndex, parser: (payload) => parseRebuildAgentHistoryIndexPayload(payload), action: (_event, payload) => service.rebuildAgentHistoryIndex(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.setWorkspaceItemMeta, parser: (payload) => parseWorkspaceItemMetaPayload(payload), action: (_event, payload) => service.setWorkspaceItemMeta(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.removeWorkspaceItem, parser: (payload) => parseWorkspaceItemRemovePayload(payload), action: (_event, payload) => service.removeWorkspaceItem(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.removeWorkspace, parser: (payload) => parseWorkspaceRemovePayload(payload), action: (_event, payload) => service.removeWorkspace(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.readLesson, parser: (payload) => parseReadLessonPayload(payload), action: (event, payload) => {
      const senderId = previewBindingSenderId(context, event)
      return service.readLesson(payload, senderId)
    }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.recordPreviewLessonInteraction, parser: (payload) => parsePreviewLessonInteractionIntent(payload), action: (event, intent) => service.recordPreviewLessonInteraction(previewBindingSenderId(context, event), intent), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.commitLearningOutcome,
      parser: (payload) => parseCommitLearningOutcomeRequest(payload),
      action: (_event, request) => {
        if (!request) return { status: 'non_retryable_failure' as const, reason: 'invalid_request' as const }
        // Prefer coordinator host when composed so production sole-writer stays on main.
        if (context.turnCoordinatorHost) return context.turnCoordinatorHost.commitLearningOutcome(request)
        return service.commitLearningOutcome(request)
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.readWorkspaceMarkdown, parser: (payload) => parseReadWorkspaceMarkdownPayload(payload), action: (event, payload) => {
      const senderId = previewBindingSenderId(context, event)
      return service.readWorkspaceMarkdown(payload, senderId)
    }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.readWorkspaceChangeDiff, parser: (payload) => parseReadWorkspaceChangeDiffPayload(payload), action: (_event, payload) => service.readWorkspaceChangeDiff(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.saveWorkspaceMarkdown, parser: (payload) => parseSaveWorkspaceMarkdownPayload(payload), action: (_event, payload) => service.saveWorkspaceMarkdown(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.openPath, parser: (rawPath) => resolve(String(rawPath ?? '')),
      action: async (_event, target) => {
        const state = await service.getState()
        const loadedSettings = await settings.load()
        const lexicalAllowedRoots = [...state.workspaces.map((workspace) => workspace.rootPath), loadedSettings.worktree.rootPath, loadedSettings.workspace.defaultRoot].filter((rootPath) => isPathInsideConfiguredRoot(rootPath, target))
        const allowed = lexicalAllowedRoots.length > 0 && (await Promise.all(lexicalAllowedRoots.map((rootPath) => isRealPathInsideRoot(rootPath, target)))).some(Boolean)
        if (!allowed) return { ok: false, message: 'Path is outside registered teaching workspaces.' }
        const message = await shell.openPath(target)
        return { ok: message.length === 0, message: message || undefined }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.openExternal, parser: (rawUrl) => rawUrl,
      action: async (_event, rawUrl) => openExternalHttpUrl(rawUrl, await settings.load(), (url) => shell.openExternal(url)),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.showNotification, parser: (payload) => payload,
      action: async (_event, rawPayload) => {
        if (!(await settings.load()).notifications.enabled || !Notification.isSupported()) return
        const payload = parseNotificationPayload(rawPayload)
        new Notification({ title: payload.title, body: payload.body }).show()
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.controlWindow, parser: (action) => requireWindowControlAction(action),
      action: (event, action) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender)
        if (!targetWindow) return
        if (action === 'minimize') { targetWindow.minimize(); return }
        if (action === 'toggle-maximize') { if (targetWindow.isMaximized()) targetWindow.unmaximize(); else targetWindow.maximize(); return }
        targetWindow.close()
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.probeProvider, parser: (payload) => parseProbeProviderPayload(payload),
      action: async (_event, payload) => probeModelProvider(payload, resolveProxyUrl(await settings.load())),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.listUpstreamModels,
      parser: async (payload) => {
        const loadedSettings = await settings.load()
        return {
          request: parseListUpstreamModelsPayload(payload, loadedSettings.provider.providers),
          proxyUrl: resolveProxyUrl(loadedSettings)
        }
      },
      action: (_event, payload) => payload.request
        ? fetchUpstreamModels(payload.request, payload.proxyUrl)
        : { ok: false as const, message: '未找到该 provider。' },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.listReviewCards, parser: (workspaceId) => requireString(workspaceId, 'workspaceId'), action: (_event, workspaceId) => service.listReviewCards(workspaceId), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.recordProgress, parser: (payload) => parseRecordProgressPayload(payload), action: (_event, payload) => service.recordProgress(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getProgress, parser: (workspaceId) => requireString(workspaceId, 'workspaceId'), action: (_event, workspaceId) => service.getProgress(workspaceId), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.listGitWorktrees, parser: (workspaceRoot) => requireString(workspaceRoot, 'workspaceRoot'),
      action: async (_event, workspaceRoot) => listGitWorktreesForWorkspace(workspaceRoot, (await settings.load()).worktree.rootPath),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.removeGitWorktree, parser: (payload) => parseRemoveGitWorktreePayload(payload),
      action: async (_event, request) => {
        const access = await resolveGitWorkspaceRoot(request.workspaceRoot)
        if (!access.ok) return { ok: false, message: access.message }
        return removeGitWorktreeForWorkspace({ workspaceRoot: access.rootPath, worktreePath: request.worktreePath, worktreeRoot: (await settings.load()).worktree.rootPath })
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.listGitBranches, parser: (workspaceRoot) => requireString(workspaceRoot, 'workspaceRoot'),
      action: async (_event, workspaceRoot) => { const access = await resolveGitWorkspaceRoot(workspaceRoot); return access.ok ? getGitBranchesForWorkspace(access.rootPath) : access },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.switchGitBranch, parser: (payload) => parseGitBranchPayload(payload),
      action: async (_event, request) => { const access = await resolveGitWorkspaceRoot(request.workspaceRoot); return access.ok ? switchGitBranchForWorkspace(access.rootPath, request.branch) : access },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.createGitBranch, parser: (payload) => parseGitBranchPayload(payload),
      action: async (_event, request) => { const access = await resolveGitWorkspaceRoot(request.workspaceRoot); return access.ok ? createAndSwitchGitBranchForWorkspace(access.rootPath, request.branch) : access },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
  ]
}

/**
 * A child iframe keeps its WindowProxy across document navigations. Revoke the
 * main-owned preview authority at Electron's navigation start instead of
 * trusting renderer load timing or a WindowProxy equality check.
 */
function previewBindingSenderId(context: GatewayContext, event: Electron.IpcMainInvokeEvent): number {
  const sender = event.sender
  if (!sender || sender.isDestroyed() || !Number.isSafeInteger(sender.id) || sender.id < 1) {
    throw new PreviewLessonInteractionBindingError('sender_unavailable', 'Preview lesson interaction sender is unavailable.')
  }
  ensurePreviewBindingLifecycle(context, sender)
  return sender.id
}

function ensurePreviewBindingLifecycle(context: GatewayContext, sender: Electron.WebContents): void {
  if (context.previewBindingLifecycleSenders.has(sender)) return
  context.previewBindingLifecycleSenders.add(sender)
  const senderId = sender.id
  sender.once('destroyed', () => context.workspaceService.clearPreviewLessonBinding(senderId))
  sender.on('did-start-navigation', (details, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId) => {
    context.workspaceService.observePreviewLessonNavigation(senderId, previewLessonNavigation(
      details, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId
    ))
  })
}

/** Extract navigation facts from Electron only; malformed or unavailable facts fail closed in the service. */
function previewLessonNavigation(
  details: unknown,
  url: unknown,
  isInPlace: unknown,
  isMainFrame: unknown,
  frameProcessId: unknown,
  frameRoutingId: unknown
): PreviewLessonNavigation {
  const detail = isUnknownRecord(details) ? details : null
  const frame = detail && isUnknownRecord(detail.frame) ? detail.frame : null
  return {
    url: stringNavigationFact(detail?.url, url),
    isMainFrame: booleanNavigationFact(detail?.isMainFrame, isMainFrame),
    isSameDocument: booleanNavigationFact(detail?.isSameDocument, isInPlace),
    frameProcessId: numberNavigationFact(frame?.processId, frameProcessId),
    frameRoutingId: numberNavigationFact(frame?.routingId, frameRoutingId)
  }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringNavigationFact(primary: unknown, fallback: unknown): string | null {
  return typeof primary === 'string' ? primary : typeof fallback === 'string' ? fallback : null
}

function booleanNavigationFact(primary: unknown, fallback: unknown): boolean | null {
  return typeof primary === 'boolean' ? primary : typeof fallback === 'boolean' ? fallback : null
}

function numberNavigationFact(primary: unknown, fallback: unknown): number | null {
  return typeof primary === 'number' ? primary : typeof fallback === 'number' ? fallback : null
}

function clearPreviewLessonBindingForSender(context: GatewayContext, event: Electron.IpcMainInvokeEvent): void {
  const sender = event.sender
  if (!sender || sender.isDestroyed() || !Number.isSafeInteger(sender.id) || sender.id < 1) return
  ensurePreviewBindingLifecycle(context, sender)
  context.workspaceService.clearPreviewLessonBinding(sender.id)
}

function resolveProxyUrl(settings: TeachingSettingsV1): string {
  return settings.provider.proxy.enabled ? settings.provider.proxy.url.trim() : ''
}
