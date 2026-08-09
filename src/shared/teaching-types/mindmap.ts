import type { MindMapDocument } from '../mindmap/mind-map-types'

/**
 * Mind map IPC payloads (docs/mindmap/design.md §4).
 *
 * Each payload names the target workspace by `workspaceId` (a registered
 * teaching workspace identifier) plus the operation-specific inputs. The main
 * process resolves the workspace root from the registered workspace before any
 * mind-map store/file access.
 */

export type MindMapListPayload = {
  workspaceId: string
}

export type MindMapCreatePayload = {
  workspaceId: string
  title: string
}

export type MindMapAccessPayload = {
  workspaceId: string
  id: string
}

export type MindMapUpdatePayload = {
  workspaceId: string
  id: string
  doc: MindMapDocument
}

/** AI-assisted generation input; the doc is produced by the main process. */
export type MindMapGeneratePayload = {
  workspaceId: string
  title: string
  prompt: string
}

export type MindMapImportPayload = {
  workspaceId: string
  sourcePath: string
}

export type MindMapExportPayload = {
  workspaceId: string
  id: string
  destinationDirectory: string
}