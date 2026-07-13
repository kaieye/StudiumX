import { lstat, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import type { Dirent } from 'node:fs'
import type { ToolEntry, ToolContext } from './registry'
import {
  prepareWorkspaceWriteTarget,
  resolveWorkspacePathTarget,
  toPosixWorkspacePath,
  verifyExistingWorkspaceTarget,
  verifyWrittenWorkspaceTarget
} from './workspace-path-target'

const MAX_FILE_BYTES = 512 * 1024
const MAX_READ_CHARS = 24_000
const MAX_WRITE_BYTES = 1024 * 1024
const DEFAULT_READ_LIMIT = 240
const MAX_READ_LIMIT = 800
const MAX_LIST_ENTRIES = 500
const MAX_SEARCH_MATCHES = 120
const MAX_GLOB_MATCHES = 500
const MAX_SEARCH_FILE_BYTES = 256 * 1024

const SKIPPED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.teachos',
  'node_modules',
  'dist',
  'out',
  'release',
  'build',
  '.vite',
  '.cache',
  '__pycache__',
  '.DS_Store',
  '.idea',
  '.vscode'
])

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.html',
  '.htm',
  '.js',
  '.json',
  '.jsonl',
  '.jsx',
  '.conf',
  '.cpp',
  '.cs',
  '.go',
  '.h',
  '.hpp',
  '.ini',
  '.java',
  '.kt',
  '.md',
  '.mdx',
  '.mjs',
  '.cjs',
  '.php',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml'
])

const SENSITIVE_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.npmrc',
  '.pypirc',
  '.netrc',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519'
])

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function jsonResult(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function jsonError(tool: string, error: unknown): string {
  return jsonResult({ tool, error: error instanceof Error ? error.message : String(error) })
}

function shouldSkipDir(name: string): boolean {
  return SKIPPED_DIRS.has(name) || name.startsWith('.')
}

function isSensitiveFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    SENSITIVE_FILE_NAMES.has(lower) ||
    lower.startsWith('.env.') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key') ||
    lower.endsWith('.p12') ||
    lower.endsWith('.pfx') ||
    lower.includes('secret') ||
    lower.includes('credential')
  )
}

function isProtectedWorkspaceRelativePath(relativePath: string): boolean {
  if (!relativePath || relativePath === '.') return false
  const parts = toPosixWorkspacePath(relativePath)
    .split('/')
    .filter(Boolean)
  if (parts.some((part) => shouldSkipDir(part))) return true
  const leaf = parts[parts.length - 1] ?? ''
  return Boolean(leaf && isSensitiveFileName(leaf))
}

/**
 * Lesson pages must go through the generate_lesson pipeline (stable
 * numbering, template rendering, index registration). Large hand-written
 * HTML through a single tool call is also the most fragile spot for weaker
 * providers' tool-call serialization.
 */
function isLessonHtmlRelativePath(relativePath: string): boolean {
  const posix = toPosixWorkspacePath(relativePath).replace(/^\.\//, '').toLowerCase()
  return posix.startsWith('lessons/') && /\.html?$/.test(posix)
}

function isLikelyTextPath(path: string): boolean {
  const ext = extname(path).toLowerCase()
  return !ext || TEXT_EXTENSIONS.has(ext)
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)
}

