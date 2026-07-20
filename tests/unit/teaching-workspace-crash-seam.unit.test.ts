import { describe, expect, it } from 'vitest'
import { resolveE2ECrashPoint, isInitialCatalogReconcileOperation } from '../../src/main/teaching-workspace'

describe('resolveE2ECrashPoint', () => {
  it('rejects crash seam outside explicit E2E test runtime', () => {
    expect(resolveE2ECrashPoint({ NODE_ENV: 'production', STUDIUMX_E2E_CRASH_POINT: 'after_record_publish' })).toBeUndefined()
    expect(resolveE2ECrashPoint({ NODE_ENV: 'test', STUDIUMX_TEST: '1', STUDIUMX_E2E_CRASH_POINT: 'after_record_publish' })).toBeUndefined()
    expect(resolveE2ECrashPoint({ NODE_ENV: 'test', STUDIUMX_TEST: '1', STUDIUMX_E2E: '1', STUDIUMX_E2E_CRASH_POINT: 'unknown' })).toBeUndefined()
  })

describe('isInitialCatalogReconcileOperation', () => {
  it('skips only needs_practice operation and never correction or other points', () => {
    expect(isInitialCatalogReconcileOperation('before_catalog_reconcile', 'outcome-seq-1')).toBe(true)
    expect(isInitialCatalogReconcileOperation('before_catalog_reconcile', 'outcome-seq-2')).toBe(false)
    expect(isInitialCatalogReconcileOperation('after_stage_flush', 'outcome-seq-1')).toBe(false)
  })
})

  it('accepts only whitelisted points in explicit E2E test runtime', () => {
    expect(resolveE2ECrashPoint({ NODE_ENV: 'test', STUDIUMX_TEST: '1', STUDIUMX_E2E: '1', STUDIUMX_E2E_CRASH_POINT: 'after_record_publish' })).toBe('after_record_publish')
    expect(resolveE2ECrashPoint({ NODE_ENV: 'test', STUDIUMX_TEST: '1', STUDIUMX_E2E: '1', STUDIUMX_E2E_CRASH_POINT: 'before_catalog_reconcile' })).toBe('before_catalog_reconcile')
  })
})

