/**
 * Thin WorkspaceHost port types (ADR-0005 / ADOPTION S-02).
 *
 * Intended dependency direction:
 *   tools / agent  →  workspace-host  →  path-access / teaching-workspace-paths / teaching-workspace-access
 * Do not reverse-import agent-loop, coordinator, ledger, gateway, renderer, or electron from this folder.
 *
 * This is a façade over existing helpers — not a second IO stack, not a FS rewrite.
 */
import type { Buffer } from 'node:buffer'
import type {
  BoundedContainedRegularFileRead
} from '../path-access'
import type {
  RegisteredWorkspaceRootResult
} from '../teaching-workspace-access'
import type { TeachingWorkspaceSummary } from '../../shared/teaching-types'

/** Absolute path of a registered teaching workspace root. */
export type WorkspaceRootPath = string

/** Workspace-relative path key (forward-slash normalized where helpers normalize). */
export type WorkspaceRelativePath = string

export type { BoundedContainedRegularFileRead, RegisteredWorkspaceRootResult }

/**
 * Small, testable façade over path containment + workspace relative helpers.
 * Keep methods thin and 1:1 with existing helpers; no catalog / git / lessons / agent.
 */
export interface WorkspaceHostPort {
  /** `relative(root, absolute)` with forward slashes. */
  toRelative(root: WorkspaceRootPath, absolute: string): WorkspaceRelativePath

  /** Normalize stored relative path keys (forward slashes, no leading slash / `./`). */
  normalizeRelative(rel: WorkspaceRelativePath): WorkspaceRelativePath

  /**
   * Lexical containment check (path-access `isPathInsideRoot` / `isLexicallyInsideRoot`).
   * Prefer `assertRealPathInsideRoot` when symlinks matter.
   */
  isInsideRoot(root: WorkspaceRootPath, target: string): boolean

  /** Realpath-after-resolve containment; throws if target escapes root. */
  assertRealPathInsideRoot(root: WorkspaceRootPath, target: string): Promise<void>

  /** Contained regular-file read (no final-symlink follow beyond proven realpath). */
  readContainedRegularFile(root: WorkspaceRootPath, target: string): Promise<Buffer>

  /** Bounded contained regular-file read; never opens oversized artifacts. */
  readContainedRegularFileBounded(
    root: WorkspaceRootPath,
    target: string,
    maxBytes: number
  ): Promise<BoundedContainedRegularFileRead>

  /** Ensure directory tree under root without accepting symlink/junction components. */
  ensureContainedDirectory(root: WorkspaceRootPath, targetDirectory: string): Promise<void>

  /** Resolve raw root against registered workspace list (fail-closed). */
  resolveRegisteredRoot(
    workspaces: Array<Pick<TeachingWorkspaceSummary, 'rootPath'>>,
    raw: string
  ): Promise<RegisteredWorkspaceRootResult>
}
