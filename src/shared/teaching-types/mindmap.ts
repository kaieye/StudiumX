import type { MindMapCommand, MindMapCommandError } from '../mindmap/commands/mind-map-command-types'
import type {
  MindMapProposalDecision,
  MindMapProviderProposal
} from '../mindmap/commands/mind-map-proposal'
import type {
  MindMapProposalRequest,
} from '../mindmap/commands/mind-map-proposal-request'
import type { MindMapProposalScope } from '../mindmap/commands/mind-map-proposal'
import type { MindMapAssetRef, MindMapSourceRef } from '../mindmap/domain/types'
import type { MindMapDocumentV2 } from '../mindmap/domain/types'
import type { MindMapStructureClass, MindMapSummary } from '../mindmap/mind-map-types'
import type { MindMapSvgExportInput } from '../mindmap/svg-export'
import type { AgentChatImageAttachment } from '../agent-chat-images'

/**
 * Mind map IPC payloads (docs/mindmap/design.md §4).
 *
 * Each payload names the target workspace by `workspaceId` (a registered
 * teaching workspace identifier) plus the operation-specific inputs. The main
 * process resolves the workspace root from the registered workspace before any
 * mind-map store/file access.
 *
 * The home location (`~/Documents/StudiumX Workspaces/MindMaps`) is addressed
 * with the reserved sentinel {@link HOME_MIND_MAP_WORKSPACE_ID} so the same
 * per-document IPC lanes work unchanged for maps created directly on the home
 * page.
 */

/**
 * Reserved workspace id addressing the global home mind-map location
 * (`~/Documents/StudiumX Workspaces/MindMaps`), separate from any teaching
 * workspace's per-workspace `mindmaps/` folder.
 */
export const HOME_MIND_MAP_WORKSPACE_ID = '__home__'

/** One workspace's mind-map library entry (folder + its cards). */
export type MindMapLibraryWorkspace = {
  workspaceId: string
  name: string
  /** Absolute path of the workspace folder on disk (rendered as the folder path). */
  path: string
  documents: MindMapSummary[]
}

/** Aggregate home-page library: home cards + one folder per workspace. */
export type MindMapLibrary = {
  home: MindMapSummary[]
  workspaces: MindMapLibraryWorkspace[]
}

export type MindMapListPayload = {
  workspaceId: string
}

export type MindMapCreatePayload = {
  workspaceId: string
  title: string
  /** Optional initial StudiumX-compatible layout for the first sheet. */
  structureClass?: MindMapStructureClass
}

export type MindMapAccessPayload = {
  workspaceId: string
  id: string
}

/** Open a native image picker and copy the selected file into the workspace. */
export type MindMapAssetImportPayload = {
  workspaceId: string
  id: string
}

export type MindMapAssetImportResult =
  | { canceled: true }
  | { canceled: false; asset: MindMapAssetRef }

/** Read one document-declared image as a short-lived renderer data URL. */
export type MindMapAssetReadPayload = {
  workspaceId: string
  id: string
  assetId: string
}

export type MindMapAssetReadResult = {
  asset: MindMapAssetRef
  dataUrl: string
} | null

export type MindMapUpdatePayload = {
  workspaceId: string
  id: string
  /** Compare-and-swap revision the renderer believes is on disk. */
  expectedRevision: number
  doc: MindMapDocumentV2
}

export type MindMapUpdateResult =
  | { ok: true; document: MindMapDocumentV2 }
  | {
      ok: false
      code: 'revision_stale'
      expectedRevision: number
      currentRevision: number
    }

export type MindMapFlushPayload = {
  workspaceId: string
  id: string
}

/** Read-only source-anchor refresh preview for one canonical mind-map. */
export type MindMapSourceRefreshPayload = {
  workspaceId: string
  id: string
}

/** Result of resolving one unique source anchor from the canonical document. */
export type MindMapSourceRefreshStatus =
  | 'fresh'
  | 'stale'
  | 'unknown'
  | 'missing'
  | 'unreadable'

export type MindMapSourceRefreshChange =
  | 'unchanged'
  | 'content_changed'
  | 'stale_flag'
  | 'missing_hash'
  | 'missing_path'
  | 'missing_file'
  | 'unreadable'
  | 'over_limit'
  | 'unsafe_path'
  | 'conflicting_metadata'

/**
 * A review-only, grouped source refresh result. `sourceRef` is the persisted
 * metadata snapshot; no source file content is returned. Repeated references
 * are grouped so a later explicit update can refresh all occurrences through
 * the normal revision/CAS path.
 */
