/**
 * Strict tool-argument parsing shared by dispatcher and legacy execution adapters.
 */

export const TOOL_CANCELED_MESSAGE = '工具调用已取消。'

export class ToolArgumentParseError extends Error {
  readonly code = 'invalid_tool_arguments' as const

  constructor(message = '工具参数不是合法 JSON。') {
    super(message)
    this.name = 'ToolArgumentParseError'
  }
}

/**
 * Parse tool-call arguments.
 * Empty / whitespace-only input is treated as `{}`.
 * Illegal JSON fails with ToolArgumentParseError (no silent `{}`).
 */
export function parseToolArguments(raw: string): unknown {
  if (!raw || !raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new ToolArgumentParseError()
  }
}

/**
 * Canonical path key plus aliases models commonly emit (other agent toolkits).
 * Order matters: prefer the schema-documented `path` first.
 */
export const TOOL_PATH_ARG_KEYS = ['path', 'file_path', 'filepath', 'filePath'] as const

export type ToolPathArgResolution = {
  /** Trimmed relative path when a non-empty string was found. */
  path: string | undefined
  /** Which key supplied the value (diagnostics / tests). */
  sourceKey?: (typeof TOOL_PATH_ARG_KEYS)[number]
}

/**
 * Read a relative path from tool arguments.
 * Accepts canonical `path` and common aliases (`file_path`, `filepath`, `filePath`).
 * Empty strings are ignored; first non-empty match wins.
 */
export function readToolPathArg(args: unknown): ToolPathArgResolution {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { path: undefined }
  }
  const record = args as Record<string, unknown>
  for (const key of TOOL_PATH_ARG_KEYS) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    return { path: trimmed, sourceKey: key }
  }
  return { path: undefined }
}

/**
 * Require a non-empty path argument (with alias acceptance).
 * Throws a stable, non-path-leaking message when absent.
 */
export function requireToolPathArg(
  args: unknown,
  options?: { missingMessage?: string }
): string {
  const resolved = readToolPathArg(args)
  if (resolved.path) return resolved.path
  throw new Error(options?.missingMessage ?? missingToolPathMessage(args))
}

/**
 * Build a more actionable missing-path error when the model used an unknown key
 * or left path empty. Never echoes absolute paths or full arg dumps.
 */
export function missingToolPathMessage(args: unknown, locale: 'zh' | 'en' = 'zh'): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return locale === 'en' ? 'Missing path.' : '缺少参数 path。'
  }
  const record = args as Record<string, unknown>
  const presentAliases = TOOL_PATH_ARG_KEYS.filter((key) => key !== 'path' && key in record)
  if (presentAliases.length > 0) {
    // Alias keys were present but empty/non-string — still teach the canonical name.
    return locale === 'en'
      ? 'Missing path. Use the "path" parameter (aliases like file_path are also accepted when non-empty).'
      : '缺少参数 path。请使用 path（非空的 file_path 等别名也会被接受）。'
  }
  const nearMiss = ['file', 'target', 'targetPath', 'relativePath', 'pathname'].find((key) => key in record)
  if (nearMiss) {
    return locale === 'en'
      ? `Missing path. Use "path" (not "${nearMiss}").`
      : `缺少参数 path。请使用 path（不要使用 ${nearMiss}）。`
  }
  return locale === 'en' ? 'Missing path.' : '缺少参数 path。'
}
