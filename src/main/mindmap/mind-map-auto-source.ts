/**
 * Intent-driven workspace Markdown context for mind-map generation.
 *
 * The renderer never enumerates or selects source paths for this flow. Instead,
 * the main process first looks for Markdown files whose directory or file names
 * are explicitly mentioned in the user's prompt. A prompt that explicitly asks
 * to read the current folder/workspace can instead select the bounded discovered
 * Markdown set. Every selected file still passes through the existing contained-
 * regular-file boundary. Source bodies remain provider-only and are never
 * returned to renderer IPC DTOs.
 */
import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  MIND_MAP_SELECTED_FILE_MAX_BYTES,
  MindMapSelectedFileError,
  resolveSelectedMindMapFile,
  type MindMapSelectedFileContext
} from './mind-map-selected-file'

/** Limit automatic discovery before any provider context is assembled. */
export const MIND_MAP_AUTO_SOURCE_MAX_DISCOVERED_FILES = 300
/** Never recurse indefinitely through an unusually deep workspace. */
export const MIND_MAP_AUTO_SOURCE_MAX_DEPTH = 8
/** A prompt can attach several related Markdown files, but never an unbounded folder. */
export const MIND_MAP_AUTO_SOURCE_MAX_FILES = 24
/** Total provider-only source body budget for automatic folder context. */
export const MIND_MAP_AUTO_SOURCE_MAX_TOTAL_BYTES = MIND_MAP_SELECTED_FILE_MAX_BYTES * 2

const MARKDOWN_FILE_PATTERN = /\.(?:md|markdown|mdx)$/iu
const CURRENT_WORKSPACE_SOURCE_SCOPES = [
  '当前文件夹',
  '当前目录',
  '这个文件夹',
  '这个目录',
  '本文件夹',
  '本目录',
  '此文件夹',
  '此目录'
] as const
const GENERIC_WORKSPACE_SOURCE_CONTENT_PHRASES = [
  '文件夹内容',
  '目录内容',
  '文件夹中的内容',
  '文件夹里的内容',
  '目录中的内容',
  '目录里的内容',
  '文件夹中的资料',
  '文件夹里的资料',
  '目录中的资料',
  '目录里的资料',
  '文件夹中的文档',
  '文件夹里的文档',
  '目录中的文档',
  '目录里的文档'
] as const
const CURRENT_WORKSPACE_SOURCE_ROOTS = [
  '当前工作区',
  '工作区'
] as const
const CURRENT_WORKSPACE_SOURCE_NOUNS = [
  '文件',
  '资料',
  '内容',
  '文档',
  '笔记',
  'markdown',
  'md'
] as const
const CURRENT_WORKSPACE_SOURCE_INTENTS = [
  '查看',
  '读取',
  '阅读',
  '浏览',
  '检查',
  '根据',
  '基于',
  '参考',
  '使用',
  '结合',
  '来自',
  '来源'
] as const
const ENGLISH_WORKSPACE_SOURCE_SCOPE_PATTERN =
  /\b(?:(?:current|this)\s+(?:folder|directory)|workspace)\b/iu
const ENGLISH_WORKSPACE_SOURCE_CONTENT_PATTERN =
  /\b(?:folder|directory)\s+(?:contents?|files?|documents?|notes?)|\b(?:files?|documents?|notes?)\s+in\s+(?:the\s+)?(?:folder|directory)\b/iu
const ENGLISH_WORKSPACE_SOURCE_INTENT_PATTERN =
  /\b(?:read|inspect|review|scan|browse|analy[sz]e|use|using|from|reference)\b/iu
const IGNORED_DIRECTORY_NAMES = new Set([
  '.agent-sessions',
  '.git',
  '.studiumx',
  'node_modules',
  'out',
  'dist',
  'release'
])

/**
 * Main-process-only source bundle assembled from prompt-matched workspace files.
 * Every file has already passed the hardened bounded reader; contents must never
 * be copied into a public IPC DTO.
 */
export type MindMapAutoSourceContext = {
  files: readonly MindMapSelectedFileContext[]
  byteLength: number
}

