import { create } from 'zustand'
import type {
  MindMapCommand,
  MindMapClipboardPayload,
  MindMapExecuteOptions,
  MindMapImageUpdatePatch,
  MindMapTopicUpdatePatch
} from '../../../../shared/mindmap/commands'
import { MindMapUndoRedoStack } from '../../../../shared/mindmap/commands/mind-map-undo-redo'
import type {
  MindMapDocumentV2,
  MindMapElementType,
  MindMapImageElement,
  MindMapPoint,
  MindMapSheetV2
} from '../../../../shared/mindmap/domain/types'
import type { MindMapStructureClass, MindMapSummary } from '../../../../shared/mindmap/mind-map-types'
import {
  HOME_MIND_MAP_WORKSPACE_ID,
  type MindMapLibrary,
  type MindMapMarkdownExportSnapshot
} from '../../../../shared/teaching-types/mindmap'
import { useAppStore } from '../../app-shell/appStore'
import {
  buildApplyQuickStyleCommand,
  buildCollapseLastLevelCommand,
  buildCopyPayload,
  buildCopySheetCommand,
  buildCutPayload,
  buildDuplicateCommand,
  buildExpandNextLevelCommand,
  buildInsertAboveCommand,
  buildInsertChildCommand,
  buildInsertSiblingCommand,
  buildOutdentCommand,
  buildPasteCommandForPayload,
  buildAddSummaryCommand,
  buildRemoveCommand,
  buildRemoveTopicsCommand,
  buildSetSiblingTopicsCollapsedCommand,
  buildSetTopicChildrenCollapsedCommand,
  buildToggleCollapseCommand,
  buildToggleCollapseTopicsCommand,
  findTopicInSheet
} from './mind-map-commands'
import type { MindMapQuickStylePreset } from '../../../../shared/mindmap/quick-styles'
import {
  addUserColorScheme,
  deleteUserColorScheme,
  duplicateUserColorScheme,
  loadColorSchemeCatalog,
  persistColorSchemeCatalog,
  recordRecentColorScheme,
  renameUserColorScheme,
  setUserColorSchemeColors,
  toggleColorSchemeFavorite,
  type ColorSchemeCatalogState,
  type UserColorScheme
} from './mind-map-color-scheme-catalog'
import {
  buildPasteTopicStyleCommand,
  captureTopicStyleClipboard,
  type MindMapTopicStyleClipboard
} from './mind-map-topic-style-clipboard'
import { migrateTopicAssetsToImages } from '../../../../shared/mindmap/migrations'

/**
 * Renderer state for the mind-map view (docs/mindmap/design.md §6.6).
 *
 * Holds the workspace document list, the currently-open v2 document, selection,
 * editing and AI generation state. Mutations to the active editor document go
 * through the shared `MindMapUndoRedoStack` (which funnels into the pure
 * command reducer), then a debounced revisioned save. Gallery-only document
 * actions instead read and CAS-update their target file directly.
 */

export type MindMapSelection =
  | { kind: 'topic'; topicIds: string[] }
  | { kind: 'element'; elementId: string; elementType: MindMapElementType }
  | { kind: 'image'; imageId: string }
  | { kind: 'canvas' }

/**
 * Browse scope for the mind-map library. `'home'` addresses the global
 * `MindMaps/` location; a string is a registered workspace id; `null` falls
 * back to the active teaching workspace (backward compatible).
 */
export type MindMapScope = 'home' | string | null

