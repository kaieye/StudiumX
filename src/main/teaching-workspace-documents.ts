import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { isPathInsideRoot } from './path-access'
import type { ReadLessonResult, WorkspaceMarkdownDocument } from '../shared/teaching-types'
import {
  ensurePreviewBaseTag,
  injectPreviewMarkdownLinkBridge,
  PREVIEW_PROTOCOL
} from '../shared/preview-markdown-bridge'

/** A workspace whose registry identity and root have already been verified by the workspace service. */
export type ResolvedTeachingWorkspace = {
  id: string
  rootPath: string
}

export type WorkspacePreviewFile = {
  absolutePath: string
  mimeType: string
  relativePath: string
  workspaceId: string
}

export type WorkspacePreviewResponse = {
  body: Buffer
  mimeType: string
}

type ResolvedWorkspaceDocument = {
  absolutePath: string
  relativePath: string
}

const ROOT_MARKDOWN_DOCUMENTS = new Set([
  'MISSION.md',
  'RESOURCES.md',
  'GLOSSARY.md',
  'NOTES.md'
])

const MARKDOWN_DOCUMENT_DIRECTORIES = [
  'courses',
  'lessons',
  'learning-records',
  'reviews',
  'reference',
  'conversation'
]

const LESSON_DOCUMENT_DIRECTORIES = ['courses', 'lessons']
const PREVIEW_DOCUMENT_DIRECTORIES = ['courses', 'lessons', 'assets']

/**
 * Document seam for a workspace that has already been resolved from the Teaching registry.
 *
 * Every caller supplies a document intent (a relative URL/path), never an absolute path. The
 * resolver rejects traversal and absolute forms before it reaches node:path, so its result can
 * safely be used for reads, writes, metadata, and protocol previews.
 */
export class TeachingWorkspaceDocuments {
  async readLesson(workspace: ResolvedTeachingWorkspace, lessonPath: string): Promise<ReadLessonResult> {
    const document = this.resolveLesson(workspace, lessonPath)
    const html = await this.readUtf8File(workspace, document.absolutePath)
    const url = previewUrlForDocument(workspace.id, document.relativePath)
    return { html: bridgePreviewHtml(html, url), url }
  }

  async readMarkdown(
    workspace: ResolvedTeachingWorkspace,
    documentPath: string
  ): Promise<WorkspaceMarkdownDocument> {
    const document = this.resolveMarkdown(workspace, documentPath)
    return this.loadMarkdownMetadata(workspace, document)
  }

  /** Writes an approved Markdown intent atomically and returns its canonical document facts. */
  async saveMarkdown(
    workspace: ResolvedTeachingWorkspace,
    documentPath: string,
    content: string
  ): Promise<WorkspaceMarkdownDocument> {
    if (typeof content !== 'string') throw new Error('Markdown content must be text.')
    const document = this.resolveMarkdown(workspace, documentPath)
    await this.atomicWriteUtf8File(workspace, document.absolutePath, content)
    return this.loadMarkdownMetadata(workspace, document)
  }

  /**
   * Resolves a protocol document without reading it. `relativePath` may be URL encoded, but it
   * is decoded exactly once by the intent parser and encoded traversal remains invalid.
   */
  async resolvePreviewFile(
    workspace: ResolvedTeachingWorkspace,
    relativePath: string
  ): Promise<WorkspacePreviewFile | null> {
    const document = this.tryResolvePreview(workspace, relativePath)
    if (!document) return null
    if (!(await this.isSafeExistingFile(workspace, document.absolutePath))) return null
    return {
      absolutePath: document.absolutePath,
      mimeType: mimeTypeForDocument(document.relativePath),
      relativePath: document.relativePath,
      workspaceId: workspace.id
    }
  }

  /** Reads a resolved preview intent and only transforms HTML; binary bytes are returned unchanged. */
  async readPreview(
    workspace: ResolvedTeachingWorkspace,
    relativePath: string,
    requestUrl: string
  ): Promise<WorkspacePreviewResponse | null> {
    const file = await this.resolvePreviewFile(workspace, relativePath)
    if (!file) return null
    const body = await this.readBufferFile(workspace, file.absolutePath)
    return {
      mimeType: file.mimeType,
      body: file.mimeType.startsWith('text/html')
        ? Buffer.from(bridgePreviewHtml(body.toString('utf8'), requestUrl), 'utf8')
        : body
    }
  }

