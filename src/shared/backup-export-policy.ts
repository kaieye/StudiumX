/**
 * Backup / export path policy (DB-P1-5).
 *
 * Classifies durable teaching paths as must-backup vs disposable projection.
 * Workspace export defaults exclude disposable projections; opt-in include
 * is debug-only and always marked untrusted.
 *
 * File-truth remains inviolable: SQLite is never authority (ADR-0012).
 */

export type BackupPathClass =
  | 'must_backup'
  | 'disposable_projection'
  | 'operational_cache'
  | 'settings_desensitize'
  | 'unknown'

export type BackupPathEntry = {
  /** Glob-ish relative path pattern from workspace root or user-data root. */
  pattern: string
  class: BackupPathClass
  /** Short operator-facing reason. */
  reason: string
}

/** Workspace-relative paths that must be included in backups. */
export const MUST_BACKUP_WORKSPACE_PATHS: readonly BackupPathEntry[] = [
  {
    pattern: 'MISSION.md',
    class: 'must_backup',
    reason: 'Teaching mission source of truth'
  },
  {
    pattern: 'courses/**',
    class: 'must_backup',
    reason: 'Lessons, resources, and conversation archives'
  },
  {
    pattern: 'learning-sessions/**',
    class: 'must_backup',
    reason: 'Canonical LearningSession ledger (ADR-0001)'
  },
  {
    pattern: 'memory/**',
    class: 'must_backup',
    reason: 'Scoped Memory catalog files (file-truth)'
  },
  {
    pattern: '.studiumx/learning-work.jsonl',
    class: 'must_backup',
    reason: 'Canonical learning-work JSONL active ledger'
  },
  {
    pattern: '.studiumx/learning-work.sealed-*.jsonl',
    class: 'must_backup',
    reason: 'Sealed learning-work segments (ADR-0012)'
  },
  {
    pattern: '.studiumx/approval-receipts.jsonl',
    class: 'must_backup',
    reason: 'Append-only high-risk approval receipts'
  },
  {
    pattern: '.studiumx/**/*.json',
    class: 'must_backup',
    reason: 'Workspace journals and durable JSON under .studiumx (non-sqlite)'
  }
] as const

/** App user-data paths that must be backed up (with secret handling). */
export const MUST_BACKUP_USER_DATA_PATHS: readonly BackupPathEntry[] = [
  {
    pattern: 'studiumx-settings.json',
    class: 'settings_desensitize',
    reason: 'Settings document; API keys must stay in platform secret storage / encrypted blobs — never paste plaintext keys into shareable backups'
  },
  {
    pattern: 'studiumx-settings.json.bak',
    class: 'settings_desensitize',
    reason: 'Verified settings predecessor backup (ADR-0012)'
  },
  {
    pattern: 'workspaces.json',
    class: 'must_backup',
    reason: 'Workspace registry (paths only; no projection authority)'
  },
  {
    pattern: 'workspaces.json.bak',
    class: 'must_backup',
    reason: 'Workspace registry predecessor backup'
  },
  {
    pattern: 'memory/**',
    class: 'must_backup',
    reason: 'App-scoped Memory files when present'
  },
  {
    pattern: 'conversations/**',
    class: 'must_backup',
    reason: 'Temporary / global conversation archives'
  }
] as const