type MindMapViewState = {
  documents: MindMapSummary[]
  /** Aggregate home-page library: home cards + one folder per workspace. */
  library: MindMapLibrary | null
  /** Current browse scope (home vs a workspace folder). */
  scope: MindMapScope
  current: MindMapDocumentV2 | null
  /** Canonical editor selection across topics, non-topic elements, and the canvas. */
  selection: MindMapSelection
  /** Compatibility projection for existing topic-only commands and panels. */
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

  /**
   * User color-scheme catalogue (custom schemes + favorites + recent).
   * Pure user preference state persisted to localStorage; never teaching
   * authority and never auto-applied.
   */
  colorSchemes: ColorSchemeCatalogState
  createColorScheme: (name: string, colors: readonly string[]) => UserColorScheme
  renameColorScheme: (id: string, name: string) => void
  updateColorSchemeColors: (id: string, colors: readonly string[]) => UserColorScheme | null
  duplicateColorScheme: (id: string) => UserColorScheme | null
  deleteColorScheme: (id: string) => void
  toggleColorSchemeFavorite: (id: string) => void
  recordRecentColorScheme: (id: string) => void
  /** P2 §5.2: active inspector tab, persisted to localStorage. */
  inspectorTab: 'format' | 'content' | 'ai'
  /** Switch the active inspector tab (persisted). */
  setInspectorTab: (tab: 'format' | 'content' | 'ai') => void

  loadDocuments: () => Promise<void>
  /** Load the aggregate home-page library (home cards + workspace folders). */
  loadLibrary: () => Promise<void>
  /** Switch the browse scope (home vs a workspace folder) and reload its cards. */
  setScope: (scope: MindMapScope) => Promise<void>
  openDocument: (id: string) => Promise<void>
  /** Flush pending local writes and return to the document gallery. */
  closeDocument: () => Promise<void>
  /**
   * Create and open a persisted document. Rejects when the request cannot be
   * completed so the caller can keep its create surface open and show the
   * actionable error instead of silently returning to the gallery.
   */
  createDocument: (
    title: string,
    structureClass?: MindMapStructureClass
  ) => Promise<MindMapDocumentV2>
  deleteDocument: (id: string) => Promise<void>
  /** Rename a gallery document without opening it in the editor. */
  renameDocumentById: (id: string, title: string) => Promise<void>
  /** Create a separate, persisted copy of a gallery document. */
  duplicateDocument: (id: string, title: string) => Promise<void>

  dispatchCommand: (command: MindMapCommand, options?: MindMapExecuteOptions) => void
  selectTopic: (id: string, additive?: boolean) => void
  setTopicSelection: (topicIds: readonly string[], additive?: boolean) => void
  selectElement: (id: string, type: MindMapElementType) => void
  selectCanvas: () => void
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
  deleteNodes: (nodeIds: readonly string[]) => void
  /** Add a brace summary and its ordinary output topic over selected siblings. */
  addSummary: (topicIds: readonly string[], title?: string) => string | null
  toggleCollapse: (nodeId: string) => void
  toggleCollapseNodes: (nodeIds: readonly string[]) => void
  setTopicChildrenCollapsed: (nodeId: string, collapsed: boolean) => void
  setSiblingTopicsCollapsed: (nodeId: string, collapsed: boolean) => void
  updateNode: (nodeId: string, patch: MindMapTopicUpdatePatch) => void
  selectImage: (imageId: string) => void
  /** Create an image element (attached to `topicId` or free at `position`). */
  addImage: (assetId: string, opts?: { topicId?: string | null; position?: MindMapPoint }) => void
  updateImage: (imageId: string, patch: MindMapImageUpdatePatch) => void
  /** Move an image between topics or to a free position in one step. */
  moveImage: (imageId: string, opts: { topicId?: string | null; position?: MindMapPoint }) => void
  resizeImage: (imageId: string, width: number, height: number) => void
  removeImage: (imageId: string) => void
  collapseAll: () => void
  expandAll: () => void

  copyNode: (nodeId: string) => void
  cutNode: (nodeId: string) => void
  pasteNode: (parentId: string) => void
  duplicateNode: (nodeId: string) => void
  /** Ephemeral local clipboard; never persisted into the mind-map document. */
  copiedTopicStyle: MindMapTopicStyleClipboard | null
  copyTopicStyle: (nodeId: string) => void
  pasteTopicStyle: (topicIds: readonly string[]) => void
  resetTopicStyle: (topicIds: readonly string[]) => void
  /** Apply a visual-only quick style through the canonical command path. */
  applyQuickStyle: (topicIds: readonly string[], preset: MindMapQuickStylePreset) => void

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
  const scope = useMindMapViewStore.getState().scope
  if (scope === 'home') return HOME_MIND_MAP_WORKSPACE_ID
  if (scope) return scope
  return useAppStore.getState().appState?.activeWorkspace?.id ?? null
}