  private resolveLesson(workspace: ResolvedTeachingWorkspace, lessonPath: string): ResolvedWorkspaceDocument {
    const document = this.resolveIntent(workspace, lessonPath, 'Lesson path is outside the workspace lessons directory.')
    if (!isInsideOneOf(workspace.rootPath, LESSON_DOCUMENT_DIRECTORIES, document.absolutePath)) {
      throw new Error('Lesson path is outside the workspace lessons directory.')
    }
    return document
  }

  private resolveMarkdown(workspace: ResolvedTeachingWorkspace, documentPath: string): ResolvedWorkspaceDocument {
    const document = this.resolveIntent(workspace, documentPath, 'Markdown path is outside the allowed workspace documents.')
    if (!isWorkspaceMarkdownPathAllowed(workspace.rootPath, document)) {
      throw new Error('Markdown path is outside the allowed workspace documents.')
    }
    return document
  }

  private tryResolvePreview(
    workspace: ResolvedTeachingWorkspace,
    relativePath: string
  ): ResolvedWorkspaceDocument | null {
    let document: ResolvedWorkspaceDocument
    try {
      document = this.resolveIntent(workspace, relativePath, 'Preview path is outside the allowed workspace documents.')
    } catch {
      return null
    }
    if (isInsideOneOf(workspace.rootPath, PREVIEW_DOCUMENT_DIRECTORIES, document.absolutePath)) return document
    return isWorkspaceMarkdownPathAllowed(workspace.rootPath, document) ? document : null
  }

  private resolveIntent(
    workspace: ResolvedTeachingWorkspace,
    value: string,
    errorMessage: string
  ): ResolvedWorkspaceDocument {
    const relativePath = normalizeDocumentIntent(value)
    if (!relativePath) throw new Error(errorMessage)
    const absolutePath = resolve(workspace.rootPath, ...relativePath.split('/'))
    if (!isPathInsideRoot(resolve(workspace.rootPath), absolutePath)) throw new Error(errorMessage)
    return { absolutePath, relativePath }
  }

  private async loadMarkdownMetadata(
    workspace: ResolvedTeachingWorkspace,
    document: ResolvedWorkspaceDocument
  ): Promise<WorkspaceMarkdownDocument> {
    const [content, info] = await Promise.all([
      this.readUtf8File(workspace, document.absolutePath),
      this.safeFileStat(workspace, document.absolutePath)
    ])
    return {
      title: titleFromMarkdown(content, document.relativePath),
      relativePath: document.relativePath,
      absolutePath: document.absolutePath,
      content,
      updatedAt: info?.mtime ? info.mtime.toISOString() : null
    }
  }

  private async readUtf8File(workspace: ResolvedTeachingWorkspace, absolutePath: string): Promise<string> {
    const safePath = await this.resolveExistingFile(workspace, absolutePath)
    return readFile(safePath, 'utf8')
  }

  private async readBufferFile(workspace: ResolvedTeachingWorkspace, absolutePath: string): Promise<Buffer> {
    const safePath = await this.resolveExistingFile(workspace, absolutePath)
    return readFile(safePath)
  }

  private async safeFileStat(workspace: ResolvedTeachingWorkspace, absolutePath: string) {
    try {
      const safePath = await this.resolveExistingFile(workspace, absolutePath)
      return await stat(safePath)
    } catch {
      return null
    }
  }

  private async isSafeExistingFile(workspace: ResolvedTeachingWorkspace, absolutePath: string): Promise<boolean> {
    try {
      const safePath = await this.resolveExistingFile(workspace, absolutePath)
      return (await stat(safePath)).isFile()
    } catch {
      return false
    }
  }

