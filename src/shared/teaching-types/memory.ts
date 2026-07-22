export type TeachingMemoryScope = 'user' | 'workspace' | 'project'

/**
 * Stable teaching-memory kind taxonomy (DB-P1-2).
 * Canonical file records may set optional `memoryKind`; tags remain the durable
 * compatibility path. Projection/catalog resolve kind from `memoryKind` first,
 * then stable tags, then an unspecified fallback.
 */
export type TeachingMemoryKind =
  | 'learner-profile'
  | 'teaching-experience'
  | 'episodic-session'
  | 'teaching-synthetic'

export const TEACHING_MEMORY_KINDS: readonly TeachingMemoryKind[] = [
  'learner-profile',
  'teaching-experience',
  'episodic-session',
  'teaching-synthetic'
] as const

/** Stable tag strings that map 1:1 onto TeachingMemoryKind. */
export const TEACHING_MEMORY_KIND_TAGS: Readonly<Record<TeachingMemoryKind, string>> = {
  'learner-profile': 'learner-profile',
  'teaching-experience': 'teaching-experience',
  'episodic-session': 'episodic-session',
  'teaching-synthetic': 'teaching-synthetic'
}

export type TeachingMemoryStatus = 'active' | 'disabled' | 'deleted'

export type TeachingMemoryRecord = {
  id: string
  content: string
  scope: TeachingMemoryScope
  workspace?: string
  project?: string
  sourceLessonId?: string
  /**
   * Optional explicit memory kind. When absent, consumers resolve from stable
   * tags (`learner-profile` / `teaching-experience` / `episodic-session` /
   * `teaching-synthetic`). File truth remains JSON; this field is metadata only.
   */
  memoryKind?: TeachingMemoryKind
  tags: string[]
  confidence: number
  createdAt: string
  updatedAt: string
  /** Main-process-only opaque mutation correlation metadata. */
  traceId?: string
  disabledAt?: string
  deletedAt?: string
}

/** Renderer-safe aggregate only; it intentionally excludes paths, IDs, content, and hashes. */
export type TeachingMemoryLegacyMigrationPreflight = {
  legacyFlatEligibleCount: number
  alreadyPartitionedCount: number
  blockedDuplicateCount: number
  blockedRecoveryIssueCount: number
  migrationReady: boolean
}

/**
 * Main-only readonly dry-run dispositions. These never authorize copy, hold,
 * publish, or legacy delete. `preview_only` means the dry-run completed without
 * mutating Memory; it is not destructive consent.
 */
export type TeachingMemoryLegacyMigrationDryRunDisposition =
  | 'preview_only'
  | 'not_ready'
  | 'not_authorized'
  | 'blocked'
  | 'expired'
  | 'busy'

/** Aggregate access class only; never includes workspace/project roots or paths. */
export type TeachingMemoryLegacyMigrationDryRunAccessClass = 'catalog' | 'workspace' | 'project'

/**
 * Short-lived aggregate-only intent preview. Opaque `intentId` values are not
 * destructive authorization, reservation, or retry keys for real migration.
 */
export type TeachingMemoryLegacyMigrationDryRunIntentPreview = {
  intentId: string
  createdAt: string
  expiresAt: string
  authorizationClass: 'readonly_preview_only'
  accessClass: TeachingMemoryLegacyMigrationDryRunAccessClass
  disposition: TeachingMemoryLegacyMigrationDryRunDisposition
  preflight: TeachingMemoryLegacyMigrationPreflight
  /** Always false for this slice; destructive migration remains unapproved. */
  destructiveAuthorized: false
  /** Always false; dry-run never mutates Memory bytes, mtimes, or layout. */
  memoryMutated: false
}

/**
 * Aggregate-only receipt preview for a completed readonly dry-run. It records
 * that only preview work occurred and never grants destructive authority.
 */
export type TeachingMemoryLegacyMigrationDryRunReceiptPreview = {
  intentId: string
  createdAt: string
  completedAt: string
  authorizationClass: 'readonly_preview_only'
  accessClass: TeachingMemoryLegacyMigrationDryRunAccessClass
  disposition: TeachingMemoryLegacyMigrationDryRunDisposition
  preflight: TeachingMemoryLegacyMigrationPreflight
  destructiveAuthorized: false
  memoryMutated: false
}

export type TeachingMemoryDiagnostics = {
  enabled: boolean
  activeCount: number
  tombstoneCount: number
  lastInjectedCount: number
  legacyMigrationPreflight: TeachingMemoryLegacyMigrationPreflight
  /**
   * Honest I/O profile for this host (ADR-0126). Never renamed to strict/CAS
   * on Windows; `windows_direct_path_non_cas` means limited non-CAS persistence.
   */
  platformIoProfile?: 'posix_descriptor_strict' | 'windows_direct_path_non_cas' | 'unavailable'
  platformCapabilityCode?: string
  platformCapabilityMessageKey?: string
}

export type CreateTeachingMemoryPayload = {
  content: string
  scope: TeachingMemoryScope
  /** Optional kind; also inferred from tags when omitted. */
  memoryKind?: TeachingMemoryKind
  tags?: string[]
  confidence?: number
  workspaceRoot?: string
}

export type UpdateTeachingMemoryPayload = {
  content?: string
  memoryKind?: TeachingMemoryKind
  tags?: string[]
  confidence?: number
  disabled?: boolean
  workspaceRoot?: string
}

export type TeachingMemoryCaptureResult = {
  action: 'created' | 'requested_consent' | 'approved' | 'rejected' | 'none'
  candidateContent?: string
  memoryId?: string
}
