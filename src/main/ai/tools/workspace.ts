import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Dirent } from 'node:fs'
import type { ToolEntry, ToolContext } from './registry'

const MAX_FILE_BYTES = 512 * 1024
const MAX_READ_CHARS = 24_000
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

type ResolvedWorkspacePath = {
  root: string
  absolutePath: string
  relativePath: string
}

function requireWorkspaceRoot(ctx: ToolContext): string {
  const root = ctx.workspaceRoot?.trim()
  if (!root) throw new Error('当前没有绑定教学工作区，无法读取工作区文件。')
  return resolve(root)
}

function resolveWorkspacePath(ctx: ToolContext, rawPath: unknown, fallback = '.'): ResolvedWorkspacePath {
  const root = requireWorkspaceRoot(ctx)
  const input = typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : fallback
  if (isAbsolute(input)) throw new Error('请使用相对工作区路径，不允许传入绝对路径。')
  const absolutePath = resolve(root, input)
  if (!isInside(root, absolutePath)) {
    throw new Error('路径超出当前教学工作区。')
  }
  const relativePath = toPosixPath(relative(root, absolutePath)) || '.'
  return { root, absolutePath, relativePath }
}

async function assertRealPathInside(rootPath: string, targetPath: string): Promise<void> {
  const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
  if (!isInside(realRoot, realTarget)) {
    throw new Error('路径经过符号链接后超出当前教学工作区。')
  }
}

function isInside(rootPath: string, targetPath: string): boolean {
  const relation = relative(resolve(rootPath), resolve(targetPath))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}

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
  const parts = toPosixPath(relativePath)
    .split('/')
    .filter(Boolean)
  if (parts.some((part) => shouldSkipDir(part))) return true
  const leaf = parts[parts.length - 1] ?? ''
  return Boolean(leaf && isSensitiveFileName(leaf))
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
      const rel = toPosixPath(relative(root, absolute))
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
      const rel = toPosixPath(relative(root, absolute))
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
  const normalized = toPosixPath(pattern).replace(/^\.\/+/, '')
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
  const raw = toPosixPath(pattern.trim()).replace(/^\.\/+/, '')
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
        '列出当前 TeachOS 教学工作区内的目录内容。只读、限定在当前工作区内；递归模式会跳过 .git、node_modules、构建输出和隐藏噪声目录。',
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
      const target = resolveWorkspacePath(ctx, input.path)
      if (isProtectedWorkspaceRelativePath(target.relativePath)) {
        throw new Error('该路径属于隐藏、构建或敏感文件范围，已拒绝读取。')
      }
      await assertRealPathInside(target.root, target.absolutePath)
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
        '读取当前 TeachOS 教学工作区内的文本文件。只读、限定在当前工作区内；支持 offset/limit 分页，并返回带行号的内容。',
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
      const target = resolveWorkspacePath(ctx, input.path)
      if (isProtectedWorkspaceRelativePath(target.relativePath)) {
        throw new Error('该路径属于隐藏、构建或敏感文件范围，已拒绝读取。')
      }
      await assertRealPathInside(target.root, target.absolutePath)
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

export const searchWorkspaceTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'search_workspace',
      description:
        '在当前 TeachOS 教学工作区内搜索文本。只读、限定在当前工作区内；返回 path:line:text 形式的匹配，最多 120 条。',
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
      const target = resolveWorkspacePath(ctx, input.path)
      if (isProtectedWorkspaceRelativePath(target.relativePath)) {
        throw new Error('该路径属于隐藏、构建或敏感文件范围，已拒绝搜索。')
      }
      await assertRealPathInside(target.root, target.absolutePath)
      const re = compileSearchPattern(input.pattern, input.regex === true)
      const matches: Array<{ path: string; line: number; text: string }> = []
      const searchFile = async (absolutePath: string, relativePath: string): Promise<boolean> => {
        if (!isLikelyTextPath(relativePath)) return false
        if (isProtectedWorkspaceRelativePath(relativePath)) return false
        const allowed = await assertRealPathInside(target.root, absolutePath)
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
        '按 glob 模式查找当前 TeachOS 教学工作区内的文件。支持 *、?、**，只返回相对路径，最多 500 条。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob 模式，例如 "**/*.md"、"courses/**/*.html"' }
        },
        required: ['pattern']
      }
    }
  },
  handler: async (args: unknown, ctx: ToolContext): Promise<string> => {
    try {
      const input = (args ?? {}) as { pattern?: string }
      if (!input.pattern?.trim()) throw new Error('缺少参数 pattern。')
      const root = await realpath(requireWorkspaceRoot(ctx))
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

export const workspaceTools = [
  listWorkspaceTool,
  readWorkspaceFileTool,
  searchWorkspaceTool,
  globWorkspaceTool
] satisfies ToolEntry[]