export type MindMapAutoSourceResolutionOptions = {
  maxDiscoveredFiles?: number
  maxDepth?: number
  maxFiles?: number
  maxTotalBytes?: number
}

/**
 * Resolve Markdown source files from names explicitly present in a user prompt.
 *
 * A directory-name match includes Markdown files recursively below that folder;
 * a file-name match includes that one file. When no concrete path matches, an
 * explicit request to inspect/read the current folder or workspace selects the
 * bounded discovered Markdown set. Other prompts still read no workspace content.
 * Discovery failures intentionally degrade to prompt-only generation because
 * automatic source context is an enhancement, not a reason to prevent the
 * learner from creating a map.
 */
export async function resolveMindMapAutoSourceContext(
  workspaceRoot: string,
  prompt: string,
  options: MindMapAutoSourceResolutionOptions = {}
): Promise<MindMapAutoSourceContext | undefined> {
  const normalizedPrompt = normalizeIntentText(prompt)
  if (!normalizedPrompt) return undefined

  const maxDiscoveredFiles = validLimit(
    options.maxDiscoveredFiles,
    MIND_MAP_AUTO_SOURCE_MAX_DISCOVERED_FILES
  )
  const maxDepth = validLimit(options.maxDepth, MIND_MAP_AUTO_SOURCE_MAX_DEPTH)
  const maxFiles = validLimit(options.maxFiles, MIND_MAP_AUTO_SOURCE_MAX_FILES)
  const maxTotalBytes = validLimit(
    options.maxTotalBytes,
    MIND_MAP_AUTO_SOURCE_MAX_TOTAL_BYTES
  )
  const candidates = await discoverMarkdownWorkspacePaths(
    workspaceRoot,
    maxDepth,
    maxDiscoveredFiles
  )
  const explicitMatches = matchMindMapPromptMarkdownPaths(normalizedPrompt, candidates)
  const selectedPaths = (
    explicitMatches.length > 0
      ? explicitMatches
      : requestsCurrentWorkspaceSources(prompt)
        ? candidates
        : []
  ).slice(0, maxFiles)
  if (selectedPaths.length === 0) return undefined

  const files: MindMapSelectedFileContext[] = []
  let byteLength = 0
  for (const workspacePath of selectedPaths) {
    const remainingBytes = maxTotalBytes - byteLength
    if (remainingBytes <= 0) break
    try {
      const file = await resolveSelectedMindMapFile(workspaceRoot, workspacePath, remainingBytes)
      files.push(file)
      byteLength += file.byteLength
    } catch (error) {
      // A file can disappear, become a link, or exceed the remaining context
      // budget after discovery. Skip it rather than letting automatic matching
      // turn a normal generation request into a filesystem error.
      if (error instanceof MindMapSelectedFileError) continue
      return files.length > 0 ? { files, byteLength } : undefined
    }
  }

  return files.length > 0 ? { files, byteLength } : undefined
}

/**
 * Pure, deterministic prompt-to-path matcher. Exported for narrow regression
 * tests; callers must still resolve every returned path through the hardened
 * regular-file reader before accessing bytes.
 */
export function matchMindMapPromptMarkdownPaths(
  prompt: string,
  workspacePaths: readonly string[]
): string[] {
  const normalizedPrompt = normalizeIntentText(prompt)
  if (!normalizedPrompt) return []

  const canonicalPaths = [...new Set(workspacePaths)]
    .filter((path) => MARKDOWN_FILE_PATTERN.test(path))
    .map((path) => path.replace(/\\/gu, '/'))
    .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' }))

  const matched = new Set<string>()
  for (const workspacePath of canonicalPaths) {
    const segments = workspacePath.split('/').filter(Boolean)
    const fileName = segments.at(-1)
    if (!fileName) continue
    const stem = fileName.replace(MARKDOWN_FILE_PATTERN, '')
    const pathWithoutExtension = workspacePath.replace(MARKDOWN_FILE_PATTERN, '')

    if (isMeaningfulMention(pathWithoutExtension, normalizedPrompt) || isMeaningfulMention(stem, normalizedPrompt)) {
      matched.add(workspacePath)
      continue
    }

    // A user saying “根据资料分析文件夹中的 Markdown …” should attach all
    // matching Markdown files below `资料分析/`, not force a separate picker.
    for (let index = 0; index < segments.length - 1; index += 1) {
      const directoryPath = segments.slice(0, index + 1).join('/')
      const directoryName = segments[index]!
      if (
        isMeaningfulMention(directoryPath, normalizedPrompt) ||
        isMeaningfulMention(directoryName, normalizedPrompt)
      ) {
        matched.add(workspacePath)
        break
      }
    }
  }

  return [...matched].sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' }))
}

