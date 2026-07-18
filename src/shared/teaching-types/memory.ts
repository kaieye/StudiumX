export type TeachingMemoryScope = 'user' | 'workspace' | 'project'

export type TeachingMemoryRecord = {
  id: string
  content: string
  scope: TeachingMemoryScope
  workspace?: string
  project?: string
  sourceLessonId?: string
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

export type TeachingMemoryDiagnostics = {
  enabled: boolean
  activeCount: number
  tombstoneCount: number
  lastInjectedCount: number
  legacyMigrationPreflight: TeachingMemoryLegacyMigrationPreflight
}

export type CreateTeachingMemoryPayload = {
  content: string
  scope: TeachingMemoryScope
  tags?: string[]
  confidence?: number
  workspaceRoot?: string
}

export type UpdateTeachingMemoryPayload = {
  content?: string
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
