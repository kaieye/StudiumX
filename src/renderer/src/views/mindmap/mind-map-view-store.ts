import { create } from 'zustand'
import type {
  MindMapDocument,
  MindMapNode,
  MindMapSummary
} from '../../../../shared/mindmap/mind-map-types'
import { useAppStore } from '../../app-shell/appStore'

/**
 * Renderer state for the mind-map view (docs/mindmap/design.md §6.6).
 *
 * Holds the workspace document list, the currently-open document, selection and
 * AI generation state. All IPC calls are guarded against a null active
 * workspace; callers surface an empty state rather than throwing.
 */

export type MindMapUpdatePatch = Partial<Pick<MindMapNode, 'title' | 'note'>>

type MindMapViewState = {
  documents: MindMapSummary[]
  current: MindMapDocument | null
  selectedNodeId: string | null
  generating: boolean
  streamText: string
  error: string | null
  aiPrompt: string

  loadDocuments: () => Promise<void>
  openDocument: (id: string) => Promise<void>
  createDocument: (title: string) => Promise<void>
  deleteDocument: (id: string) => Promise<void>
  renameDocument: (title: string) => Promise<void>
  newSheet: () => Promise<void>

  updateNode: (nodeId: string, patch: MindMapUpdatePatch) => void
  addChild: (parentId: string) => void
  addSibling: (nodeId: string) => void
  deleteNode: (nodeId: string) => void
  toggleCollapse: (nodeId: string) => void
  collapseAll: () => void
  expandAll: () => void

  setAiPrompt: (prompt: string) => void
  generate: (prompt: string) => Promise<void>
}

function workspaceId(): string | null {
  return useAppStore.getState().appState?.activeWorkspace?.id ?? null
}

function newNode(title: string): MindMapNode {
  return { id: crypto.randomUUID(), title, children: [] }
}

/** Immutably rebuild the tree with `fn` applied to the node with `id`. */
function transformNode(
  node: MindMapNode,
  id: string,
  fn: (node: MindMapNode) => MindMapNode
): MindMapNode {
  if (node.id === id) return fn(node)
  const children = node.children.map((child) => transformNode(child, id, fn))
  return hasChangedChildren(node, children) ? { ...node, children } : node
}

function hasChangedChildren(node: MindMapNode, children: MindMapNode[]): boolean {
  return node.children.length !== children.length || node.children.some((c, i) => c !== children[i])
}

/** Remove the node with `id` (and its subtree) from the tree. */
function pruneNode(node: MindMapNode, id: string): MindMapNode | null {
  if (node.id === id) return null
  const children: MindMapNode[] = []
  for (const child of node.children) {
    const kept = pruneNode(child, id)
    if (kept) children.push(kept)
  }
  return hasChangedChildren(node, children) ? { ...node, children } : node
}

/** Insert `siblingNode` immediately after the node with `siblingId`. */
function insertSibling(
  node: MindMapNode,
  siblingId: string,
  siblingNode: MindMapNode
): MindMapNode {
  const index = node.children.findIndex((child) => child.id === siblingId)
  if (index >= 0) {
    const children = [...node.children]
    children.splice(index + 1, 0, siblingNode)
    return { ...node, children }
  }
  const children = node.children.map((child) => insertSibling(child, siblingId, siblingNode))
  return hasChangedChildren(node, children) ? { ...node, children } : node
}

function setCollapsedEverywhere(node: MindMapNode, collapsed: boolean): MindMapNode {
  return {
    ...node,
    collapsed,
    children: node.children.map((child) => setCollapsedEverywhere(child, collapsed))
  }
}

