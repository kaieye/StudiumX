import { lstat, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import { isPathInsideRoot } from '../../path-access'

export type WorkspacePathTarget = {
  root: string
  absolutePath: string
  relativePath: string
}

export type WorkspaceWriteTargetState = {
  exists: boolean
  kind: 'file' | 'directory' | 'other' | null
}

/** Convert a native path to the stable representation exposed to providers. */
export function toPosixWorkspacePath(value: string): string {
  return value.replace(/\\/g, '/')
}

/** Resolve an operation target without allowing a caller to escape its workspace lexically. */
export function resolveWorkspacePathTarget(
  workspaceRoot: string | undefined,
  rawPath: unknown,
  fallback = '.'
): WorkspacePathTarget {
  const root = requireWorkspaceRoot(workspaceRoot)
  const input = typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : fallback
  if (isAbsolute(input)) throw new Error('请使用相对工作区路径，不允许传入绝对路径。')

  const absolutePath = resolve(root, input)
  if (!isPathInsideRoot(root, absolutePath)) {
    throw new Error('路径超出当前教学工作区。')
  }

  return {
    root,
    absolutePath,
    relativePath: toPosixWorkspacePath(relative(root, absolutePath)) || '.'
  }
}

/** Verify a target that must already exist, including symlink-aware containment. */
export async function verifyExistingWorkspaceTarget(target: WorkspacePathTarget): Promise<void> {
  await assertRealPathInsideWorkspace(target.root, target.absolutePath)
}

/**
 * Prepare a file target for a write. Existing files are checked through their
 * real path; new files first prove their nearest existing parent is contained,
 * then create and re-verify the requested parent.
 */
export async function prepareWorkspaceWriteTarget(target: WorkspacePathTarget): Promise<WorkspaceWriteTargetState> {
  const targetInfo = await lstatIfExists(target.absolutePath)
  if (targetInfo) {
    if (targetInfo.isSymbolicLink()) {
      throw new Error('目标路径是符号链接，拒绝写入。')
    }
    await verifyExistingWorkspaceTarget(target)
    return {
      exists: true,
      kind: targetInfo.isFile() ? 'file' : targetInfo.isDirectory() ? 'directory' : 'other'
    }
  }

  const parent = dirname(target.absolutePath)
  await assertNearestExistingParentInsideWorkspace(target.root, parent)
  await mkdir(parent, { recursive: true })
  await assertRealPathInsideWorkspace(target.root, parent)

  return { exists: false, kind: null }
}

/** Verify the file after it has been written, keeping post-write containment local to this module. */
export async function verifyWrittenWorkspaceTarget(target: WorkspacePathTarget): Promise<void> {
  await verifyExistingWorkspaceTarget(target)
}

function requireWorkspaceRoot(workspaceRoot: string | undefined): string {
  const root = workspaceRoot?.trim()
  if (!root) throw new Error('当前没有绑定教学工作区，无法读取工作区文件。')
  return resolve(root)
}

async function assertNearestExistingParentInsideWorkspace(rootPath: string, parentPath: string): Promise<void> {
  const existingAncestor = await findNearestExistingAncestor(parentPath)
  await assertRealPathInsideWorkspace(rootPath, existingAncestor)
}

async function findNearestExistingAncestor(path: string): Promise<string> {
  let candidate = path
  while (true) {
    if (await lstatIfExists(candidate)) return candidate
    const next = dirname(candidate)
    if (next === candidate) return candidate
    candidate = next
  }
}

async function assertRealPathInsideWorkspace(rootPath: string, targetPath: string): Promise<void> {
  const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
  if (!isPathInsideRoot(realRoot, realTarget)) {
    throw new Error('路径经过符号链接后超出当前教学工作区。')
  }
}

async function lstatIfExists(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}