async function readTextFile(path: string, maxBytes = MAX_FILE_BYTES): Promise<string> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error('目标不是文件。')
  if (info.size > maxBytes) {
    throw new Error(`文件过大（${info.size} bytes），已超过 ${maxBytes} bytes 上限。`)
  }
  const buffer = await readFile(path)
  if (isBinaryBuffer(buffer)) throw new Error('检测到二进制文件，拒绝作为文本读取。')
  return buffer.toString('utf8')
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function lstatIfExists(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

function lineWindow(text: string, offset: number, limit: number): {
  lines: string[]
  totalLines: number
  nextOffset: number | null
} {
  const all = text.split(/\r?\n/)
  const start = Math.min(Math.max(0, offset), all.length)
  const shown = all.slice(start, start + limit)
  const nextOffset = start + shown.length < all.length ? start + shown.length : null
  const width = String(start + shown.length).length
  return {
    lines: shown.map((line, idx) => `${String(start + idx + 1).padStart(width, ' ')}| ${line}`),
    totalLines: all.length,
    nextOffset
  }
}

async function listDirectory(path: string, root: string, recursive: boolean): Promise<Array<{
  path: string
  kind: 'directory' | 'file'
  size?: number
}>> {
  const entries: Array<{ path: string; kind: 'directory' | 'file'; size?: number }> = []

  async function visit(current: string): Promise<void> {
    if (entries.length >= MAX_LIST_ENTRIES) return
    let dirents: Dirent[]
    try {
      dirents = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    dirents.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of dirents) {
      if (entries.length >= MAX_LIST_ENTRIES) return
      const absolute = join(current, entry.name)
      const rel = toPosixWorkspacePath(relative(root, absolute))
      if (isProtectedWorkspaceRelativePath(rel)) continue
      if (entry.isDirectory()) {
        entries.push({ path: `${rel}/`, kind: 'directory' })
        if (recursive) await visit(absolute)
      } else if (entry.isFile()) {
        const info = await stat(absolute).catch(() => null)
        entries.push({ path: rel, kind: 'file', size: info?.size })
      }
    }
  }

  await visit(path)
  return entries
}

async function walkFiles(root: string, start: string, onFile: (absolutePath: string, relativePath: string) => Promise<boolean | void>): Promise<void> {
  async function visit(current: string): Promise<boolean> {
    let dirents: Dirent[]
    try {
      dirents = await readdir(current, { withFileTypes: true })
    } catch {
      return false
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of dirents) {
      const absolute = join(current, entry.name)
      const rel = toPosixWorkspacePath(relative(root, absolute))
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue
        if (await visit(absolute)) return true
      } else if (entry.isFile()) {
        const shouldStop = await onFile(absolute, rel)
        if (shouldStop) return true
      }
    }
    return false
  }
  await visit(start)
}

function wildcardToRegExp(pattern: string): RegExp {
  let out = '^'
  const normalized = toPosixWorkspacePath(pattern).replace(/^\.\/+/, '')
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    const next = normalized[i + 1]
    if (ch === '*' && next === '*') {
      if (normalized[i + 2] === '/') {
        out += '(?:.*/)?'
        i += 2
      } else {
        out += '.*'
        i += 1
      }
    } else if (ch === '*') {
      out += '[^/]*'
    } else if (ch === '?') {
      out += '[^/]'
    } else {
      out += escapeRegExp(ch)
    }
  }
  out += '$'
  return new RegExp(out)
}

function normalizeGlobPattern(pattern: string): string {
  const raw = toPosixWorkspacePath(pattern.trim()).replace(/^\.\/+/, '')
  if (!raw) return '**/*'
  return raw.includes('/') ? raw : `**/${raw}`
}

function compileSearchPattern(pattern: string, regex: boolean): RegExp {
  if (!regex) return new RegExp(escapeRegExp(pattern), 'i')
  return new RegExp(pattern, 'i')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const listWorkspaceTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'list_workspace',
      description:
        '列出当前 StudiumX 教学工作区内的目录内容。只读、限定在当前工作区内；递归模式会跳过 .git、node_modules、构建输出和隐藏噪声目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作区路径，默认 "."' },
          recursive: { type: 'boolean', description: '是否递归列出子目录，默认 false' }
        }
      }
    }
  },
  handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
    try {
      const input = (args ?? {}) as { path?: string; recursive?: boolean }
      const target = resolveWorkspacePathTarget(ctx.workspaceRoot, input.path)
      if (isProtectedWorkspaceRelativePath(target.relativePath)) {
        throw new Error('该路径属于隐藏、构建或敏感文件范围，已拒绝读取。')
      }
      await verifyExistingWorkspaceTarget(target)
      const info = await stat(target.absolutePath)
      if (!info.isDirectory()) throw new Error('目标不是目录。')
      const entries = await listDirectory(target.absolutePath, target.root, input.recursive === true)
      return jsonResult({
        root: target.relativePath,
        recursive: input.recursive === true,
        count: entries.length,
        truncated: entries.length >= MAX_LIST_ENTRIES,
        entries
      })
    } catch (error) {
      return jsonError('list_workspace', error)
    }
  }
}

