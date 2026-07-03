import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { WorkspaceItemKind } from '../shared/teaching-types'

export type WorkspacePathMeta = { pinned?: boolean; archived?: boolean }

export function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function clampTitle(value: string): string {
  const trimmed = cleanText(value)
  if (!trimmed) return '学习任务'
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}...` : trimmed
}

export function toWorkspaceRelativePath(rootPath: string, absolutePath: string): string {
  return relative(rootPath, absolutePath).replace(/\\/g, '/')
}

export function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

export function titleFromFilename(file: string): string {
  return (
    file
      .replace(/\.[^.]+$/, '')
      .replace(/^\d{4}-/, '')
      .split('-')
      .filter(Boolean)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(' ') || file
  )
}

export function workspaceRelativePath(...parts: string[]): string {
  return parts.filter(Boolean).join('/')
}

/** Normalize a stored relative path key: forward slashes, no leading slash, no `./`. */
export function normalizeWorkspaceRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '').replace(/\/+$/, '')
}

export function normalizePathMeta(value: unknown): Record<string, WorkspacePathMeta> {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>
  const result: Record<string, WorkspacePathMeta> = {}
  for (const [key, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== 'object') continue
    const meta = entry as { pinned?: unknown; archived?: unknown }
    const normalized: WorkspacePathMeta = {}
    if (meta.pinned === true) normalized.pinned = true
    if (meta.archived === true) normalized.archived = true
    const normalizedKey = normalizeWorkspaceRelativePath(key)
    if (!normalizedKey) continue
    result[normalizedKey] = normalized
  }
  return result
}

export function isPathArchived(pathMeta: Record<string, WorkspacePathMeta>, relativePath: string): boolean {
  const path = normalizeWorkspaceRelativePath(relativePath)
  if (!path) return false
  return Object.entries(pathMeta).some(([key, meta]) => {
    if (!meta.archived) return false
    const archivedPath = normalizeWorkspaceRelativePath(key)
    return path === archivedPath || path.startsWith(`${archivedPath}/`)
  })
}

export function pathRemovedByWorkspaceItem(
  kind: WorkspaceItemKind,
  removedRelativePath: string,
  currentRelativePath: string
): boolean {
  const removed = normalizeWorkspaceRelativePath(removedRelativePath)
  const current = normalizeWorkspaceRelativePath(currentRelativePath)
  if (!removed || !current) return false
  if (kind === 'directory') return current === removed || current.startsWith(`${removed}/`)
  return current === removed
}

/** Remove a path's meta entry and any descendant entries (for folder removal). */
export function prunePathMeta(
  value: Record<string, WorkspacePathMeta> | undefined,
  relativePath: string
): Record<string, WorkspacePathMeta> {
  if (!value) return {}
  const key = normalizeWorkspaceRelativePath(relativePath)
  const prefix = key ? `${key}/` : ''
  const result: Record<string, WorkspacePathMeta> = {}
  for (const [entryKey, meta] of Object.entries(value)) {
    if (entryKey === key) continue
    if (prefix && (entryKey === prefix.slice(0, -1) || entryKey.startsWith(prefix))) continue
    result[entryKey] = meta
  }
  return result
}

export function compactMarkdown(value: string): string {
  return cleanText(
    value
      .replace(/^#+\s+/gm, '')
      .replace(/^-+\s*/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  )
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

export async function fileExists(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isFile()).catch(() => false)
}

export async function directoryExists(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isDirectory()).catch(() => false)
}

export async function collectTeachingFiles(
  rootPath: string,
  predicate: (filePath: string) => boolean
): Promise<string[]> {
  const roots = [
    join(rootPath, 'courses'),
    join(rootPath, 'lessons'),
    join(rootPath, 'learning-records'),
    join(rootPath, 'reviews'),
    join(rootPath, 'reference')
  ]
  const results = await Promise.all(roots.map((path) => walkFiles(path, predicate)))
  return results.flat()
}

async function walkFiles(rootPath: string, predicate: (filePath: string) => boolean): Promise<string[]> {
  if (!(await directoryExists(rootPath))) return []
  const result: string[] = []
  const stack = [rootPath]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const nextPath = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(nextPath)
        continue
      }
      if (entry.isFile() && predicate(nextPath)) {
        result.push(nextPath)
      }
    }
  }
  return result
}