/**
 * Resolve the workspace that owns a document id. On the home page cards span
 * the home location and every workspace folder, so the owning workspace must
 * be looked up in the aggregate library rather than assumed to be the active
 * workspace.
 */
function workspaceIdForDocument(id: string): string | null {
  const state = useMindMapViewStore.getState()
  const scope = state.scope
  if (scope && scope !== 'home') return scope
  const library = state.library
  if (library) {
    if (library.home.some((doc) => doc.id === id)) return HOME_MIND_MAP_WORKSPACE_ID
    const owned = library.workspaces.find((entry) =>
      entry.documents.some((doc) => doc.id === id)
    )
    if (owned) return owned.workspaceId
  }
  if (scope === 'home') return HOME_MIND_MAP_WORKSPACE_ID
  return workspaceId()
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

/** Resolve an image only in the active sheet (image ids are sheet-scoped). */
function activeSheetContainingImage(
  state: Pick<MindMapViewState, 'current' | 'activeSheetId'>,
  imageId: string
): MindMapSheetV2 | undefined {
  const sheet = activeSheetOf(state)
  return sheet !== undefined && (sheet.images ?? []).some((image) => image.id === imageId)
    ? sheet
    : undefined
}

export const useMindMapViewStore = create<MindMapViewState>((set, get) => {
  let undoStack: MindMapUndoRedoStack | null = null
  let clipboard: MindMapClipboardPayload | null = null
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let persistInFlight: Promise<boolean> | null = null
  let mutationEpoch = 0
  let dirty = false

  const revealInspector = (
    tab: 'format' | 'content'
  ): Pick<MindMapViewState, 'inspectorOpen' | 'inspectorTab'> => {
    try {
      localStorage.setItem('mindmap.inspectorOpen', 'true')
      localStorage.setItem('mindmap.inspectorTab', tab)
    } catch {
      // localStorage may be unavailable; in-memory state still updates.
    }
    return { inspectorOpen: true, inspectorTab: tab }
  }

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
    // The home page shows the aggregate library; keep it fresh alongside the
    // current scope's cards.
    if (get().scope === 'home') {
      try {
        const library = await window.teachingSystem?.listMindMapLibrary()
        if (library) set({ library })
      } catch {
        // Best effort: the scope cards are already refreshed above.
      }
    }
  }

  /** Update the user colour-scheme catalogue and persist it to localStorage. */
  const setColorSchemes = (next: ColorSchemeCatalogState): void => {
    set({ colorSchemes: next })
    persistColorSchemeCatalog(next)
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
    library: null,
    scope: null,
    current: null,
    selection: { kind: 'canvas' },
    selectedNodeId: null,
    activeSheetId: null,
    editingNodeId: null,
    copiedTopicStyle: null,
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
        if (tab === 'format' || tab === 'content' || tab === 'ai') return tab
        if (tab === 'style' || tab === 'canvas') return 'format'
      } catch {
        // localStorage may be unavailable
      }
      return 'format'
    })(),
    colorSchemes: loadColorSchemeCatalog(),

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

    loadLibrary: async () => {
      try {
        const library = await window.teachingSystem?.listMindMapLibrary()
        if (library) set({ library })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    setScope: async (scope) => {
      set({ scope })
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
      const workspace = workspaceIdForDocument(id)
      if (!workspace) return
      try {
        const current = await window.teachingSystem?.readMindMap({ workspaceId: workspace, id })
        if (current) {
          clearPendingPersist()
          dirty = false
          const migrated = migrateTopicAssetsToImages(current)
          undoStack = new MindMapUndoRedoStack(migrated)
          mutationEpoch += 1
          // Anchor the editor to the owning workspace so persistence targets the
          // document's actual location (a workspace folder or the home location),
          // not whatever scope the gallery was browsing when the card was opened.
          set({
            scope: workspace === HOME_MIND_MAP_WORKSPACE_ID ? 'home' : workspace,
            current: migrated,
            selection: current.sheets[0]?.root.id
              ? { kind: 'topic', topicIds: [current.sheets[0].root.id] }
              : { kind: 'canvas' },
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
        selection: { kind: 'canvas' },
        selectedNodeId: null,
        activeSheetId: null,
        editingNodeId: null,
        error: null
      })
    },

    createDocument: async (title, structureClass) => {
      const workspace = workspaceId()
      if (!workspace) {
        const error = new Error('Mind map requires an active teaching workspace.')
        set({ error: error.message })
        throw error
      }

      const teachingSystem = window.teachingSystem
      if (!teachingSystem?.createMindMap) {
        const error = new Error('Mind map creation is unavailable. Restart the desktop app and try again.')
        set({ error: error.message })
        throw error
      }

      try {
        const current = await teachingSystem.createMindMap({
          workspaceId: workspace,
          title,
          ...(structureClass ? { structureClass } : {})
        })
        if (!current) throw new Error('Mind map creation returned no document.')

        clearPendingPersist()
        dirty = false
        undoStack = new MindMapUndoRedoStack(current)
        mutationEpoch += 1
        set((state) => ({
          current,
          selection: current.sheets[0]?.root.id
            ? { kind: 'topic', topicIds: [current.sheets[0].root.id] }
            : { kind: 'canvas' },
          selectedNodeId: current.sheets[0]?.root.id ?? null,
          activeSheetId: current.sheets[0]?.id ?? null,
          editingNodeId: null,
          documents: [
            {
              id: current.id,
              title: current.title,
              updatedAt: current.updatedAt,
              sheetCount: current.sheets.length
            },
            ...state.documents.filter((document) => document.id !== current.id)
          ],
          error: null
        }))

        // A list refresh is only for gallery freshness. The document is already
        // durably created, so a transient list failure must not turn a successful
        // creation into an apparent failure or eject the user from the editor.
        void refreshDocuments().catch(() => undefined)
        return current
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        set({ error: failure.message })
        throw failure
      }
    },

    deleteDocument: async (id) => {
      const workspace = workspaceIdForDocument(id)
      if (!workspace) return
      try {
        await window.teachingSystem?.deleteMindMap({ workspaceId: workspace, id })
        clearPendingPersist()
        if (get().current?.id === id) dirty = false
        if (get().current?.id === id) undoStack = null
        set((state) => {
          const library = state.library
            ? {
                ...state.library,
                home: state.library.home.filter((doc) => doc.id !== id),
                workspaces: state.library.workspaces.map((entry) => ({
                  ...entry,
                  documents: entry.documents.filter((doc) => doc.id !== id)
                }))
              }
            : null
          return {
            documents: state.documents.filter((doc) => doc.id !== id),
            ...(library ? { library } : {}),
            ...(state.current?.id === id
              ? { current: null, selection: { kind: 'canvas' }, selectedNodeId: null, activeSheetId: null, editingNodeId: null }
              : {})
          }
        })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    renameDocumentById: async (id, title) => {
      const workspace = workspaceIdForDocument(id)
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
      const workspace = workspaceIdForDocument(id)
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

    selectTopic: (id, additive = false) => {
      set((state) => {
        if (!additive || state.selection.kind !== 'topic') {
          return {
            selection: { kind: 'topic' as const, topicIds: [id] },
            selectedNodeId: id,
            editingNodeId: null,
            ...revealInspector('content')
          }
        }

        const existing = state.selection.topicIds
        const isSelected = existing.includes(id)
        const topicIds = isSelected && existing.length > 1
          ? existing.filter((topicId) => topicId !== id)
          : isSelected
            ? existing
            : [...existing, id]
        const selectedNodeId = isSelected
          ? (state.selectedNodeId === id ? topicIds.at(-1) ?? id : state.selectedNodeId)
          : id
        return {
          selection: { kind: 'topic', topicIds },
          selectedNodeId,
          editingNodeId: null,
          ...revealInspector('content')
        }
      })
    },


    setTopicSelection: (topicIds, additive = false) => {
      const ids = [...new Set(topicIds)]
      set((state) => {
        if (ids.length === 0 && !additive) {
          return {
            selection: { kind: 'canvas' as const },
            selectedNodeId: null,
            editingNodeId: null,
            ...revealInspector('format')
          }
        }
        const merged = additive && state.selection.kind === 'topic'
          ? [...new Set([...state.selection.topicIds, ...ids])]
          : ids
        if (merged.length === 0) {
          return {
            selection: { kind: 'canvas' as const },
            selectedNodeId: null,
            editingNodeId: null,
            ...revealInspector('format')
          }
        }
        const primary = merged.at(-1) ?? null
        return {
          selection: { kind: 'topic' as const, topicIds: merged },
          selectedNodeId: primary,
          editingNodeId: null,
          ...revealInspector('content')
        }
      })
    },

    selectElement: (id, type) => {
      set({
        selection: { kind: 'element', elementId: id, elementType: type },
        selectedNodeId: null,
        editingNodeId: null,
        ...revealInspector('content')
      })
    },

    selectCanvas: () => {
      set({
        selection: { kind: 'canvas' },
        selectedNodeId: null,
        editingNodeId: null,
        ...revealInspector('format')
      })
    },

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
        set({ activeSheetId: sheetId, selection: { kind: 'topic', topicIds: [created.root.id] }, selectedNodeId: created.root.id, editingNodeId: created.root.id })
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
        if (created) set({ selection: { kind: 'topic', topicIds: [created.root.id] }, selectedNodeId: created.root.id })
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
      set({ activeSheetId: nextId, selection: { kind: 'canvas' }, selectedNodeId: null })
    },

    reorderSheet: (sheetId, toIndex) => {
      dispatchCommand({ type: 'sheet.reorder', sheetId, toIndex })
    },

    addChild: (parentId) => {
      const sheet = activeSheetContainingTopic(get(), parentId)
      if (!sheet) return
      const built = buildInsertChildCommand(sheet, parentId)
      dispatchCommand(built.command, { label: 'Insert child' })
      set({ selection: { kind: 'topic', topicIds: [built.nodeId] }, selectedNodeId: built.nodeId, editingNodeId: built.nodeId })
    },

    addSibling: (nodeId) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!sheet) return
      const built = buildInsertSiblingCommand(sheet, nodeId)
      if (built) {
        dispatchCommand(built.command, { label: 'Insert sibling' })
        set({ selection: { kind: 'topic', topicIds: [built.nodeId] }, selectedNodeId: built.nodeId, editingNodeId: built.nodeId })
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
        set({ selection: { kind: 'topic', topicIds: [built.nodeId] }, selectedNodeId: built.nodeId, editingNodeId: built.nodeId })
      }
    },

    deleteNode: (nodeId) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!sheet) return
      const command = buildRemoveCommand(sheet, nodeId)
      if (command) {
        dispatchCommand(command, { label: 'Delete topic' })
        set({ selection: { kind: 'canvas' }, selectedNodeId: null })
      }
    },

    deleteNodes: (nodeIds) => {
      const firstId = nodeIds[0]
      const sheet = firstId ? activeSheetContainingTopic(get(), firstId) : undefined
      if (!sheet) return
      const command = buildRemoveTopicsCommand(sheet, nodeIds)
      if (command) {
        dispatchCommand(command, { label: nodeIds.length > 1 ? 'Delete selected topics' : 'Delete topic' })
        set({ selection: { kind: 'canvas' }, selectedNodeId: null })
      }
    },

    addSummary: (topicIds, title) => {
      const firstId = topicIds[0]
      const sheet = firstId ? activeSheetContainingTopic(get(), firstId) : undefined
      if (!sheet) return null
      const built = buildAddSummaryCommand(sheet, topicIds, title)
      if (!built) return null
      dispatchCommand(built.command, { label: 'Add node summary' })
      set({
        selection: { kind: 'topic', topicIds: [built.summaryTopicId] },
        selectedNodeId: built.summaryTopicId
      })
      return built.summaryId
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

    toggleCollapseNodes: (nodeIds) => {
      const firstId = nodeIds[0]
      const sheet = firstId ? activeSheetContainingTopic(get(), firstId) : undefined
      if (!sheet) return
      const refs = [...new Set(nodeIds)]
        .map((id) => findTopicInSheet(sheet, id)?.node)
        .filter((topic): topic is NonNullable<typeof topic> => topic !== undefined)
      if (refs.length === 0) return
      const collapsed = refs.some((topic) => topic.collapsed !== true)
      const command = buildToggleCollapseTopicsCommand(sheet, refs.map((topic) => topic.id), collapsed)
      if (command) dispatchCommand(command, { label: refs.length > 1 ? 'Toggle selected topics' : 'Toggle collapse' })
    },

    setTopicChildrenCollapsed: (nodeId, collapsed) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!sheet) return
      const command = buildSetTopicChildrenCollapsedCommand(sheet, nodeId, collapsed)
      if (command) {
        dispatchCommand(command, { label: collapsed ? 'Collapse topic children' : 'Expand topic children' })
      }
    },

    setSiblingTopicsCollapsed: (nodeId, collapsed) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!sheet) return
      const command = buildSetSiblingTopicsCollapsedCommand(sheet, nodeId, collapsed)
      if (command) {
        dispatchCommand(command, {
          label: collapsed ? 'Collapse sibling topic children' : 'Expand sibling topic children'
        })
      }
    },

    updateNode: (nodeId, patch) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!sheet) return
      dispatchCommand(
        { type: 'topic.update', sheetId: sheet.id, topicId: nodeId, patch },
        { label: 'Update topic' }
      )
    },

    selectImage: (imageId) => {
      set({
        selection: { kind: 'image', imageId },
        selectedNodeId: null,
        editingNodeId: null
      })
    },

    addImage: (assetId, opts = {}) => {
      const sheet = activeSheetOf(get())
      if (!sheet) return
      const image: MindMapImageElement = {
        id: crypto.randomUUID(),
        type: 'image',
        assetId,
        width: 160,
        height: 88,
        ...(opts.topicId !== undefined && opts.topicId !== null
          ? { topicId: opts.topicId }
          : opts.position !== undefined
            ? { position: { ...opts.position } }
            : {})
      }
      dispatchCommand(
        { type: 'image.create', sheetId: sheet.id, image },
        { label: 'Add image' }
      )
    },

    updateImage: (imageId, patch) => {
      const sheet = activeSheetContainingImage(get(), imageId)
      if (!sheet) return
      dispatchCommand(
        { type: 'image.update', sheetId: sheet.id, imageId, patch },
        { label: 'Update image' }
      )
    },

    moveImage: (imageId, opts) => {
      const sheet = activeSheetContainingImage(get(), imageId)
      if (!sheet) return
      dispatchCommand(
        {
          type: 'image.update',
          sheetId: sheet.id,
          imageId,
          patch: {
            topicId: opts.topicId === undefined ? undefined : opts.topicId ?? null,
            ...(opts.position !== undefined ? { position: { ...opts.position } } : {})
          }
        },
        { label: 'Move image' }
      )
    },

    resizeImage: (imageId, width, height) => {
      const sheet = activeSheetContainingImage(get(), imageId)
      if (!sheet) return
      dispatchCommand(
        {
          type: 'image.update',
          sheetId: sheet.id,
          imageId,
          patch: { width, height }
        },
        { label: 'Resize image' }
      )
    },

    removeImage: (imageId) => {
      const sheet = activeSheetContainingImage(get(), imageId)
      if (!sheet) return
      dispatchCommand(
        { type: 'image.remove', sheetId: sheet.id, imageId },
        { label: 'Remove image' }
      )
    },

    collapseAll: () => {
      const sheet = activeSheetOf(get())
      if (!sheet) return
      const command = buildCollapseLastLevelCommand(sheet)
      if (command) dispatchCommand(command, { label: 'Collapse last visible level' })
    },

    expandAll: () => {
      const sheet = activeSheetOf(get())
      if (!sheet) return
      const command = buildExpandNextLevelCommand(sheet)
      if (command) dispatchCommand(command, { label: 'Expand next visible level' })
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
          set({ selection: { kind: 'canvas' }, selectedNodeId: null })
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
      if (built.pastedRootId) set({ selection: { kind: 'topic', topicIds: [built.pastedRootId] }, selectedNodeId: built.pastedRootId })
    },

    duplicateNode: (nodeId) => {
      const current = get().current
      const sheet = activeSheetContainingTopic(get(), nodeId)
      if (!current || !sheet) return
      const built = buildDuplicateCommand(current, sheet.id, nodeId)
      if (built) {
        dispatchCommand(built.command, { label: 'Duplicate topic' })
        set({ selection: { kind: 'topic', topicIds: [built.pastedRootId] }, selectedNodeId: built.pastedRootId })
      }
    },

    copyTopicStyle: (nodeId) => {
      const sheet = activeSheetContainingTopic(get(), nodeId)
      const topic = sheet ? findTopicInSheet(sheet, nodeId)?.node : undefined
      if (!topic) return
      set({ copiedTopicStyle: captureTopicStyleClipboard(topic.style) })
    },

    pasteTopicStyle: (topicIds) => {
      const clipboard = get().copiedTopicStyle
      const firstTopicId = topicIds[0]
      const sheet = firstTopicId ? activeSheetContainingTopic(get(), firstTopicId) : undefined
      if (!clipboard || !sheet) return
      const command = buildPasteTopicStyleCommand(sheet, topicIds, clipboard)
      if (command) dispatchCommand(command, { label: 'Paste topic style' })
    },

    resetTopicStyle: (topicIds) => {
      const firstTopicId = topicIds[0]
      const sheet = firstTopicId ? activeSheetContainingTopic(get(), firstTopicId) : undefined
      if (!sheet) return
      const command = buildPasteTopicStyleCommand(
        sheet,
        topicIds,
        { kind: 'topic-style', style: null }
      )
      if (command) dispatchCommand(command, { label: 'Reset topic style' })
    },

    applyQuickStyle: (topicIds, preset) => {
      const firstTopicId = topicIds[0]
      const sheet = firstTopicId ? activeSheetContainingTopic(get(), firstTopicId) : undefined
      if (!sheet) return
      const command = buildApplyQuickStyleCommand(sheet, topicIds, preset)
      if (command) {
        dispatchCommand(command, {
          label: preset === 'default' ? 'Reset quick style' : 'Apply quick style'
        })
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

    createColorScheme: (name, colors) => {
      const { state, scheme } = addUserColorScheme(get().colorSchemes, name, colors)
      setColorSchemes(state)
      return scheme
    },

    renameColorScheme: (id, name) => {
      setColorSchemes(renameUserColorScheme(get().colorSchemes, id, name))
    },

    updateColorSchemeColors: (id, colors) => {
      const { state, scheme } = setUserColorSchemeColors(get().colorSchemes, id, colors)
      setColorSchemes(state)
      return scheme
    },

    duplicateColorScheme: (id) => {
      const { state, scheme } = duplicateUserColorScheme(get().colorSchemes, id)
      if (!scheme) return null
      setColorSchemes(state)
      return scheme
    },

    deleteColorScheme: (id) => {
      setColorSchemes(deleteUserColorScheme(get().colorSchemes, id))
    },

    toggleColorSchemeFavorite: (id) => {
      setColorSchemes(toggleColorSchemeFavorite(get().colorSchemes, id))
    },

    recordRecentColorScheme: (id) => {
      setColorSchemes(recordRecentColorScheme(get().colorSchemes, id))
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
      const previousSelection = state.selection
      const selectedElement =
        previousSelection.kind === 'element' && activeSheet?.elements.some((element) => element.id === previousSelection.elementId)
          ? previousSelection
          : null
      const selectedNodeId =
        !selectedElement && state.selectedNodeId && activeSheet && findTopicInSheet(activeSheet, state.selectedNodeId)
          ? state.selectedNodeId
          : selectedElement
            ? null
            : activeSheet?.root.id ?? null
      const selection: MindMapSelection = selectedElement
        ?? (selectedNodeId ? { kind: 'topic', topicIds: [selectedNodeId] } : { kind: 'canvas' })

      set({
        current: document,
        selection,
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
            selection: current.sheets[0]?.root.id
              ? { kind: 'topic', topicIds: [current.sheets[0].root.id] }
              : { kind: 'canvas' },
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
