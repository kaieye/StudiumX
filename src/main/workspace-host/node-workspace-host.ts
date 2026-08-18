/**
 * Default Node WorkspaceHostPort — pure composition over existing helpers.
 * Zero new security policy; no Electron APIs (ADR-0005).
 */
import {
  assertRealPathInsideRoot,
  ensureContainedDirectory,
  isPathInsideRoot,
  readContainedRegularFile,
  readContainedRegularFileBounded
} from '../path-access'
import {
  resolveRegisteredWorkspaceRoot
} from '../teaching-workspace-access'
import {
  normalizeWorkspaceRelativePath,
  toWorkspaceRelativePath
} from '../teaching-workspace-paths'
import type { WorkspaceHostPort } from './types'

/**
 * Create a thin Node implementation of {@link WorkspaceHostPort}.
 * Delegates 1:1 to path-access / teaching-workspace-paths / teaching-workspace-access.
 */
export function createNodeWorkspaceHost(): WorkspaceHostPort {
  return {
    toRelative(root, absolute) {
      return toWorkspaceRelativePath(root, absolute)
    },
    normalizeRelative(rel) {
      return normalizeWorkspaceRelativePath(rel)
    },
    isInsideRoot(root, target) {
      return isPathInsideRoot(root, target)
    },
    assertRealPathInsideRoot(root, target) {
      return assertRealPathInsideRoot(root, target)
    },
    readContainedRegularFile(root, target) {
      return readContainedRegularFile(root, target)
    },
    readContainedRegularFileBounded(root, target, maxBytes) {
      return readContainedRegularFileBounded(root, target, maxBytes)
    },
    ensureContainedDirectory(root, targetDirectory) {
      return ensureContainedDirectory(root, targetDirectory)
    },
    resolveRegisteredRoot(workspaces, raw) {
      return resolveRegisteredWorkspaceRoot(workspaces, raw)
    }
  }
}