export const readWorkspaceFileTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'read_workspace_file',
      description:
        '读取当前 StudiumX 教学工作区内的文本文件。只读、限定在当前工作区内；支持 offset/limit 分页，并返回带行号的内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作区文件路径' },
          offset: { type: 'number', description: '0-based 起始行，默认 0', minimum: 0 },
          limit: { type: 'number', description: '最多返回行数，默认 240，最大 800', minimum: 1, maximum: 800 }
        },
        required: ['path']
      }
    }
  },
  handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
    try {
      const input = (args ?? {}) as { path?: string; offset?: number; limit?: number }
      if (!input.path?.trim()) throw new Error('缺少参数 path。')
      const target = resolveWorkspacePathTarget(ctx.workspaceRoot, input.path)
      if (isProtectedWorkspaceRelativePath(target.relativePath)) {
        throw new Error('该路径属于隐藏、构建或敏感文件范围，已拒绝读取。')
      }
      await verifyExistingWorkspaceTarget(target)
      const text = await readTextFile(target.absolutePath)
      const offset = clampInteger(input.offset, 0, Number.MAX_SAFE_INTEGER, 0)
      const limit = clampInteger(input.limit, 1, MAX_READ_LIMIT, DEFAULT_READ_LIMIT)
      const window = lineWindow(text, offset, limit)
      const content = window.lines.join('\n')
      return jsonResult({
        path: target.relativePath,
        totalLines: window.totalLines,
        offset,
        limit,
        nextOffset: window.nextOffset,
        content: content.slice(0, MAX_READ_CHARS),
        contentTruncated: content.length > MAX_READ_CHARS
      })
    } catch (error) {
      return jsonError('read_workspace_file', error)
    }
  }
}

export const writeWorkspaceFileTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'write_workspace_file',
      description:
        '写入当前 StudiumX 教学工作区内的文本文件。限定在当前工作区内；会自动创建父目录；默认不覆盖已有文件。适合维护 MISSION.md、RESOURCES.md、GLOSSARY.md、NOTES.md、reference/*.html、learning-records/*.md 等文件。注意：lessons/ 目录下的课程 HTML 不能用本工具写入，请改用 generate_lesson 工具（它会统一编号、渲染模板并登记到课程索引）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作区文件路径，例如 "reference/glossary.html"' },
          content: { type: 'string', description: '要写入的完整文本内容' },
          overwrite: { type: 'boolean', description: '是否允许覆盖已有文件，默认 false' }
        },
        required: ['path', 'content']
      }
    }
  },
  permission: {
    kind: 'workspace_write',
    describe: async (args: unknown, ctx: ToolContext) => {
      const input = (args ?? {}) as { path?: string; overwrite?: boolean }
      if (!input.path?.trim()) throw new Error('缺少参数 path。')
      const target = resolveWorkspacePathTarget(ctx.workspaceRoot, input.path)
      const existing = await lstatIfExists(target.absolutePath)
      return {
        operation: existing ? '覆盖工作区文件' : '创建工作区文件',
        targetPath: target.relativePath,
        reason: input.overwrite === true
          ? '模型请求覆盖已有教学资产。'
          : '模型请求写入新的教学资产。',
        creates: existing === null
      }
    }
  },
  handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
    try {
      const input = (args ?? {}) as { path?: string; content?: unknown; overwrite?: boolean }
      if (!input.path?.trim()) throw new Error('缺少参数 path。')
      if (typeof input.content !== 'string') throw new Error('缺少参数 content，且必须是字符串。')
      const target = resolveWorkspacePathTarget(ctx.workspaceRoot, input.path)
      if (isProtectedWorkspaceRelativePath(target.relativePath)) {
        throw new Error('该路径属于隐藏、构建或敏感文件范围，已拒绝写入。')
      }
      if (isLessonHtmlRelativePath(target.relativePath)) {
        throw new Error(
          '课程页面不能用 write_workspace_file 直接写入 lessons/ 目录。请调用 generate_lesson 工具生成本节课程，它会统一编号、套用课程模板并登记到课程索引。'
        )
      }
      if (!isLikelyTextPath(target.relativePath)) {
        throw new Error('仅允许写入文本文件类型。')
      }
      const bytes = Buffer.byteLength(input.content, 'utf8')
      if (bytes > MAX_WRITE_BYTES) {
        throw new Error(`写入内容过大（${bytes} bytes），已超过 ${MAX_WRITE_BYTES} bytes 上限。`)
      }

      const existing = await prepareWorkspaceWriteTarget(target)
      if (existing.kind === 'directory') throw new Error('目标路径是目录，不能写入为文件。')
      if (existing.kind === 'file' && input.overwrite !== true) {
        throw new Error('文件已存在；如需覆盖请传 overwrite: true。')
      }

      await writeFile(target.absolutePath, input.content, 'utf8')
      await verifyWrittenWorkspaceTarget(target)

      return jsonResult({
        path: target.relativePath,
        bytes,
        created: existing.exists === false,
        overwritten: existing.kind === 'file',
        message: `已写入 ${target.relativePath}`
      })
    } catch (error) {
      return jsonError('write_workspace_file', error)
    }
  }
}

