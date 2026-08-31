/**
 * Mind-map IPC command group — repository, generation and proposal lanes
 * (ADR-0016 / ADR-0017).
 *
 * Wires the mind-map repository (list/create/read/update/flush/delete),
 * per-kind proposal + generation agent lanes, source-refresh and asset
 * lanes that used to live in `teaching-ipc-gateway.ts`. The gateway
 * registers this group through `createMindMapCommands`.
 *
 * Mind-map generation is not a teaching conversation and therefore must not
 * enter AgentEventBus persistence or settlement (ADR-0016 AI boundary).
 * Repository writes stay single-writer behind `expectedRevision` CAS.
 */
import { BrowserWindow, dialog } from 'electron'
import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { previewMindMapSourceRefresh } from './mind-map-source-refresh'
import { MindMapAssetStore } from './mind-map-assets'
import {
  cancelMindMapGeneration,
  generateMindMap,
  generateMindMapProposal,
  MindMapGenerationError
} from './mind-map-generation'
import {
  MindMapLessonError,
  MindMapSelectedFileError,
  resolveMindMapLesson,
  resolveMindMapNotes,
  resolveSelectedMindMapFile
} from './mind-map-selected-file'
import {
  resolveMindMapAutoSourceContext,
  type MindMapAutoSourceContext
} from './mind-map-auto-source'
import type { MindMapAssetRef } from '../../shared/mindmap/domain/types'
import type { MindMapDocument } from '../../shared/mindmap/mind-map-types'
import { migrateV1ToV2 } from '../../shared/mindmap/migrations'
import { applyMindMapProposal as applyReviewedMindMapProposal } from '../../shared/mindmap/commands/mind-map-proposal'
import { applyMindMapCommand } from '../../shared/mindmap/commands/mind-map-reducer'
import { buildMindMapSourceRefreshCommand } from '../../shared/mindmap/commands/mind-map-source-refresh'
import { buildMindMapProposalRequest } from '../../shared/mindmap/commands/mind-map-proposal-request'
import type {
  AgentChatStreamStatus,
  AgentRealtimeEvent,
  AgentStreamTerminalStatus,
  MindMapStreamStep
} from '../../shared/teaching-types'
import { parseMindMapSourceRefreshApplyPayload } from './mind-map-ipc-commands'
import { parseMindMapProposalApplyPayload } from './mind-map-proposal-ipc'
import {
  parseMindMapAccessPayload,
  parseMindMapAssetImportPayload,
  parseMindMapAssetReadPayload,
  parseMindMapCancelGenerationPayload,
  parseMindMapCreatePayload,
  parseMindMapFlushPayload,
  parseMindMapGeneratePayload,
  parseMindMapListPayload,
  parseMindMapProposalGeneratePayload,
  parseMindMapSourceRefreshPayload,
  parseMindMapUpdatePayload
} from '../teaching-ipc-commands'
import { teachingInvokeChannels, teachingEventChannels } from '../../shared/teaching-ipc-contract'
import {
  command,
  errorMessage,
  type GatewayCommand,
  type GatewayContext,
  identityReply,
  noStreamCleanup,
  safeSend
} from '../teaching-ipc-gateway-context'
import {
  createMindMapWorkspaceResolvers,
  unwrapMindMapUpdate
} from './mind-map-ipc-actions-shared'