/** Paths that are disposable projections or caches — default export exclude. */
export const DISPOSABLE_PROJECTION_PATHS: readonly BackupPathEntry[] = [
  {
    pattern: 'studiumx-index.sqlite',
    class: 'disposable_projection',
    reason: 'Rebuildable analytics projection (ADR-0012); safe to delete'
  },
  {
    pattern: 'studiumx-index.sqlite-wal',
    class: 'disposable_projection',
    reason: 'SQLite WAL sidecar for disposable index'
  },
  {
    pattern: 'studiumx-index.sqlite-shm',
    class: 'disposable_projection',
    reason: 'SQLite shared-memory sidecar for disposable index'
  },
  {
    pattern: 'studiumx-index.sqlite.quarantined-*',
    class: 'disposable_projection',
    reason: 'Quarantined damaged projection; rebuild recovers'
  },
  {
    pattern: '**/*.sqlite',
    class: 'disposable_projection',
    reason: 'Any SQLite under app-data/workspace is projection-only'
  },
  {
    pattern: '**/*.sqlite-wal',
    class: 'disposable_projection',
    reason: 'SQLite WAL is never canonical'
  },
  {
    pattern: '**/*.sqlite-shm',
    class: 'disposable_projection',
    reason: 'SQLite SHM is never canonical'
  },
  {
    pattern: '**/Cache/**',
    class: 'operational_cache',
    reason: 'Electron/Chromium cache'
  },
  {
    pattern: '**/Code Cache/**',
    class: 'operational_cache',
    reason: 'V8 code cache'
  },
  {
    pattern: '**/GPUCache/**',
    class: 'operational_cache',
    reason: 'GPU shader cache'
  },
  {
    pattern: 'studiumx.log',
    class: 'operational_cache',
    reason: 'Diagnostic log; mtime-purgeable; not learning authority'
  },
  {
    pattern: 'logs/**',
    class: 'operational_cache',
    reason: 'Operational logs'
  }
] as const

export const LOCAL_DATA_INDEX_BASENAME = 'studiumx-index.sqlite'

export type WorkspaceExportOptions = {
  /**
   * When true, include disposable projections (sqlite, caches) for debugging.
   * Default false. Included projections are always marked untrusted.
   */
  includeProjections?: boolean
}

export type WorkspaceExportPathDecision = {
  relativePath: string
  include: boolean
  class: BackupPathClass
  untrustedProjection: boolean
  reason: string
}

/** Normalize path separators for policy matching. */
export function normalizeExportRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

function basenameOf(path: string): string {
  const normalized = normalizeExportRelativePath(path)
  const parts = normalized.split('/')
  return parts[parts.length - 1] ?? normalized
}

function matchesSimpleGlob(pattern: string, path: string): boolean {
  const p = normalizeExportRelativePath(pattern)
  const target = normalizeExportRelativePath(path)

  // Exact
  if (p === target) return true

  // **/dir/** — directory tree anywhere in the path
  if (p.startsWith('**/') && p.endsWith('/**')) {
    const mid = p.slice(3, -3)
    if (!mid) return true
    return (
      target === mid ||
      target.startsWith(`${mid}/`) ||
      target.includes(`/${mid}/`) ||
      target.endsWith(`/${mid}`)
    )
  }

  // ** suffix: prefix/**
  if (p.endsWith('/**')) {
    const prefix = p.slice(0, -3)
    if (prefix === '') return true
    if (prefix.startsWith('**/')) {
      const mid = prefix.slice(3)
      return (
        target === mid ||
        target.startsWith(`${mid}/`) ||
        target.includes(`/${mid}/`) ||
        target.endsWith(`/${mid}`)
      )
    }
    return target === prefix || target.startsWith(`${prefix}/`)
  }

  // **/rest (file or path suffix)
  if (p.startsWith('**/')) {
    const rest = p.slice(3)
    if (rest.includes('*')) {
      return matchStar(rest, basenameOf(target)) || matchStar(rest, target)
    }
    return target === rest || target.endsWith(`/${rest}`)
  }

  if (p.includes('*')) {
    return matchStar(p, target) || matchStar(p, basenameOf(target))
  }

  return false
}

function matchStar(pattern: string, value: string): boolean {
  // Convert simple * and ? globs; treat remaining chars literally.
  let regex = '^'
  for (const ch of pattern) {
    if (ch === '*') regex += '.*'
    else if (ch === '?') regex += '.'
    else if (/[.+^${}()|\[\]\\]/.test(ch)) regex += `\\${ch}`
    else regex += ch
  }
  regex += '$'
  return new RegExp(regex, 'i').test(value)
}

