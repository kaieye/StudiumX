/**
 * Controlled stdio workspace-root injection (ADR-0013).
 * Pure path policy — no secrets, no http/sse, default off unless granted.
 */

import { isAbsolute, resolve, sep } from 'node:path'

import type { UserMcpServerV1 } from '../../shared/mcp/types'

export type ResolveInjectedStdioServerResult = Readonly<{
  server: UserMcpServerV1
  injected: boolean
  effectiveArgs: readonly string[]
  /** Machine-readable skip/failure reason when not injected. */
  reason?: string
  /** Canonical absolute active root when injection was applied. */
  injectedRoot?: string
}>

/**
 * Resolve effective stdio spawn args for an MCP server under the active workspace.
 * Never mutates secrets; never injects into http/sse; never injects without grant.
 */
export function resolveInjectedStdioServer(
  server: UserMcpServerV1,
  activeWorkspaceRoot: string | null | undefined
): ResolveInjectedStdioServerResult {
  const baseArgs = server.args ?? []

  if (server.transport !== 'stdio') {
    return {
      server,
      injected: false,
      effectiveArgs: baseArgs,
      reason: 'not_stdio'
    }
  }

  if (server.workspaceRootInjection !== 'granted') {
    return {
      server,
      injected: false,
      effectiveArgs: baseArgs,
      reason: 'not_granted'
    }
  }

  const rawActive = typeof activeWorkspaceRoot === 'string' ? activeWorkspaceRoot.trim() : ''
  if (!rawActive) {
    return {
      server,
      injected: false,
      effectiveArgs: baseArgs,
      reason: 'no_active_root'
    }
  }

  const canonicalActive = canonicalizePath(rawActive)
  if (!canonicalActive) {
    return {
      server,
      injected: false,
      effectiveArgs: baseArgs,
      reason: 'not_absolute'
    }
  }

  if (server.scope === 'workspace') {
    const bound = server.workspaceRoot ? canonicalizePath(server.workspaceRoot) : null
    if (!bound || !isPathContained(canonicalActive, bound)) {
      return {
        server,
        injected: false,
        effectiveArgs: baseArgs,
        reason: 'workspace_scope_mismatch'
      }
    }
  }

  if (argsAlreadyContainPath(baseArgs, canonicalActive)) {
    return {
      server,
      injected: false,
      effectiveArgs: baseArgs,
      reason: 'already_present',
      injectedRoot: canonicalActive
    }
  }

  const effectiveArgs = [...baseArgs, canonicalActive]
  return {
    server: { ...server, args: effectiveArgs },
    injected: true,
    effectiveArgs,
    injectedRoot: canonicalActive
  }
}

/** Normalize to absolute resolved path; null if empty or not absolute after resolve. */
export function canonicalizePath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const resolved = resolve(trimmed)
  if (!isAbsolute(resolved)) return null
  // Drop trailing separators except root (/, C:\).
  if (resolved.length > 1 && (resolved.endsWith(sep) || resolved.endsWith('/'))) {
    return resolved.replace(/[/\\]+$/, '') || resolved
  }
  return resolved
}

/**
 * True when `candidate` equals `root` or is a path under `root`.
 * win32 comparisons are case-insensitive.
 */
export function isPathContained(candidate: string, root: string): boolean {
  const left = normalizeForCompare(candidate)
  const right = normalizeForCompare(root)
  if (left === right) return true
  const prefix = right.endsWith(sep) ? right : right + sep
  return left.startsWith(prefix)
}

function normalizeForCompare(value: string): string {
  const resolved = resolve(value)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved
}

function argsAlreadyContainPath(args: readonly string[], canonical: string): boolean {
  const target = normalizeForCompare(canonical)
  for (const arg of args) {
    if (typeof arg !== 'string' || !arg.trim()) continue
    // Exact path segment only — no substring / fuzzy match.
    try {
      const candidate = canonicalizePath(arg)
      if (candidate && normalizeForCompare(candidate) === target) return true
    } catch {
      // ignore non-path args
    }
    if (normalizeForCompare(arg) === target) return true
  }
  return false
}
