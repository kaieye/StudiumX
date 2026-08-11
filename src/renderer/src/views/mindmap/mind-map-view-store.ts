import { create } from 'zustand'
import type {
  MindMapCommand,
  MindMapClipboardPayload,
  MindMapExecuteOptions,
  MindMapTopicUpdatePatch
} from '../../../../shared/mindmap/commands'
import { MindMapUndoRedoStack } from '../../../../shared/mindmap/commands/mind-map-undo-redo'
import type {
  MindMapDocumentV2,
  MindMapSheetV2
} from '../../../../shared/mindmap/domain/types'
import type { MindMapSummary } from '../../../../shared/mindmap/mind-map-types'
import type { MindMapMarkdownExportSnapshot } from '../../../../shared/teaching-types/mindmap'
import { useAppStore } from '../../app-shell/appStore'
import {
  buildCollapseAllCommand,
  buildCopyPayload,
  buildCopySheetCommand,
  buildCutPayload,
  buildDuplicateCommand,
  buildExpandAllCommand,
  buildInsertAboveCommand,
  buildInsertChildCommand,
  buildInsertSiblingCommand,
  buildOutdentCommand,
  buildPasteCommandForPayload,
  buildRemoveCommand,
  buildToggleCollapseCommand,
  findTopicInSheet
} from './mind-map-commands'

/**
 * Renderer state for the mind-map view (docs/mindmap/design.md §6.6).
 *
 * Holds the workspace document list, the currently-open v2 document, selection,
 * editing and AI generation state. Mutations to the active editor document go
 * through the shared `MindMapUndoRedoStack` (which funnels into the pure
 * command reducer), then a debounced revisioned save. Gallery-only document
 * actions instead read and CAS-update their target file directly.
 */

type MindMapViewState = {
  documents: MindMapSummary[]
  current: MindMapDocumentV2 | null
  selectedNodeId: string | null
  activeSheetId: string | null
  editingNodeId: string | null
  generating: boolean
  streamText: string
  error: string | null
  aiPrompt: string
  /** P2 §5.2: right-inspector visibility, persisted to localStorage. */
  inspectorOpen: boolean
  /** Toggle the right inspector panel (bound to header button + ⌘.). */
  toggleInspector: () => void
  /** P2 §5.2: active inspector tab, persisted to localStorage. */
  inspectorTab: 'style' | 'canvas' | 'ai'
  /** Switch the active inspector tab (persisted). */
  setInspectorTab: (tab: 'style' | 'canvas' | 'ai') => void

  loadDocuments: () => Promise<void>
  openDocument: (id: string) => Promise<void>
  /** Flush pending local writes and return to the document gallery. */
  closeDocument: () => Promise<void>
  createDocument: (title: string) => Promise<void>
  deleteDocument: (id: string) => Promise<void>
  /** Rename a gallery document without opening it in the editor. */
  renameDocumentById: (id: string, title: string) => Promise<void>
  /** Create a separate, persisted copy of a gallery document. */
  duplicateDocument: (id: string, title: string) => Promise<void>

  dispatchCommand: (command: MindMapCommand, options?: MindMapExecuteOptions) => void
  undo: () => void
  redo: () => void

  renameDocument: (title: string) => void
  newSheet: () => void
  renameSheet: (sheetId: string, title: string) => void
  duplicateSheet: (sheetId: string) => void
  removeSheet: (sheetId: string) => void
  reorderSheet: (sheetId: string, toIndex: number) => void

  addChild: (parentId: string) => void
  addSibling: (nodeId: string) => void
  outdent: (nodeId: string) => void
  insertAbove: (nodeId: string) => void
  deleteNode: (nodeId: string) => void
  toggleCollapse: (nodeId: string) => void
  updateNode: (nodeId: string, patch: MindMapTopicUpdatePatch) => void
  collapseAll: () => void
  expandAll: () => void

  copyNode: (nodeId: string) => void
  cutNode: (nodeId: string) => void
  pasteNode: (parentId: string) => void
  duplicateNode: (nodeId: string) => void

  setEditingNodeId: (id: string | null) => void
  setAiPrompt: (prompt: string) => void
  /** Adopt a document already committed by the main-process canonical lane. */
  adoptCommittedDocument: (
    document: MindMapDocumentV2,
    options?: { inverse?: MindMapCommand | null; label?: string }
  ) => void
  /** Drain local persistence and return a fail-closed export proof. */
  flushForExport: () => Promise<MindMapMarkdownExportSnapshot | null>
  generate: (prompt: string) => Promise<void>
}

