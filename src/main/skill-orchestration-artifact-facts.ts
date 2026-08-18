/**
 * Read-only workspace artifact fact derivation for skill orchestration (ADR-0014).
 *
 * Maps host-registry artifact scopes onto the workspace filesystem so the pure
 * planner can consume real `availableArtifacts` instead of placeholder facts.
 * Fail-soft and bounded: any error yields an empty fact list, never a throw.
 * This module has zero settlement / ledger / Evidence authority.
 */

import { readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { listBuiltinSkillOrchestrationPolicies } from './builtin-skill-orchestration-policy'

const MAX_SCAN_ENTRIES = 2000
const MAX_SCAN_DEPTH = 6

const FILE_DETECTABLE_ROLES = new Set([
  'artifact_producer',
  'cross_cutting_enhancer',
  'variant_producer',
  'packager'
])

export type WorkspaceArtifactFactScope = {
  artifact: string
  scopes: string[]
}

/**
 * Registry-derived detection table: artifact token → declared file scopes.
 * Only file-backed producer/enhancer/variant/packager outputs are detectable;
 * strategy metadata (rubrics, plans) is intentionally not a filesystem fact.
 */
export function listDetectableArtifactScopes(): WorkspaceArtifactFactScope[] {
  const byArtifact = new Map<string, Set<string>>()
  for (const entry of listBuiltinSkillOrchestrationPolicies()) {
    if (!FILE_DETECTABLE_ROLES.has(entry.role)) continue
    if (entry.artifactScopes.length === 0 || entry.produces.length === 0) continue
    for (const artifact of entry.produces) {
      const scopes = byArtifact.get(artifact) ?? new Set<string>()
      for (const scope of entry.artifactScopes) scopes.add(scope)
      byArtifact.set(artifact, scopes)
    }
  }
  return [...byArtifact.entries()]
    .map(([artifact, scopes]) => ({ artifact, scopes: [...scopes].sort() }))
    .sort((left, right) => left.artifact.localeCompare(right.artifact))
}

/**
 * Convert a registry scope glob (`*` within a segment, trailing `**`) into an
 * anchored RegExp over workspace-relative POSIX paths. Deterministic; no I/O.
 */
export function scopeToRegExp(scope: string): RegExp {
  const segments = String(scope ?? '').split('/')
  const parts: string[] = []
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    if (segment === '**') {
      // Trailing ** matches at least one path segment below the prefix.
      parts.push('.+')
      continue
    }
    parts.push(
      segment
        .split('*')
        .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*')
    )
  }
  return new RegExp(`^${parts.join('/')}$`)
}

/**
 * Derive available artifact tokens from real workspace files. Walks only the
 * top-level directories referenced by registry scopes, with entry/depth caps
 * and symlink refusal. Errors are fail-soft (skip, never throw).
 */
export async function deriveWorkspaceArtifactFacts(
  workspaceRoot: string | null | undefined
): Promise<string[]> {
  const root = String(workspaceRoot ?? '').trim()
  if (!root) return []

  const table = listDetectableArtifactScopes()
  if (table.length === 0) return []

  const scopeRoots = new Set<string>()
  for (const entry of table) {
    for (const scope of entry.scopes) {
      const first = scope.split('/')[0]
      if (first && !first.includes('*')) scopeRoots.add(first)
    }
  }

  const files: string[] = []
  for (const scopeRoot of [...scopeRoots].sort()) {
    await collectFiles(root, scopeRoot, 1, files)
    if (files.length >= MAX_SCAN_ENTRIES) break
  }
  if (files.length === 0) return []

  const found = new Set<string>()
  for (const entry of table) {
    const patterns = entry.scopes.map(scopeToRegExp)
    if (files.some((file) => patterns.some((pattern) => pattern.test(file)))) {
      found.add(entry.artifact)
    }
  }
  return [...found].sort()
}

async function collectFiles(
  workspaceRoot: string,
  relativePath: string,
  depth: number,
  out: string[]
): Promise<void> {
  if (depth > MAX_SCAN_DEPTH || out.length >= MAX_SCAN_ENTRIES) return
  const absolute = join(workspaceRoot, ...relativePath.split('/'))
  let info
  try {
    info = await lstat(absolute)
  } catch {
    return
  }
  if (info.isSymbolicLink()) return
  if (info.isFile()) {
    if (info.size > 0) out.push(relativePath)
    return
  }
  if (!info.isDirectory()) return
  let entries: string[]
  try {
    entries = await readdir(absolute)
  } catch {
    return
  }
  for (const entry of entries.sort()) {
    if (out.length >= MAX_SCAN_ENTRIES) return
    if (entry.startsWith('.')) continue
    await collectFiles(workspaceRoot, `${relativePath}/${entry}`, depth + 1, out)
  }
}