export const useMindMapViewStore = create<MindMapViewState>((set, get) => {
  // Debounced durable persist for node mutations. Only the head of a burst is
  // flushed; trailing writes are coalesced so rapid typing does not spam IPC.
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  const schedulePersist = (): void => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      const state = get()
      const id = state.current?.id
      const workspace = workspaceId()
      if (!id || !workspace || !state.current) return
      void window.teachingSystem?.updateMindMap({
        workspaceId: workspace,
        id,
        doc: state.current
      })
    }, 400)
  }

  const mutateCurrent = (mutate: (doc: MindMapDocument) => MindMapDocument): void => {
    const current = get().current
    if (!current) return
    const next = mutate(current)
    set({ current: { ...next, updatedAt: new Date().toISOString() } })
  }

  const refreshDocuments = async (): Promise<void> => {
    const workspace = workspaceId()
    if (!workspace) return
    const documents = await window.teachingSystem?.listMindMaps({ workspaceId: workspace })
    if (documents) set({ documents })
  }

  return {
    documents: [],
    current: null,
    selectedNodeId: null,
    generating: false,
    streamText: '',
    error: null,
    aiPrompt: '',

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
        if (current) set({ current, selectedNodeId: current.sheets[0]?.root.id ?? null, error: null })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    createDocument: async (title) => {
      const workspace = workspaceId()
      if (!workspace) return
      try {
        const current = await window.teachingSystem?.createMindMap({ workspaceId: workspace, title })
        if (current) {
          set({ current, selectedNodeId: current.sheets[0]?.root.id ?? null, error: null })
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
        set((state) => ({
          documents: state.documents.filter((doc) => doc.id !== id),
          ...(state.current?.id === id ? { current: null, selectedNodeId: null } : {})
        }))
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    renameDocument: async (title) => {
      const current = get().current
      const workspace = workspaceId()
      if (!current || !workspace) return
      const next = { ...current, title, updatedAt: new Date().toISOString() }
      set({ current: next })
      try {
        const saved = await window.teachingSystem?.updateMindMap({
          workspaceId: workspace,
          id: current.id,
          doc: next
        })
        if (saved) set({ current: saved })
        await refreshDocuments()
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    newSheet: async () => {
      const current = get().current
      const workspace = workspaceId()
      if (!current || !workspace) return
      const sheet = {
        id: crypto.randomUUID(),
        title: `Sheet ${current.sheets.length + 1}`,
        structureClass: 'org.xmind.ui.logic.right' as const,
        root: newNode('中心主题')
      }
      const next = {
        ...current,
        sheets: [...current.sheets, sheet],
        updatedAt: new Date().toISOString()
      }
      set({ current: next, selectedNodeId: sheet.root.id })
      try {
        const saved = await window.teachingSystem?.updateMindMap({
          workspaceId: workspace,
          id: current.id,
          doc: next
        })
        if (saved) set({ current: saved })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    updateNode: (nodeId, patch) => {
      mutateCurrent((doc) => ({
        ...doc,
        sheets: doc.sheets.map((sheet) => ({
          ...sheet,
          root: transformNode(sheet.root, nodeId, (node) => ({ ...node, ...patch }))
        }))
      }))
      schedulePersist()
    },

    addChild: (parentId) => {
      const child = newNode('')
      mutateCurrent((doc) => ({
        ...doc,
        sheets: doc.sheets.map((sheet) => ({
          ...sheet,
          root: transformNode(sheet.root, parentId, (node) => ({
            ...node,
            collapsed: false,
            children: [...node.children, child]
          }))
        }))
      }))
      set({ selectedNodeId: child.id })
      schedulePersist()
    },

    addSibling: (nodeId) => {
      const sibling = newNode('')
      mutateCurrent((doc) => ({
        ...doc,
        sheets: doc.sheets.map((sheet) => ({
          ...sheet,
          root: insertSibling(sheet.root, nodeId, sibling)
        }))
      }))
      set({ selectedNodeId: sibling.id })
      schedulePersist()
    },

    deleteNode: (nodeId) => {
      const current = get().current
      if (!current) return
      const root = current.sheets[0]?.root
      if (root && root.id === nodeId) {
        // Deleting the root would empty the tree; keep a minimal placeholder.
        mutateCurrent((doc) => ({
          ...doc,
          sheets: doc.sheets.map((sheet) => ({ ...sheet, root: newNode('中心主题') }))
        }))
        set({ selectedNodeId: root.id })
        schedulePersist()
        return
      }
      mutateCurrent((doc) => ({
        ...doc,
        sheets: doc.sheets.map((sheet) => {
          const pruned = pruneNode(sheet.root, nodeId)
          return pruned ? { ...sheet, root: pruned } : sheet
        })
      }))
      set({ selectedNodeId: null })
      schedulePersist()
    },

    toggleCollapse: (nodeId) => {
      mutateCurrent((doc) => ({
        ...doc,
        sheets: doc.sheets.map((sheet) => ({
          ...sheet,
          root: transformNode(sheet.root, nodeId, (node) => ({
            ...node,
            collapsed: !(node.collapsed === true)
          }))
        }))
      }))
      schedulePersist()
    },

    collapseAll: () => {
      mutateCurrent((doc) => ({
        ...doc,
        sheets: doc.sheets.map((sheet) => ({
          ...sheet,
          root: setCollapsedEverywhere(sheet.root, true)
        }))
      }))
      schedulePersist()
    },

    expandAll: () => {
      mutateCurrent((doc) => ({
        ...doc,
        sheets: doc.sheets.map((sheet) => ({
          ...sheet,
          root: setCollapsedEverywhere(sheet.root, false)
        }))
      }))
      schedulePersist()
    },

    setAiPrompt: (aiPrompt) => set({ aiPrompt }),

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
          set({
            current,
            selectedNodeId: current.sheets[0]?.root.id ?? null,
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