function workspaceId(): string | null {
  return useAppStore.getState().appState?.activeWorkspace?.id ?? null
}

function activeSheetOf(state: Pick<MindMapViewState, 'current' | 'activeSheetId'>): MindMapSheetV2 | undefined {
  const doc = state.current
  if (!doc) return undefined
  return doc.sheets.find((sheet) => sheet.id === state.activeSheetId) ?? doc.sheets[0]
}

/**
 * Resolve a user-selected topic only in the active sheet. Topic IDs are
 * unique within a sheet, not globally across a document, so searching every
 * sheet can silently mutate a different sheet when IDs collide.
 */
function activeSheetContainingTopic(
  state: Pick<MindMapViewState, 'current' | 'activeSheetId'>,
  topicId: string
): MindMapSheetV2 | undefined {
  const sheet = activeSheetOf(state)
  return sheet !== undefined && findTopicInSheet(sheet, topicId) !== undefined ? sheet : undefined
}

export const useMindMapViewStore = create<MindMapViewState>((set, get) => {
  let undoStack: MindMapUndoRedoStack | null = null
  let clipboard: MindMapClipboardPayload | null = null
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let persistInFlight: Promise<boolean> | null = null
  let mutationEpoch = 0
  let dirty = false

  const clearPendingPersist = (): void => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
  }

  const persistNow = async (): Promise<boolean> => {
    const state = get()
    const current = state.current
    const workspace = workspaceId()
    if (!current || !workspace) return false
    const expectedRevision = current.revision
    const epochAtSend = mutationEpoch
    const result = await window.teachingSystem?.updateMindMap({
      workspaceId: workspace,
      id: current.id,
      expectedRevision,
      doc: current
    })
    if (!result) return false
    if (!result.ok) {
      set({
        error:
          `Mind map update conflict: expected revision ${result.expectedRevision}, ` +
          `current is ${result.currentRevision}. Reload or save a copy.`
      })
      return false
    }
    const saved = result.document
    const latest = get().current
    if (!latest) return false
    if (epochAtSend === mutationEpoch) {
      // No edits since the save was sent; adopt the confirmed document.
      if (undoStack) undoStack.replacePresent(saved)
      set({ current: saved, error: null })
      dirty = false
    } else {
      // New edits happened after the save was sent; keep the latest content but
      // carry the confirmed revision forward so the next CAS matches the repo.
      const merged = { ...latest, revision: saved.revision, updatedAt: saved.updatedAt }
      if (undoStack) undoStack.replacePresent(merged)
      set({ current: merged, error: null })
      dirty = true
    }
    await refreshDocuments()
    return true
  }

  const runPersist = (): Promise<boolean> => {
    if (persistInFlight) return persistInFlight
    const task = persistNow()
    persistInFlight = task
    void task.then(
      () => {
        if (persistInFlight === task) persistInFlight = null
      },
      () => {
        if (persistInFlight === task) persistInFlight = null
      }
    )
    return task
  }

  const schedulePersist = (): void => {
    if (persistTimer) clearTimeout(persistTimer)
    dirty = true
    persistTimer = setTimeout(() => {
      persistTimer = null
      void runPersist()
    }, 400)
  }

  const flushForExport = async (): Promise<MindMapMarkdownExportSnapshot | null> => {
    const before = get().current
    const workspace = workspaceId()
    if (!before || !workspace) return null

    // Cancel the debounce and synchronously drain the renderer's own save
    // lane.  The main-process flush below cannot observe this private timer.
    clearPendingPersist()
    if (dirty || persistInFlight) await runPersist()

    const after = get().current
    if (!after || after.id !== before.id) return null

    // Reuse the existing flush IPC as the final main-process boundary.  The
    // Markdown handler still reads a fresh snapshot and rechecks every field.
    await window.teachingSystem?.flushMindMap({ workspaceId: workspace, id: after.id })

    const final = get().current
    if (!final || final.id !== after.id) return null
    return {
      id: final.id,
      snapshotRevision: final.revision,
      expectedRevision: final.revision,
      pendingWrites: persistTimer !== null || persistInFlight !== null,
      dirty
    }
  }

  const refreshDocuments = async (): Promise<void> => {
    const workspace = workspaceId()
    if (!workspace) return
    const documents = await window.teachingSystem?.listMindMaps({ workspaceId: workspace })
    if (documents) set({ documents })
  }

  const dispatchCommand = (
    command: MindMapCommand,
    options?: MindMapExecuteOptions
  ): void => {
    const stack = undoStack
    if (!stack) return
    const result = stack.execute(command, options)
    if (!result.ok) {
      set({ error: `${result.error.code}: ${result.error.message}` })
      return
    }
    mutationEpoch += 1
    set({ current: stack.document, error: null })
    schedulePersist()
  }

  const undo = (): void => {
    const stack = undoStack
    if (!stack) return
    const result = stack.undo()
    if (result === null) return
    if (!result.ok) {
      set({ error: `${result.error.code}: ${result.error.message}` })
      return
    }
    mutationEpoch += 1
    set({ current: stack.document, error: null })
    schedulePersist()
  }

  const redo = (): void => {
    const stack = undoStack
    if (!stack) return
    const result = stack.redo()
    if (result === null) return
    if (!result.ok) {
      set({ error: `${result.error.code}: ${result.error.message}` })
      return
    }
    mutationEpoch += 1
    set({ current: stack.document, error: null })
    schedulePersist()
  }

  return {
    documents: [],
    current: null,
    selectedNodeId: null,
    activeSheetId: null,
    editingNodeId: null,
    generating: false,
    streamText: '',
    error: null,
    aiPrompt: '',
    inspectorOpen: (() => {
      try {
        return localStorage.getItem('mindmap.inspectorOpen') !== 'false'
      } catch {
        return true
      }
    })(),
    inspectorTab: (() => {
      try {
        const tab = localStorage.getItem('mindmap.inspectorTab')
        if (tab === 'style' || tab === 'canvas' || tab === 'ai') return tab
      } catch {
        // localStorage may be unavailable
      }
      return 'style'
    })(),

    loadDocuments: async () => {
      const workspace = workspaceId()
      if (!workspace) {
        set({ documents: [], current: null })
        return
      }
      try {
        const documents = await window.teachingSystem?.listMindMaps({ workspaceId: workspace })
        if (documents) set({ documents })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    openDocument: async (id) => {
      const workspace = workspaceId()
      if (!workspace) return
      try {
        const current = await window.teachingSystem?.readMindMap({ workspaceId: workspace, id })
        if (current) {
          clearPendingPersist()
          dirty = false
          undoStack = new MindMapUndoRedoStack(current)
          mutationEpoch += 1
          set({
            current,
            selectedNodeId: current.sheets[0]?.root.id ?? null,
            activeSheetId: current.sheets[0]?.id ?? null,
            editingNodeId: null,
            error: null
          })
        }
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    closeDocument: async () => {
      if (!get().current) return

      // Returning to the gallery must not discard the 400ms local save lane.
      // Drain it before clearing editor state so file-backed mind-map state
      // remains the source of truth even when the user leaves immediately.
      clearPendingPersist()
      if (dirty || persistInFlight) await runPersist()

      undoStack = null
      clipboard = null
      set({
        current: null,
        selectedNodeId: null,
        activeSheetId: null,
        editingNodeId: null,
        error: null
      })
    },

    createDocument: async (title) => {
      const workspace = workspaceId()
      if (!workspace) return
      try {
        const current = await window.teachingSystem?.createMindMap({ workspaceId: workspace, title })
        if (current) {
          clearPendingPersist()
          dirty = false
          undoStack = new MindMapUndoRedoStack(current)
          mutationEpoch += 1
          set({
            current,
            selectedNodeId: current.sheets[0]?.root.id ?? null,
            activeSheetId: current.sheets[0]?.id ?? null,
            editingNodeId: null,
            error: null
          })
          await refreshDocuments()
        }
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    deleteDocument: async (id) => {
      const workspace = workspaceId()
      if (!workspace) return
      try {
        await window.teachingSystem?.deleteMindMap({ workspaceId: workspace, id })
        clearPendingPersist()
        if (get().current?.id === id) dirty = false
        if (get().current?.id === id) undoStack = null
        set((state) => ({
          documents: state.documents.filter((doc) => doc.id !== id),
          ...(state.current?.id === id
            ? { current: null, selectedNodeId: null, activeSheetId: null, editingNodeId: null }
            : {})
        }))
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    renameDocumentById: async (id, title) => {
      const workspace = workspaceId()
      const nextTitle = title.trim()
      if (!workspace || !nextTitle) return

      // The editor title still needs an undoable command. Gallery actions only
      // target closed documents, but keep this guard to preserve that invariant
      // if the method is reused elsewhere.
      if (get().current?.id === id) {
        dispatchCommand({ type: 'document.rename', title: nextTitle })
        return
      }

      try {
        const document = await window.teachingSystem?.readMindMap({ workspaceId: workspace, id })
        if (!document) return
        const result = await window.teachingSystem?.updateMindMap({
          workspaceId: workspace,
          id,
          expectedRevision: document.revision,
          doc: { ...document, title: nextTitle }
        })
        if (!result) return
        if (!result.ok) {
          set({
            error:
              `Mind map rename conflict: expected revision ${result.expectedRevision}, ` +
              `current is ${result.currentRevision}.`
          })
          return
        }
        set({ error: null })
        await refreshDocuments()
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    duplicateDocument: async (id, title) => {
      const workspace = workspaceId()
      const copyTitle = title.trim()
      if (!workspace || !copyTitle) return

      try {
        const source = await window.teachingSystem?.readMindMap({ workspaceId: workspace, id })
        if (!source) return

        // Create first so the copy receives a canonical document id and its
        // initial revision from the main-process store. Then CAS-write the
        // source content onto that fresh file, preserving every sheet, topic,
        // element, theme, asset reference, and interop field.
        const created = await window.teachingSystem?.createMindMap({
          workspaceId: workspace,
          title: copyTitle
        })
        if (!created) return
        const result = await window.teachingSystem?.updateMindMap({
          workspaceId: workspace,
          id: created.id,
          expectedRevision: created.revision,
          doc: {
            ...source,
            id: created.id,
            revision: created.revision,
            title: copyTitle,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt
          }
        })
        if (!result) return
        if (!result.ok) {
          set({
            error:
              `Mind map copy conflict: expected revision ${result.expectedRevision}, ` +
              `current is ${result.currentRevision}.`
          })
          return
        }
        set({ error: null })
        await refreshDocuments()
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    dispatchCommand,

    undo,
    redo,

    renameDocument: (title) => {
      dispatchCommand({ type: 'document.rename', title })
    },

    newSheet: () => {
      const current = get().current
      if (!current) return
      const sheetId = crypto.randomUUID()
      const title = `Sheet ${current.sheets.length + 1}`
      dispatchCommand({ type: 'sheet.create', sheetId, title })
      const updated = get().current
      const created = updated?.sheets.find((sheet) => sheet.id === sheetId)
      if (created) {
        set({ activeSheetId: sheetId, selectedNodeId: created.root.id, editingNodeId: created.root.id })
      }
    },

    renameSheet: (sheetId, title) => {
      dispatchCommand({ type: 'sheet.rename', sheetId, title })
    },

    duplicateSheet: (sheetId) => {
      const current = get().current
      if (!current) return
      const built = buildCopySheetCommand(current, sheetId)
      if (built) {
        dispatchCommand(built.command, { label: 'Duplicate sheet' })
        set({ activeSheetId: built.newSheetId })
        const updated = get().current
        const created = updated?.sheets.find((sheet) => sheet.id === built.newSheetId)
        if (created) set({ selectedNodeId: created.root.id })
      }
    },

    removeSheet: (sheetId) => {
      const current = get().current
      if (!current) return
      if (current.sheets.length <= 1) {
        set({ error: 'Cannot remove the last sheet.' })
        return
      }
      const index = current.sheets.findIndex((sheet) => sheet.id === sheetId)
      dispatchCommand({ type: 'sheet.remove', sheetId })
      const updated = get().current
      if (!updated) return
      let nextId = get().activeSheetId
      if (nextId === sheetId) {
        const next = updated.sheets[Math.min(index, updated.sheets.length - 1)] ?? updated.sheets[0]
        nextId = next?.id ?? null
      }
      set({ activeSheetId: nextId, selectedNodeId: null })
    },

    reorderSheet: (sheetId, toIndex) => {
      dispatchCommand({ type: 'sheet.reorder', sheetId, toIndex })
    },

    addChild: (parentId) => {
      const sheet = activeSheetContainingTopic(get(), parentId)
      if (!sheet) return
      const built = buildInsertChildCommand(sheet.id, parentId)
      dispatchCommand(built.command, { label: 'Insert child' })
      set({ selectedNodeId: built.nodeId, editingNodeId: built.nodeId })
    },

    addSibling: (nodeId) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!sheet) return
      const built = buildInsertSiblingCommand(sheet, nodeId)
      if (built) {
        dispatchCommand(built.command, { label: 'Insert sibling' })
        set({ selectedNodeId: built.nodeId, editingNodeId: built.nodeId })
      }
    },

    outdent: (nodeId) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!sheet) return
      const command = buildOutdentCommand(sheet, nodeId)
      if (command) dispatchCommand(command, { label: 'Outdent' })
    },

    insertAbove: (nodeId) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!sheet) return
      const built = buildInsertAboveCommand(sheet, nodeId)
      if (built) {
        dispatchCommand(built.command, { label: 'Insert above' })
        set({ selectedNodeId: built.nodeId, editingNodeId: built.nodeId })
      }
    },

    deleteNode: (nodeId) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!sheet) return
      const command = buildRemoveCommand(sheet, nodeId)
      if (command) {
        dispatchCommand(command, { label: 'Delete topic' })
        set({ selectedNodeId: null })
      }
    },

    toggleCollapse: (nodeId) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!sheet) return
      const ref = findTopicInSheet(sheet, nodeId)
      if (!ref) return
      const collapsed = !(ref.node.collapsed === true)
      dispatchCommand(buildToggleCollapseCommand(sheet.id, nodeId, collapsed), {
        label: 'Toggle collapse'
      })
    },

    updateNode: (nodeId, patch) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!sheet) return
      dispatchCommand(
        { type: 'topic.update', sheetId: sheet.id, topicId: nodeId, patch },
        { label: 'Update topic' }
      )
    },

    collapseAll: () => {
      const sheet = activeSheetOf(get())
      if (!sheet) return
      dispatchCommand(buildCollapseAllCommand(sheet.id, sheet.root), { label: 'Collapse all' })
    },

    expandAll: () => {
      const sheet = activeSheetOf(get())
      if (!sheet) return
      dispatchCommand(buildExpandAllCommand(sheet.id, sheet.root), { label: 'Expand all' })
    },

    copyNode: (nodeId) => {
      const current = get().current
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!current || !sheet) return
      const payload = buildCopyPayload(current, sheet.id, nodeId)
      if (payload) clipboard = payload
    },

    cutNode: (nodeId) => {
      const current = get().current
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!current || !sheet) return
      const payload = buildCutPayload(current, sheet.id, nodeId)
      if (payload) {
        clipboard = payload
        const command = buildRemoveCommand(sheet, nodeId)
        if (command) {
          dispatchCommand(command, { label: 'Cut topic' })
          set({ selectedNodeId: null })
        }
      }
    },

    pasteNode: (parentId) => {
      const current = get().current
      const sheet = activeSheetContainingTopic(get(), parentId)
      if (!current || !sheet || !clipboard || clipboard.kind === 'paste') return
      const built = buildPasteCommandForPayload(
        {
          kind: 'paste',
          data: clipboard.data,
          targetSheetId: sheet.id,
          targetParentId: parentId
        },
        sheet.id,
        parentId
      )
      dispatchCommand(built.command, { label: 'Paste topic' })
      if (built.pastedRootId) set({ selectedNodeId: built.pastedRootId })
    },

    duplicateNode: (nodeId) => {
      const current = get().current
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!current || !sheet) return
      const built = buildDuplicateCommand(current, sheet.id, nodeId)
      if (built) {
        dispatchCommand(built.command, { label: 'Duplicate topic' })
        set({ selectedNodeId: built.pastedRootId })
      }
    },

    setEditingNodeId: (editingNodeId) => set({ editingNodeId }),

    setAiPrompt: (aiPrompt) => set({ aiPrompt }),
    toggleInspector: () => {
      set((state) => {
        const next = !state.inspectorOpen
        try {
          localStorage.setItem('mindmap.inspectorOpen', String(next))
        } catch {
          // localStorage may be unavailable; in-memory state still toggles.
        }
        return { inspectorOpen: next }
      })
    },
    setInspectorTab: (inspectorTab) => {
      try {
        localStorage.setItem('mindmap.inspectorTab', inspectorTab)
      } catch {
        // localStorage may be unavailable; in-memory state still updates.
      }
      set({ inspectorTab })
    },

    adoptCommittedDocument: (document, options = {}) => {
      const state = get()
      const current = state.current
      if (current !== null && current.id !== document.id) return

      clearPendingPersist()
      dirty = false
      mutationEpoch += 1

      if (undoStack === null) {
        undoStack = new MindMapUndoRedoStack(document)
      } else {
        undoStack.commitExternal(
          document,
          options.inverse ?? null,
          options.label ?? 'Apply AI proposal'
        )
      }

      const activeSheetId =
        state.activeSheetId && document.sheets.some((sheet) => sheet.id === state.activeSheetId)
          ? state.activeSheetId
          : document.sheets[0]?.id ?? null
      const activeSheet = document.sheets.find((sheet) => sheet.id === activeSheetId)
      const selectedNodeId =
        state.selectedNodeId && activeSheet && findTopicInSheet(activeSheet, state.selectedNodeId)
          ? state.selectedNodeId
          : activeSheet?.root.id ?? null

      set({
        current: document,
        selectedNodeId,
        activeSheetId,
        editingNodeId: null,
        error: null
      })
      void refreshDocuments()
    },

    flushForExport,

    generate: async (prompt) => {
      const workspace = workspaceId()
      if (!workspace || get().generating) return
      set({ generating: true, streamText: prompt, error: null })
      try {
        const current = await window.teachingSystem?.generateMindMap({
          workspaceId: workspace,
          title: prompt.slice(0, 40) || 'AI 导图',
          prompt
        })
        if (current) {
          clearPendingPersist()
          dirty = false
          undoStack = new MindMapUndoRedoStack(current)
          mutationEpoch += 1
          set({
            current,
            selectedNodeId: current.sheets[0]?.root.id ?? null,
            activeSheetId: current.sheets[0]?.id ?? null,
            editingNodeId: null,
            streamText: '',
            aiPrompt: ''
          })
          await refreshDocuments()
        }
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      } finally {
        set({ generating: false })
      }
    }
  }
})