  /** Atomic replacement prevents partial Markdown saves and never follows an existing file symlink. */
  private async atomicWriteUtf8File(
    workspace: ResolvedTeachingWorkspace,
    absolutePath: string,
    content: string
  ): Promise<void> {
    const parent = dirname(absolutePath)
    await this.ensureSafeParentDirectory(workspace, parent)

    const temporaryPath = join(parent, `.${basename(absolutePath)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporaryPath, content, 'utf8')
      await rename(temporaryPath, absolutePath)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  /** Create a nested parent one level at a time so an existing symlink is detected before descent. */
  private async ensureSafeParentDirectory(workspace: ResolvedTeachingWorkspace, directoryPath: string): Promise<void> {
    const normalizedRoot = resolve(workspace.rootPath)
    const directoryRelativePath = relative(normalizedRoot, directoryPath)
    const directoryParts = directoryRelativePath ? directoryRelativePath.split(/[/\\]+/).filter(Boolean) : []
    let currentPath = normalizedRoot
    await this.resolveExistingDirectory(workspace, currentPath)
    for (const part of directoryParts) {
      currentPath = join(currentPath, part)
      await mkdir(currentPath, { recursive: true })
      await this.resolveExistingDirectory(workspace, currentPath)
    }
  }

  private async resolveExistingFile(workspace: ResolvedTeachingWorkspace, absolutePath: string): Promise<string> {
    const [realRoot, realTarget] = await Promise.all([realpath(workspace.rootPath), realpath(absolutePath)])
    if (!isPathInsideRoot(realRoot, realTarget)) {
      throw new Error('Workspace document resolves outside the workspace.')
    }
    return realTarget
  }

  private async resolveExistingDirectory(workspace: ResolvedTeachingWorkspace, directoryPath: string): Promise<string> {
    const [realRoot, realDirectory] = await Promise.all([realpath(workspace.rootPath), realpath(directoryPath)])
    if (!isPathInsideRoot(realRoot, realDirectory) || !(await stat(realDirectory)).isDirectory()) {
      throw new Error('Workspace document resolves outside the workspace.')
    }
    return realDirectory
  }
}

export function previewUrlForDocument(workspaceId: string, relativePath: string): string {
  return `${PREVIEW_PROTOCOL}://${encodeURIComponent(workspaceId)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

export function bridgePreviewHtml(html: string, baseHref: string): string {
  return injectPreviewMarkdownLinkBridge(ensurePreviewBaseTag(html, baseHref))
}

export function mimeTypeForDocument(relativePath: string): string {
  const lower = relativePath.toLowerCase()
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown; charset=utf-8'
  if (lower.endsWith('.css')) return 'text/css; charset=utf-8'
  if (lower.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.woff2')) return 'font/woff2'
  if (lower.endsWith('.woff')) return 'font/woff'
  return 'application/octet-stream'
}

function normalizeDocumentIntent(value: string): string | null {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null
  if (isAbsolute(value) || /^[\\/]/.test(value) || /^[a-zA-Z]:/.test(value)) return null

  const rawParts = value.replace(/\\/g, '/').split('/')
  const parts: string[] = []
  for (const rawPart of rawParts) {
    if (!rawPart || rawPart === '.') continue
    let part: string
    try {
      part = decodeURIComponent(rawPart)
    } catch {
      return null
    }
    if (!part || part === '.' || part === '..' || part.includes('/') || part.includes('\\') || part.includes('\0')) return null
    if (parts.length === 0 && /^[a-zA-Z]:$/.test(part)) return null
    parts.push(part)
  }
  return parts.length > 0 ? parts.join('/') : null
}

function isWorkspaceMarkdownPathAllowed(rootPath: string, document: ResolvedWorkspaceDocument): boolean {
  if (!document.relativePath.toLowerCase().endsWith('.md')) return false
  if (ROOT_MARKDOWN_DOCUMENTS.has(document.relativePath)) return true
  return isInsideOneOf(rootPath, MARKDOWN_DOCUMENT_DIRECTORIES, document.absolutePath)
}

function isInsideOneOf(rootPath: string, directories: string[], absolutePath: string): boolean {
  return directories.some((directory) => isPathInsideRoot(resolve(rootPath, directory), absolutePath))
}

function titleFromMarkdown(content: string, relativePath: string): string {
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]
  return String(heading ?? titleFromMarkdownPath(relativePath)).replace(/\s+/g, ' ').trim()
}

function titleFromMarkdownPath(relativePath: string): string {
  const name = basename(relativePath)
  if (ROOT_MARKDOWN_DOCUMENTS.has(name)) return name.replace(/\.md$/i, '')
  return name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ')
}
