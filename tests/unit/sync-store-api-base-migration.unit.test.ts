import { beforeEach, describe, expect, it, vi } from 'vitest'

const SYNC_STORAGE_KEY = 'studiumx.sync'
const LEGACY_LOCAL_API_BASE = 'http://localhost:3000'
const PRODUCTION_API_BASE = 'https://api.studiumx.cn'

async function loadSyncStore() {
  vi.resetModules()
  return import('../../src/renderer/src/sync/sync-store')
}

describe('sync API base migration', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('migrates the former localhost default so existing desktop profiles can log in', async () => {
    localStorage.setItem(
      SYNC_STORAGE_KEY,
      JSON.stringify({
        baseUrl: LEGACY_LOCAL_API_BASE,
        accessToken: null,
        refreshToken: null,
        deviceId: 'existing-device',
        user: null
      })
    )

    const { getSyncState } = await loadSyncStore()

    expect(getSyncState().baseUrl).toBe(PRODUCTION_API_BASE)
    expect(JSON.parse(localStorage.getItem(SYNC_STORAGE_KEY) ?? '{}').baseUrl).toBe(
      PRODUCTION_API_BASE
    )
  })

  it('keeps a deliberately configured non-legacy API endpoint unchanged', async () => {
    localStorage.setItem(
      SYNC_STORAGE_KEY,
      JSON.stringify({ baseUrl: 'https://sync.staging.example.test' })
    )

    const { getSyncState } = await loadSyncStore()

    expect(getSyncState().baseUrl).toBe('https://sync.staging.example.test')
  })

  it('discards the retired sync opt-out flag from existing profiles', async () => {
    localStorage.setItem(
      SYNC_STORAGE_KEY,
      JSON.stringify({
        baseUrl: PRODUCTION_API_BASE,
        enabled: false
      })
    )

    const { getSyncState } = await loadSyncStore()

    expect(getSyncState()).not.toHaveProperty('enabled')
  })
})