async function discoverMarkdownWorkspacePaths(
  workspaceRoot: string,
  maxDepth: number,
  maxFiles: number
): Promise<string[]> {
  const root = resolve(workspaceRoot)
  const paths: string[] = []

  const visit = async (relativeDirectory: string, depth: number): Promise<void> => {
    if (paths.length >= maxFiles || depth > maxDepth) return

    let entries: Dirent[]
    try {
      entries = await readdir(join(root, relativeDirectory), { withFileTypes: true })
    } catch {
      return
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', {
      numeric: true,
      sensitivity: 'base'
    }))
    for (const entry of entries) {
      if (paths.length >= maxFiles) return
      const workspacePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (
          depth < maxDepth &&
          !entry.name.startsWith('.') &&
          !IGNORED_DIRECTORY_NAMES.has(entry.name)
        ) {
          await visit(workspacePath, depth + 1)
        }
        continue
      }
      if (entry.isFile() && MARKDOWN_FILE_PATTERN.test(entry.name)) paths.push(workspacePath)
    }
  }

  await visit('', 0)
  return paths
}

function normalizeIntentText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(MARKDOWN_FILE_PATTERN, '')
    .replace(/[\\/_.\-—–,，、:：;；“”"'‘’`()[\]{}<>《》]+/gu, '')
    .replace(/\s+/gu, '')
    .trim()
}

function isMeaningfulMention(candidate: string, normalizedPrompt: string): boolean {
  const normalizedCandidate = normalizeIntentText(candidate)
  if (!normalizedCandidate || !normalizedPrompt.includes(normalizedCandidate)) return false
  const hasCjk = /[\u3400-\u9fff]/u.test(normalizedCandidate)
  return hasCjk ? normalizedCandidate.length >= 2 : normalizedCandidate.length >= 3
}

/**
 * Keep the workspace-wide fallback conservative: a location phrase alone may
 * describe the output destination (for example, “save in the current folder”).
 * It becomes a source request only when the prompt also carries a read/reference
 * intent. The input is already normalized by `normalizeIntentText`.
 */
function requestsCurrentWorkspaceSources(prompt: string): boolean {
  const normalizedPrompt = normalizeIntentText(prompt)
  const hasFolderScope = CURRENT_WORKSPACE_SOURCE_SCOPES.some((scope) =>
    normalizedPrompt.includes(scope)
  )
  const hasGenericFolderContent = GENERIC_WORKSPACE_SOURCE_CONTENT_PHRASES.some((phrase) =>
    normalizedPrompt.includes(phrase)
  )
  const hasWorkspaceSource = CURRENT_WORKSPACE_SOURCE_ROOTS.some((scope) =>
    normalizedPrompt.includes(scope)
  ) && CURRENT_WORKSPACE_SOURCE_NOUNS.some((noun) => normalizedPrompt.includes(noun))
  const hasChineseSourceIntent = CURRENT_WORKSPACE_SOURCE_INTENTS.some((intent) =>
    normalizedPrompt.includes(intent)
  )
  if (hasGenericFolderContent) return true
  if ((hasFolderScope || hasWorkspaceSource) && hasChineseSourceIntent) return true

  const englishPrompt = prompt.normalize('NFKC').toLocaleLowerCase()
  return ENGLISH_WORKSPACE_SOURCE_CONTENT_PATTERN.test(englishPrompt) || (
    ENGLISH_WORKSPACE_SOURCE_SCOPE_PATTERN.test(englishPrompt) &&
    ENGLISH_WORKSPACE_SOURCE_INTENT_PATTERN.test(englishPrompt)
  )
}

function validLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0 ? value : fallback
}