export type MindMapSourceRefreshEntry = {
  sourceRef: MindMapSourceRef
  topicIds: string[]
  sheetIds: string[]
  previousContentHash?: string
  currentContentHash?: string
  status: MindMapSourceRefreshStatus
  changed: boolean
  change: MindMapSourceRefreshChange
}

export type MindMapSourceRefreshPreviewResult = {
  documentId: string
  revision: number
  entries: MindMapSourceRefreshEntry[]
  changedCount: number
  attentionCount: number
}

/** One source-ref snapshot explicitly selected by the learner for writeback. */
export type MindMapSourceRefreshUpdate = {
  sourceRef: MindMapSourceRef
}

/**
 * Apply explicitly confirmed source metadata updates to every topic occurrence
 * in one canonical document. The source file itself is never written.
 */
export type MindMapSourceRefreshApplyPayload = {
  workspaceId: string
  id: string
  expectedRevision: number
  updates: MindMapSourceRefreshUpdate[]
}

export type MindMapSourceRefreshApplyResult =
  | {
      ok: true
      document: MindMapDocumentV2
      command: MindMapCommand | null
      inverse: MindMapCommand | null
      appliedSourceIds: string[]
    }
  | {
      ok: false
      code: 'revision_stale'
      expectedRevision: number
      currentRevision: number
    }
  | {
      ok: false
      code: 'source_unknown' | 'source_conflict'
      sourceId: string
    }
  | {
      ok: false
      code: 'command_invalid'
      error: MindMapCommandError
      command: MindMapCommand
    }

/**
 * Apply the reviewed subset of a provider proposal to one canonical document.
 *
 * The proposal remains renderer-provided data until the main process validates
 * it again and settles the accepted commands through the canonical reducer.
 * `expectedRevision` is the compare-and-swap guard for that settlement.
 */
export type MindMapProposalApplyPayload = {
  workspaceId: string
  id: string
  expectedRevision: number
  proposal: MindMapProviderProposal
  decisions: Record<string, MindMapProposalDecision>
}

export type MindMapProposalApplyResult =
  | {
      ok: true
      proposalId: string
      document: MindMapDocumentV2
      command: MindMapCommand | null
      inverse: MindMapCommand | null
      acceptedIds: string[]
      rejectedIds: string[]
    }
  | {
      ok: false
      code: 'revision_stale'
      expectedRevision: number
      currentRevision: number
    }
  | {
      ok: false
      code: 'command_invalid'
      proposalId: string
      error: MindMapCommandError
      command: MindMapCommand
      acceptedIds: string[]
      rejectedIds: string[]
  }

/**
 * Ask the provider for a reviewable diff against one canonical mind-map
 * snapshot. Generation is read-only; the returned revision is the CAS value
 * the renderer should carry into `applyMindMapProposal` after review.
 */
export type MindMapProposalGeneratePayload = {
  workspaceId: string
  id: string
  scope: MindMapProposalScope
  sheetId: string
  selectedTopicIds: string[]
  sourceRefs: MindMapSourceRef[]
  /** Workspace-relative path resolved by the main process for selected-file scope. */
  selectedFile?: MindMapSelectedFilePayload
  /** Workspace-relative generated Lesson artifact resolved by the main process. */
  lesson?: MindMapLessonPayload
  prompt: string
  /** User-selected images attached to this generation turn (same bounded payload as agent chat). */
  imageAttachments?: AgentChatImageAttachment[]
  /** Stable correlation id shared with the existing generation cancellation path. */
  generationId?: string
  /** Prior mind-map conversation turns so a follow-up keeps context (bounded by the host parser). */
  history?: MindMapConversationHistoryTurn[]
}

/** Renderer-facing selected-file identity. It never includes a workspace root. */
export type MindMapSelectedFilePayload = {
  workspacePath: string
}

/**
 * One bounded prior exchange in the mind-map AI conversation. The renderer
 * mirrors its transcript (user prompt + the assistant's final reply/outcome
 * summary) into this history so a follow-up turn sees the conversation
 * context — the model must not be treated as stateless per message.
 */
export type MindMapConversationHistoryTurn = {
  role: 'user' | 'assistant'
  content: string
}

/** Renderer-facing Lesson identity. It never includes a workspace root or body. */
export type MindMapLessonPayload = {
  workspacePath: string
}

export type MindMapProposalGenerateResult = {
  documentId: string
  revision: number
  request: MindMapProposalRequest
  proposal: MindMapProviderProposal
  /**
   * Optional learner-facing reply from the same JSON-mode provider turn.
   * It is never included in `proposal` and never crosses the apply mutation
   * boundary; the renderer presents it as conversation text, never mutation input.
   */
  assistantMessage?: string
}