export const searchWorkspaceTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'search_workspace',
      description:
        '在当前 StudiumX 教学工作区内搜索文本。只读、限定在当前工作区内；返回 path:line:text 形式的匹配，最多 120 条。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '要搜索的文本或正则表达式' },
          path: { type: 'string', description: '相对工作区文件或目录，默认 "."' },
          regex: { type: 'boolean', description: 'pattern 是否按正则表达式解释，默认 false' }
        },
        required: ['pattern']
      }
    }
  },
  handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
    try {
      const input = (args ?? {}) as { pattern?: string; path?: string; regex?: boolean }
      if (!input.pattern?.trim()) throw new Error('缺少参数 pattern。')
      const target = resolveWorkspacePathTarget(ctx.workspaceRoot, input.path)
      if (isProtectedWorkspaceRelativePath(target.relativePath)) {
        throw new Error('该路径属于隐藏、构建或敏感文件范围，已拒绝搜索。')
      }
      await verifyExistingWorkspaceTarget(target)
      const re = compileSearchPattern(input.pattern, input.regex === true)
      const matches: Array<{ path: string; line: number; text: string }> = []
      const searchFile = async (absolutePath: string, relativePath: string): Promise<boolean> => {
        if (!isLikelyTextPath(relativePath)) return false
        if (isProtectedWorkspaceRelativePath(relativePath)) return false
        const allowed = await verifyExistingWorkspaceTarget({ ...target, absolutePath, relativePath })
          .then(() => true)
          .catch(() => false)
        if (!allowed) return false
        const info = await stat(absolutePath).catch(() => null)
        if (!info?.isFile() || info.size > MAX_SEARCH_FILE_BYTES) return false
        const text = await readTextFile(absolutePath, MAX_SEARCH_FILE_BYTES).catch(() => '')
        if (!text) return false
        const lines = text.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          if (!re.test(lines[i])) continue
          matches.push({ path: relativePath, line: i + 1, text: lines[i].slice(0, 500) })
          re.lastIndex = 0
          if (matches.length >= MAX_SEARCH_MATCHES) return true
        }
        return false
      }
      const info = await stat(target.absolutePath)
      if (info.isFile()) {
        await searchFile(target.absolutePath, target.relativePath)
      } else if (info.isDirectory()) {
        await walkFiles(target.root, target.absolutePath, searchFile)
      } else {
        throw new Error('目标既不是文件也不是目录。')
      }
      return jsonResult({
        pattern: input.pattern,
        path: target.relativePath,
        regex: input.regex === true,
        count: matches.length,
        truncated: matches.length >= MAX_SEARCH_MATCHES,
        matches
      })
    } catch (error) {
      return jsonError('search_workspace', error)
    }
  }
}

export const globWorkspaceTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'glob_workspace',
      description:
        '按 glob 模式查找当前 StudiumX 教学工作区内的文件。支持 *、?、**，只返回相对路径，最多 500 条。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob 模式，例如 "**/*.md"、"lessons/**/*.html"' }
        },
        required: ['pattern']
      }
    }
  },
  handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
    try {
      const input = (args ?? {}) as { pattern?: string }
      if (!input.pattern?.trim()) throw new Error('缺少参数 pattern。')
      const root = await realpath(resolveWorkspacePathTarget(ctx.workspaceRoot, '.').root)
      const pattern = normalizeGlobPattern(input.pattern)
      const re = wildcardToRegExp(pattern)
      const matches: string[] = []
      await walkFiles(root, root, async (_absolutePath, relativePath) => {
        if (isProtectedWorkspaceRelativePath(relativePath)) return false
        if (re.test(relativePath)) matches.push(relativePath)
        return matches.length >= MAX_GLOB_MATCHES
      })
      return jsonResult({
        pattern,
        count: matches.length,
        truncated: matches.length >= MAX_GLOB_MATCHES,
        matches
      })
    } catch (error) {
      return jsonError('glob_workspace', error)
    }
  }
}

export const workspaceReadTools = [
  listWorkspaceTool,
  readWorkspaceFileTool,
  searchWorkspaceTool,
  globWorkspaceTool
] satisfies ToolEntry[]

export const workspaceTools = [
  ...workspaceReadTools,
  writeWorkspaceFileTool
] satisfies ToolEntry[]
