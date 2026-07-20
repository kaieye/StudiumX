import { describe, expect, it } from 'vitest'
import { resolveE2ECrashPoint } from '../../src/main/teaching-workspace'

describe('resolveE2ECrashPoint', () => {
  it('rejects crash seam outside explicit E2E test runtime', () => {
    expect(resolveE2ECrashPoint({ NODE_ENV: 'production', STUDIUMX_E2E_CRASH_POINT: 'after_record_publish' })).toBeUndefined()
    expect(resolveE2ECrashPoint({ NODE_ENV: 'test', STUDIUMX_TEST: '1', STUDIUMX_E2E_CRASH_POINT: 'after_record_publish' })).toBeUndefined()
    expect(resolveE2ECrashPoint({ NODE_ENV: 'test', STUDIUMX_TEST: '1', STUDIUMX_E2E: '1', STUDIUMX_E2E_CRASH_POINT: 'unknown' })).toBeUndefined()
  })

  it('accepts only whitelisted points in explicit E2E test runtime', () => {
    expect(resolveE2ECrashPoint({ NODE_ENV: 'test', STUDIUMX_TEST: '1', STUDIUMX_E2E: '1', STUDIUMX_E2E_CRASH_POINT: 'after_record_publish' })).toBe('after_record_publish')
  })
})