export function createMindMapCommands(context: GatewayContext): GatewayCommand[] {
  const { workspaceService: service, settingsService: settings } = context
  const { resolveHomeMindMapRoot, getMindMapStore, resolveMindMapWorkspaceRoot } =
    createMindMapWorkspaceResolvers(context)

  /** Narrow guard: a strict envelope parser returned null → structured error. */
  const requireMindMapPayload = <Payload>(payload: Payload | null, channel: string): Payload => {
    if (payload === null) throw new Error(`Invalid IPC payload for ${channel}.`)
    return payload
  }

  const mindMapGenerationIpcError = (error: unknown): Error => {
    if (error instanceof MindMapGenerationError) {
      return new Error(`Mind map generation failed (${error.kind}): ${error.message}`)
    }
    return error instanceof Error ? error : new Error(String(error))
  }

  /** Normalize selected-file failures without returning absolute paths or raw content. */
  const mindMapSelectedFileIpcError = (error: unknown): Error => {
    if (error instanceof MindMapSelectedFileError) {
      return new Error(`Mind map selected file failed (${error.code}): ${error.message}`)
    }
    return new Error('Mind map selected file could not be resolved safely.')
  }

  /** Normalize fixed `NOTES.md` failures without returning absolute paths or raw content. */
  const mindMapNotesIpcError = (error: unknown): Error => {
    if (error instanceof MindMapSelectedFileError) {
      return new Error(`Mind map notes failed (${error.code}): ${error.message}`)
    }
    return new Error('Mind map NOTES.md could not be resolved safely.')
  }

  /** Normalize Lesson failures without returning absolute paths or raw HTML. */
  const mindMapLessonIpcError = (error: unknown): Error => {
    if (error instanceof MindMapLessonError) {
      return new Error(`Mind map lesson failed (${error.code}): ${error.message}`)
    }
    return new Error('Mind map Lesson could not be resolved safely.')
  }

  return [
    command({
      channel: teachingInvokeChannels.listMindMaps,
      parser: (payload) => parseMindMapListPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'listMindMaps')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        return getMindMapStore(root).list()
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.listMindMapLibrary,
      parser: () => undefined,
      action: async () => {
        const state = await service.getState()
        // Home cards live in the global MindMaps folder; each registered
        // workspace is a folder of its own per-workspace maps. Folders are
        // reported even when a workspace has no maps so the home page can show
        // every workspace folder.
        const homeRoot = await resolveHomeMindMapRoot()
        const home = await getMindMapStore(homeRoot).list()
        const workspaces = await Promise.all(
          state.workspaces.map(async (workspace) => ({
            workspaceId: workspace.id,
            name: workspace.name,
            path: workspace.rootPath,
            documents: await getMindMapStore(workspace.rootPath).list()
          }))
        )
        return { home, workspaces }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.createMindMap,
      parser: (payload) => parseMindMapCreatePayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'createMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        return getMindMapStore(root).create(p.title, p.structureClass)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.readMindMap,
      parser: (payload) => parseMindMapAccessPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'readMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        return getMindMapStore(root).read(p.id)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.importMindMapAsset,
      parser: (payload) => parseMindMapAssetImportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'importMindMapAsset')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        // The document id is part of the capability envelope. Resolve it before
        // opening a native picker so an asset cannot be imported into a stale or
        // unknown mind-map context.
        await getMindMapStore(root).read(p.id)
        const options: Electron.OpenDialogOptions = {
          title: '选择思维导图图片',
          properties: ['openFile', 'dontAddToRecent'],
          filters: [
            {
              name: 'Images',
              extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']
            }
          ]
        }
        const mainWindow = BrowserWindow.getFocusedWindow()
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options)
        const sourcePath = result.filePaths[0]
        if (result.canceled || !sourcePath) return { canceled: true as const }

        const assetStore = new MindMapAssetStore({ rootPath: join(root, 'mindmap-assets') })
        const asset = await assetStore.importFromFile({
          id: randomUUID(),
          fileName: basename(sourcePath),
          sourcePath
        })
        if (!isMindMapImageAsset(asset)) {
          await assetStore.remove(asset).catch(() => undefined)
          throw new Error('Selected mind-map asset is not a supported image.')
        }
        // Return only metadata. The renderer must attach the id through the
        // canonical asset.create + topic.update transaction before it is used.
        return { canceled: false as const, asset }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.readMindMapAsset,
      parser: (payload) => parseMindMapAssetReadPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'readMindMapAsset')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const document = await getMindMapStore(root).read(p.id)
        const asset = document.assets.find((candidate) => candidate.id === p.assetId)
        if (!asset) return null
        if (!isMindMapImageAsset(asset)) {
          throw new Error('Mind-map asset is not an image.')
        }
        const assetStore = new MindMapAssetStore({ rootPath: join(root, 'mindmap-assets') })
        const bytes = await assetStore.read(asset)
        const mimeType = mindMapImageMimeType(asset)
        if (!mimeType) throw new Error('Mind-map image MIME type is unavailable.')
        return {
          asset,
          dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.updateMindMap,
      parser: (payload) => parseMindMapUpdatePayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'updateMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        return getMindMapStore(root).update(p.id, p.doc, p.expectedRevision)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.flushMindMap,
      parser: (payload) => parseMindMapFlushPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'flushMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        await getMindMapStore(root).flush(p.id)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.previewMindMapSourceRefresh,
      parser: (payload) => parseMindMapSourceRefreshPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'previewMindMapSourceRefresh')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const current = await getMindMapStore(root).read(p.id)
        const preview = await previewMindMapSourceRefresh(current, root)
        return {
          documentId: current.id,
          revision: current.revision,
          ...preview
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.applyMindMapSourceRefresh,
      parser: (payload) => parseMindMapSourceRefreshApplyPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'applyMindMapSourceRefresh')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)
        const current = await store.read(p.id)

        // A preview is only a review snapshot. Do not even construct a reducer
        // command when the canonical document has moved since that preview.
        if (current.revision !== p.expectedRevision) {
          return {
            ok: false as const,
            code: 'revision_stale' as const,
            expectedRevision: p.expectedRevision,
            currentRevision: current.revision
          }
        }

        const built = buildMindMapSourceRefreshCommand(
          current,
          p.updates,
          new Date().toISOString()
        )
        if (!built.ok) return built

        // An empty confirmation list is an explicit no-op and never creates a
        // revision. The source files are never written by this lane.
        if (built.command === null) {
          return {
            ok: true as const,
            document: current,
            command: null,
            inverse: null,
            appliedSourceIds: built.appliedSourceIds
          }
        }

        const applied = applyMindMapCommand(current, built.command)
        if (!applied.ok) {
          return {
            ok: false as const,
            code: 'command_invalid' as const,
            error: applied.error,
            command: built.command
          }
        }

        // Store CAS closes the read/reduce/write race if another edit lands
        // after the revision check above.
        const persisted = await store.update(p.id, applied.document, p.expectedRevision)
        if (!persisted.ok) return persisted
        return {
          ok: true as const,
          document: persisted.document,
          command: built.command,
          inverse: applied.inverse,
          appliedSourceIds: built.appliedSourceIds
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.applyMindMapProposal,
      parser: (payload) => parseMindMapProposalApplyPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'applyMindMapProposal')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)
        const current = await store.read(p.id)

        // Check the caller's revision before reducing provider commands. This
        // keeps a stale review from even being evaluated against a newer
        // canonical snapshot; the store CAS below closes the read/write race.
        if (current.revision !== p.expectedRevision) {
          return {
            ok: false as const,
            code: 'revision_stale' as const,
            expectedRevision: p.expectedRevision,
            currentRevision: current.revision
          }
        }

        const applied = applyReviewedMindMapProposal(
          current,
          p.proposal.items,
          p.decisions
        )
        if (!applied.ok) {
          return {
            ok: false as const,
            code: 'command_invalid' as const,
            proposalId: p.proposal.proposalId,
            error: applied.error,
            command: applied.command,
            acceptedIds: applied.acceptedIds,
            rejectedIds: applied.rejectedIds
          }
        }

        // A review that accepts no items is an explicit no-op. It still returns
        // the current snapshot, but never creates a durable revision.
        if (applied.command === null) {
          return {
            ok: true as const,
            proposalId: p.proposal.proposalId,
            document: current,
            command: null,
            inverse: null,
            acceptedIds: applied.acceptedIds,
            rejectedIds: applied.rejectedIds
          }
        }

        const persisted = await store.update(p.id, applied.document, p.expectedRevision)
        if (!persisted.ok) {
          return persisted
        }
        return {
          ok: true as const,
          proposalId: p.proposal.proposalId,
          document: persisted.document,
          command: applied.command,
          inverse: applied.inverse,
          acceptedIds: applied.acceptedIds,
          rejectedIds: applied.rejectedIds
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.generateMindMapProposal,
      parser: (payload) => parseMindMapProposalGeneratePayload(payload),
      action: async (event, payload) => {
        const p = requireMindMapPayload(payload, 'generateMindMapProposal')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)
        const current = await store.read(p.id)
        let selectedFileContext
        let notesContext
        let lessonContext
        let autoSourceContext: MindMapAutoSourceContext | undefined
        if (p.scope === 'selected-file') {
          if (!p.selectedFile) {
            throw new Error('Invalid mind-map proposal request (invalid_source_refs): selected-file scope requires a selected file.')
          }
          try {
            selectedFileContext = await resolveSelectedMindMapFile(root, p.selectedFile.workspacePath)
          } catch (error) {
            throw mindMapSelectedFileIpcError(error)
          }
        } else if (p.scope === 'notes') {
          try {
            notesContext = await resolveMindMapNotes(root)
          } catch (error) {
            throw mindMapNotesIpcError(error)
          }
        } else if (p.scope === 'lesson') {
          if (!p.lesson) {
            throw new Error('Invalid mind-map proposal request (invalid_source_refs): lesson scope requires a Lesson.')
          }
          try {
            lessonContext = await resolveMindMapLesson(root, p.lesson.workspacePath)
          } catch (error) {
            throw mindMapLessonIpcError(error)
          }
        } else if (p.scope === 'sheet') {
          // There is no renderer-side source picker. A prompt such as
          // “根据资料分析文件夹中的 Markdown 生成导图” is resolved locally from
          // the user's own language, and only matching workspace Markdown is
          // read through the bounded main-process file boundary.
          autoSourceContext = await resolveMindMapAutoSourceContext(root, p.prompt)
        } else if (p.selectedFile !== undefined) {
          throw new Error('Invalid mind-map proposal request (source_out_of_scope): selectedFile is only valid for selected-file scope.')
        }
        const built = buildMindMapProposalRequest({
          document: current,
          scope: p.scope,
          sheetId: p.sheetId,
          selectedTopicIds: p.selectedTopicIds,
          sourceRefs: p.sourceRefs,
          selectedFileRef: selectedFileContext?.sourceRef,
          notesRef: notesContext?.sourceRef,
          lessonRef: lessonContext?.sourceRef
        })
        if (!built.ok) {
          throw new Error(`Invalid mind-map proposal request (${built.code}): ${built.message}`)
        }

        const loadedSettings = await settings.load()
        const generationId = p.generationId ?? randomUUID()
        const agentEvents = createMindMapAgentEventSender(event.sender, generationId)
        const sendStatus = (
          step: MindMapStreamStep,
          message?: string
        ): void => {
          safeSend(event.sender, teachingEventChannels.mindMapStreamStatus, {
            generationId,
            step,
            ...(message ? { message } : {})
          })
        }
        let streamStarted = false
        let proposal
        let assistantMessage: string | undefined
        sendStatus('calling', '正在准备思维导图生成')
        try {
          const generatedProposal = await generateMindMapProposal({
            title: current.title,
            prompt: p.prompt,
            settings: loadedSettings,
            document: current,
            request: built.request,
            history: p.history,
            selectedFileContext,
            autoSourceContext,
            notesContext,
            lessonContext,
            ...(p.imageAttachments?.length ? { imageAttachments: p.imageAttachments } : {}),
            generationId,
            workspaceRoot: root
          }, (delta) => {
            if (!streamStarted) {
              streamStarted = true
              sendStatus('streaming', '正在生成候选提案')
            }
            safeSend(event.sender, teachingEventChannels.mindMapStreamChunk, {
              generationId,
              delta
            })
          }, (delta) => {
            // The provider's real reasoning stream is a first-class part of the
            // conversation. It is forwarded on the same reasoning channel the
            // homepage conversation uses, so the "Think" view shows the model's
            // actual step-by-step reasoning instead of a canned milestone.
            agentEvents.chunk('reasoning', delta)
          }, {
            // The agent loop's own activity: model-decided tool calls, their
            // results, loop phases, and the final no-tool answer.
            onToolCall: (toolCall) => agentEvents.tool(toolCall),
            onToolResult: (toolCall, result, isError) => agentEvents.tool(toolCall, result, isError),
            onAnswer: (delta) => agentEvents.chunk('answer', delta)
          })
          const { assistantMessage: generatedAssistantMessage, ...validatedProposal } = generatedProposal
          proposal = validatedProposal
          assistantMessage = generatedAssistantMessage
          sendStatus('validating', '正在校验生成结果')
          // The optional assistantMessage travels with the validated invoke
          // result below. Sending it over a separate event channel races the
          // IPC resolution and can either lose the learner-facing reply or
          // render it twice; the renderer adds it exactly once before applying
          // the proposal.
          agentEvents.terminal('done')
        } catch (error) {
          const step = error instanceof MindMapGenerationError && error.kind === 'cancelled'
            ? 'cancelled'
            : 'error'
          const message = errorMessage(error)
          sendStatus(step, message)
          agentEvents.terminal(mindMapAgentTerminalForError(error), message)
          throw mindMapGenerationIpcError(error)
        }

        // Read-only by construction: the proposal is returned with the exact
        // snapshot revision that must be supplied to the later CAS apply lane.
        return {
          documentId: current.id,
          revision: current.revision,
          request: built.request,
          proposal,
          ...(assistantMessage ? { assistantMessage } : {})
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.deleteMindMap,
      parser: (payload) => parseMindMapAccessPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'deleteMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        await getMindMapStore(root).remove(p.id)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.generateMindMap,
      parser: (payload) => parseMindMapGeneratePayload(payload),
      action: async (event, payload) => {
        const p = requireMindMapPayload(payload, 'generateMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const loadedSettings = await settings.load()
        let selectedFileContext
        let lessonContext
        let autoSourceContext: MindMapAutoSourceContext | undefined
        if (p.selectedFile) {
          try {
            selectedFileContext = await resolveSelectedMindMapFile(root, p.selectedFile.workspacePath)
          } catch (error) {
            throw mindMapSelectedFileIpcError(error)
          }
        } else if (p.lesson) {
          try {
            lessonContext = await resolveMindMapLesson(root, p.lesson.workspacePath)
          } catch (error) {
            throw mindMapLessonIpcError(error)
          }
        } else {
          autoSourceContext = await resolveMindMapAutoSourceContext(root, p.prompt)
        }
        const generationId = p.generationId ?? randomUUID()
        const agentEvents = createMindMapAgentEventSender(event.sender, generationId)
        const sendStatus = (
          step: MindMapStreamStep,
          message?: string
        ): void => {
          safeSend(event.sender, teachingEventChannels.mindMapStreamStatus, {
            generationId,
            step,
            ...(message ? { message } : {})
          })
        }
        let streamStarted = false
        sendStatus('calling', '正在准备思维导图生成')
        let generated: MindMapDocument
        try {
          generated = await generateMindMap({
            title: p.title,
            prompt: p.prompt,
            settings: loadedSettings,
            history: p.history,
            selectedFileContext,
            autoSourceContext,
            lessonContext,
            ...(p.imageAttachments?.length ? { imageAttachments: p.imageAttachments } : {}),
            generationId,
            workspaceRoot: root
          }, (delta) => {
            if (!streamStarted) {
              streamStarted = true
              sendStatus('streaming', '正在生成导图内容')
            }
            safeSend(event.sender, teachingEventChannels.mindMapStreamChunk, {
              generationId,
              delta
            })
          }, (delta) => {
            // The provider's real reasoning stream is forwarded on the same
            // reasoning channel as the homepage conversation so the "Think"
            // view shows actual step-by-step reasoning, not a canned status.
            agentEvents.chunk('reasoning', delta)
          }, {
            onToolCall: (toolCall) => agentEvents.tool(toolCall),
            onToolResult: (toolCall, result, isError) => agentEvents.tool(toolCall, result, isError),
            onAnswer: (delta) => agentEvents.chunk('answer', delta)
          })
          sendStatus('validating', '正在校验生成结果')
        } catch (error) {
          const step = error instanceof MindMapGenerationError && error.kind === 'cancelled'
            ? 'cancelled'
            : 'error'
          const message = errorMessage(error)
          sendStatus(step, message)
          agentEvents.terminal(mindMapAgentTerminalForError(error), message)
          throw mindMapGenerationIpcError(error)
        }
        sendStatus('rendering', '正在保存已校验的导图')
        let writeToolCall: { id: string; name: string; arguments: string } | null = null
        let writeToolSettled = false
        try {
          const migrated = migrateV1ToV2(generated)
          if (!migrated.ok) {
            throw new Error(`Mind map generation output failed migration: ${migrated.error.message}`)
          }
          // Persist the generated sheets behind a canonical document created by the
          // store (authoritative id + timestamps), then return the persisted doc.
          const store = getMindMapStore(root)
          const created = await store.create(p.title)
          const targetPath = `mindmaps/${created.id}.json`
          writeToolCall = {
            id: `${generationId}:write:${created.id}`,
            name: 'write_workspace_file',
            arguments: JSON.stringify({ path: targetPath })
          }
          agentEvents.tool(writeToolCall)
          const result = await store.update(
            created.id,
            { ...migrated.value, id: created.id, createdAt: created.createdAt, updatedAt: created.updatedAt },
            created.revision
          )
          const persisted = unwrapMindMapUpdate(result, 'generateMindMap')
          agentEvents.tool(
            writeToolCall,
            JSON.stringify({ ok: true, path: targetPath, revision: persisted.revision }),
            false
          )
          writeToolSettled = true
          agentEvents.chunk('answer', `已生成思维导图：新增 ${countMindMapTopics(persisted)} 个主题。`)
          sendStatus('done')
          agentEvents.terminal('done')
          return persisted
        } catch (error) {
          // Keep renderer lifecycle state correlated even when migration or the
          // canonical persistence boundary fails after provider settlement.
          const message = errorMessage(error)
          if (writeToolCall && !writeToolSettled) {
            agentEvents.tool(writeToolCall, JSON.stringify({ ok: false }), true)
          }
          sendStatus('error', message)
          agentEvents.terminal('error', message)
          throw mindMapGenerationIpcError(error)
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.cancelMindMapGeneration,
      parser: (payload) => parseMindMapCancelGenerationPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'cancelMindMapGeneration')
        // Resolve the registered workspace before touching the process-owned
        // generation registry. Cancellation is an IPC capability, not a
        // renderer-only loading-state change.
        await resolveMindMapWorkspaceRoot(p.workspaceId)
        return { canceled: cancelMindMapGeneration(p.generationId) }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
  ]
}

/**
 * Mind-map generation is not a teaching conversation and therefore must not
 * enter AgentEventBus persistence or settlement. It still publishes the same
 * safe realtime event model on its own IPC channel so embedded and homepage
 * conversation surfaces share one renderer projection without cross-buffering.
 */
function createMindMapAgentEventSender(
  sender: WebContents,
  generationId: string
): {
    status: (status: AgentChatStreamStatus['status'], message?: string) => void
    chunk: (channel: 'reasoning' | 'answer', delta: string) => void
    tool: (
      toolCall: { id: string; name: string; arguments: string },
      result?: string,
      isError?: boolean
    ) => void
    terminal: (outcome: AgentStreamTerminalStatus, message?: string) => void
  } {
  let sequence = 0
  const publish = (event: AgentRealtimeEvent): void => {
    safeSend(sender, teachingEventChannels.mindMapAgentEvent, event)
  }
  const nextEnvelope = (): Pick<AgentRealtimeEvent, 'sequence' | 'streamId' | 'createdAt'> => ({
    sequence: ++sequence,
    streamId: generationId,
    createdAt: new Date().toISOString()
  })
  return {
    status: (status, message) => publish({
      ...nextEnvelope(),
      kind: 'status',
      payload: {
        streamId: generationId,
        status,
        ...(message ? { message } : {})
      }
    }),
    chunk: (channel, delta) => {
      if (!delta) return
      publish({
        ...nextEnvelope(),
        kind: 'chunk',
        payload: { streamId: generationId, channel, delta }
      })
    },
    tool: (toolCall, result, isError) => publish({
      ...nextEnvelope(),
      kind: 'tool',
      payload: {
        streamId: generationId,
        toolCall,
        ...(result !== undefined ? { result, isError } : {})
      }
    }),
    terminal: (outcome, message) => publish({
      ...nextEnvelope(),
      kind: 'terminal',
      outcome,
      ...(message ? { message } : {})
    })
  }
}

/** Count all topics beneath the roots without exposing the document payload. */
function countMindMapTopics(document: { sheets: readonly { root: unknown }[] }): number {
  const count = (node: unknown): number => {
    if (!node || typeof node !== 'object') return 0
    const children = (node as { children?: unknown }).children
    if (!Array.isArray(children)) return 0
    return children.reduce((total, child) => total + 1 + count(child), 0)
  }
  return document.sheets.reduce((total, sheet) => total + count(sheet.root), 0)
}

function mindMapAgentTerminalForError(error: unknown): AgentStreamTerminalStatus {
  if (!(error instanceof MindMapGenerationError)) return 'error'
  if (error.kind === 'cancelled') return 'canceled'
  if (error.kind === 'resource_limit') return 'resource_limit'
  if (error.kind === 'suspended') return 'suspended'
  return 'error'
}

function mindMapImageMimeType(asset: MindMapAssetRef): string | null {
  const explicit = asset.mimeType?.split(';', 1)[0]?.trim().toLowerCase()
  if (explicit?.startsWith('image/')) return explicit
  const extension = extname(asset.fileName).toLowerCase()
  return {
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp'
  }[extension] ?? null
}

function isMindMapImageAsset(asset: MindMapAssetRef): boolean {
  return mindMapImageMimeType(asset) !== null
}