function classifyDisposable(relativePath: string): BackupPathEntry | null {
  for (const entry of DISPOSABLE_PROJECTION_PATHS) {
    if (matchesSimpleGlob(entry.pattern, relativePath)) return entry
  }
  const base = basenameOf(relativePath).toLowerCase()
  if (
    base === LOCAL_DATA_INDEX_BASENAME ||
    base.startsWith(`${LOCAL_DATA_INDEX_BASENAME}.`) ||
    base.endsWith('.sqlite') ||
    base.endsWith('.sqlite-wal') ||
    base.endsWith('.sqlite-shm')
  ) {
    return {
      pattern: base,
      class: 'disposable_projection',
      reason: 'SQLite / index projection is rebuildable and disposable (ADR-0012)'
    }
  }
  if (base.includes('quarantined') && base.includes('sqlite')) {
    return {
      pattern: base,
      class: 'disposable_projection',
      reason: 'Quarantined projection'
    }
  }
  return null
}

function classifyMustBackup(relativePath: string, scope: 'workspace' | 'user_data'): BackupPathEntry | null {
  const list =
    scope === 'workspace' ? MUST_BACKUP_WORKSPACE_PATHS : MUST_BACKUP_USER_DATA_PATHS
  for (const entry of list) {
    if (matchesSimpleGlob(entry.pattern, relativePath)) return entry
  }
  return null
}

/**
 * Decide whether a relative path should be included in a workspace export.
 * Default: exclude disposable projections and operational caches.
 */
export function decideWorkspaceExportPath(
  relativePath: string,
  options: WorkspaceExportOptions = {},
  scope: 'workspace' | 'user_data' = 'workspace'
): WorkspaceExportPathDecision {
  const normalized = normalizeExportRelativePath(relativePath)
  const includeProjections = options.includeProjections === true

  const disposable = classifyDisposable(normalized)
  if (disposable) {
    if (includeProjections) {
      return {
        relativePath: normalized,
        include: true,
        class: disposable.class,
        untrustedProjection: true,
        reason: `${disposable.reason} Included only for debug; mark untrusted — never restore as authority.`
      }
    }
    return {
      relativePath: normalized,
      include: false,
      class: disposable.class,
      untrustedProjection: true,
      reason: `${disposable.reason} Excluded by default from export.`
    }
  }

  const must = classifyMustBackup(normalized, scope)
  if (must) {
    return {
      relativePath: normalized,
      include: true,
      class: must.class,
      untrustedProjection: false,
      reason: must.reason
    }
  }

  // Unknown workspace files default to include (user content) for workspace scope;
  // user-data unknowns default to exclude to avoid leaking caches/secrets.
  if (scope === 'workspace') {
    return {
      relativePath: normalized,
      include: true,
      class: 'unknown',
      untrustedProjection: false,
      reason: 'Unclassified workspace file; included as potential learner content'
    }
  }

  return {
    relativePath: normalized,
    include: false,
    class: 'unknown',
    untrustedProjection: false,
    reason: 'Unclassified user-data path; excluded by default'
  }
}

/** Default export filter: exclude projections. */
export function shouldIncludeInDefaultExport(
  relativePath: string,
  scope: 'workspace' | 'user_data' = 'workspace'
): boolean {
  return decideWorkspaceExportPath(relativePath, { includeProjections: false }, scope).include
}

export function isDisposableProjectionPath(relativePath: string): boolean {
  return classifyDisposable(normalizeExportRelativePath(relativePath)) !== null
}

export function isMustBackupPath(
  relativePath: string,
  scope: 'workspace' | 'user_data' = 'workspace'
): boolean {
  const decision = decideWorkspaceExportPath(relativePath, { includeProjections: false }, scope)
  return decision.include && (decision.class === 'must_backup' || decision.class === 'settings_desensitize')
}

/** Operator-facing short lines for doctor / GUIDE. */
export function formatBackupPolicySummary(): string {
  return [
    'Backup policy:',
    '- MUST backup: workspace teaching files, Memory files, learning-sessions, learning-work JSONL/segments, approval receipts; settings (desensitize secrets).',
    `- DISPOSABLE (safe to delete / rebuild): ${LOCAL_DATA_INDEX_BASENAME}* , quarantined projections, Electron caches, diagnostic logs.`,
    '- Export default: exclude disposable projections; optional includeProjections is debug-only and untrusted.'
  ].join('\n')
}

export function listDefaultExportExclusions(): readonly string[] {
  return DISPOSABLE_PROJECTION_PATHS.map((entry) => entry.pattern)
}