/** AI-assisted generation input; the doc is produced by the main process. */
export type MindMapGeneratePayload = {
  workspaceId: string
  title: string
  prompt: string
  /** Optional workspace-relative source file used as read-only generation context. */
  selectedFile?: MindMapSelectedFilePayload
  /** Optional generated Lesson artifact used as read-only generation context. */
  lesson?: MindMapLessonPayload
  /** User-selected images attached to this generation turn (same bounded payload as agent chat). */
  imageAttachments?: AgentChatImageAttachment[]
  /** Stable correlation id used by `cancelMindMapGeneration` to abort the run. */
  generationId?: string
  /** Prior mind-map conversation turns so a follow-up keeps context (bounded by the host parser). */
  history?: MindMapConversationHistoryTurn[]
}

/** Cancel an in-flight AI mind-map generation (propagates to the provider request). */
export type MindMapCancelGenerationPayload = {
  workspaceId: string
  generationId: string
}

/** Lifecycle phases pushed while an AI mind-map generation is in flight. */
export type MindMapStreamStep =
  | 'calling'
  | 'streaming'
  | 'validating'
  | 'rendering'
  | 'done'
  | 'error'
  | 'cancelled'

/** A provider text delta correlated with one renderer generation lease. */
export type MindMapStreamChunk = {
  generationId: string
  delta: string
}

/** Status for the renderer's live generation preview. */
export type MindMapStreamStatus = {
  generationId: string
  step: MindMapStreamStep
  message?: string
}

/** Import the tree/notes Markdown subset emitted by StudiumX. */
export type MindMapMarkdownImportPayload = {
  workspaceId: string
  sourcePath: string
}

/** Import the tree/notes OPML 2.0 subset emitted by StudiumX. */
export type MindMapOpmlImportPayload = {
  workspaceId: string
  sourcePath: string
}

/** Import a single-file StudiumX mind-map package with embedded media. */
export type MindMapPortableImportPayload = {
  workspaceId: string
  sourcePath: string
}

/**
 * Main-process dialog import: the native file picker and format routing run in
 * the host so importing works identically on macOS and Windows (a renderer
 * `File` object cannot resolve an on-disk path on every platform).
 */
export type MindMapImportDialogPayload = {
  workspaceId: string
}

export type MindMapImportDialogResult =
  | { canceled: true }
  | { canceled: false; document: MindMapDocumentV2 }

/**
 * Renderer-side proof that the candidate selected for Markdown export is the
 * same revision the repository is expected to have after the local save lane
 * has been drained.  The main process validates these values again against a
 * read-only repository snapshot; they are never treated as authoritative on
 * their own.
 */
export type MindMapMarkdownExportSnapshot = {
  id: string
  snapshotRevision: number
  expectedRevision: number
  pendingWrites: boolean
  dirty: boolean
}

/** Markdown export request carrying the renderer readiness proof required by the
 * fail-closed export boundary. */
export type MindMapMarkdownExportPayload = {
  workspaceId: string
  id: string
  destinationDirectory: string
  snapshotRevision: number
  expectedRevision: number
  pendingWrites: boolean
  dirty: boolean
}

/** OPML export request with the same fail-closed renderer readiness proof as Markdown. */
export type MindMapOpmlExportPayload = {
  workspaceId: string
  id: string
  destinationDirectory: string
  snapshotRevision: number
  expectedRevision: number
  pendingWrites: boolean
  dirty: boolean
}

/** Export a clean, durably acknowledged map as one portable `.sxmind` file. */
export type MindMapPortableExportPayload = {
  workspaceId: string
  id: string
  destinationDirectory: string
  snapshotRevision: number
  expectedRevision: number
  pendingWrites: boolean
  dirty: boolean
}

/** SVG export request carrying the rendered sheet layout plus the same
 * fail-closed renderer readiness proof as the text exports. */
export type MindMapSvgExportPayload = {
  workspaceId: string
  id: string
  sheetId: string
  destinationDirectory: string
  input: MindMapSvgExportInput
  snapshotRevision: number
  expectedRevision: number
  pendingWrites: boolean
  dirty: boolean
}

/** PNG export request carrying a renderer-rasterized artifact plus the
 * validated SVG layout that determines its expected pixel dimensions. */
export type MindMapPngExportPayload = {
  workspaceId: string
  id: string
  sheetId: string
  destinationDirectory: string
  input: MindMapSvgExportInput
  pngBase64: string
  width: number
  height: number
  snapshotRevision: number
  expectedRevision: number
  pendingWrites: boolean
  dirty: boolean
}
