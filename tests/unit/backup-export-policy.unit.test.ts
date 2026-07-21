import { describe, expect, it } from 'vitest'

import {
  DISPOSABLE_PROJECTION_PATHS,
  LOCAL_DATA_INDEX_BASENAME,
  MUST_BACKUP_USER_DATA_PATHS,
  MUST_BACKUP_WORKSPACE_PATHS,
  decideWorkspaceExportPath,
  formatBackupPolicySummary,
  isDisposableProjectionPath,
  isMustBackupPath,
  listDefaultExportExclusions,
  shouldIncludeInDefaultExport
} from '../../src/shared/backup-export-policy'

describe('backup-export-policy (DB-P1-5)', () => {
  it('classifies must-backup workspace and user-data paths', () => {
    expect(isMustBackupPath('MISSION.md')).toBe(true)
    expect(isMustBackupPath('courses/physics/lesson/0001.html')).toBe(true)
    expect(isMustBackupPath('learning-sessions/session-1/session.json')).toBe(true)
    expect(isMustBackupPath('memory/learner.json')).toBe(true)
    expect(isMustBackupPath('.studiumx/learning-work.jsonl')).toBe(true)
    expect(isMustBackupPath('.studiumx/approval-receipts.jsonl')).toBe(true)

    expect(isMustBackupPath('studiumx-settings.json', 'user_data')).toBe(true)
    expect(isMustBackupPath('workspaces.json', 'user_data')).toBe(true)

    expect(MUST_BACKUP_WORKSPACE_PATHS.length).toBeGreaterThan(0)
    expect(MUST_BACKUP_USER_DATA_PATHS.length).toBeGreaterThan(0)
  })

  it('classifies studiumx-index.sqlite and caches as disposable', () => {
    expect(isDisposableProjectionPath(LOCAL_DATA_INDEX_BASENAME)).toBe(true)
    expect(isDisposableProjectionPath('studiumx-index.sqlite-wal')).toBe(true)
    expect(isDisposableProjectionPath('studiumx-index.sqlite-shm')).toBe(true)
    expect(isDisposableProjectionPath('studiumx-index.sqlite.quarantined-1-abc')).toBe(true)
    expect(isDisposableProjectionPath('analytics/other.sqlite')).toBe(true)
    expect(isDisposableProjectionPath('Cache/foo')).toBe(true)
    expect(isDisposableProjectionPath('studiumx.log')).toBe(true)
    expect(DISPOSABLE_PROJECTION_PATHS.some((e) => e.pattern.includes('studiumx-index'))).toBe(true)
  })

  it('excludes projections by default from workspace export', () => {
    expect(shouldIncludeInDefaultExport('MISSION.md')).toBe(true)
    expect(shouldIncludeInDefaultExport('.studiumx/learning-work.jsonl')).toBe(true)
    expect(shouldIncludeInDefaultExport('studiumx-index.sqlite')).toBe(false)
    expect(shouldIncludeInDefaultExport('studiumx-index.sqlite-wal')).toBe(false)
    expect(shouldIncludeInDefaultExport('GPUCache/x')).toBe(false)

    const excluded = listDefaultExportExclusions()
    expect(excluded).toContain('studiumx-index.sqlite')
  })

  it('marks optional projection include as untrusted debug-only', () => {
    const decision = decideWorkspaceExportPath('studiumx-index.sqlite', { includeProjections: true })
    expect(decision.include).toBe(true)
    expect(decision.untrustedProjection).toBe(true)
    expect(decision.class).toBe('disposable_projection')
    expect(decision.reason.toLowerCase()).toMatch(/untrusted|debug/)

    const defaultDecision = decideWorkspaceExportPath('studiumx-index.sqlite')
    expect(defaultDecision.include).toBe(false)
    expect(defaultDecision.untrustedProjection).toBe(true)
  })

  it('provides operator-facing summary text', () => {
    const summary = formatBackupPolicySummary()
    expect(summary).toMatch(/MUST backup/i)
    expect(summary).toMatch(/DISPOSABLE/i)
    expect(summary).toMatch(/studiumx-index\.sqlite/)
    expect(summary).toMatch(/includeProjections/)
  })
})
