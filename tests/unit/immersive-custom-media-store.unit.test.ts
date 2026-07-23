import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addImmersiveCustomMedia,
  clearImmersiveCustomMedia,
  customScenePreference,
  deleteImmersiveCustomMedia,
  LEGACY_RECORD_ID,
  listImmersiveCustomMedia,
  loadImmersiveCustomMedia,
  parseCustomSceneId,
  readImmersiveScenePreference,
  renameImmersiveCustomMedia,
  SCENE_PREF_KEY,
  writeImmersiveScenePreference
} from '../../src/renderer/src/views/workbench/immersive-custom-media-store'

type StoreMap = Map<string, unknown>

class FakeRequest<T> {
  result: T
  error: DOMException | null = null
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(result: T, auto = true) {
    this.result = result
    if (auto) {
      queueMicrotask(() => this.onsuccess?.(new Event('success')))
    }
  }
}

class FakeTx {
  oncomplete: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onabort: ((event: Event) => void) | null = null
  error: DOMException | null = null
  private readonly map: StoreMap
  private readonly mode: IDBTransactionMode
  private completeScheduled = false

  constructor(map: StoreMap, mode: IDBTransactionMode) {
    this.map = map
    this.mode = mode
  }

  private scheduleComplete(): void {
    if (this.completeScheduled) return
    this.completeScheduled = true
    queueMicrotask(() => this.oncomplete?.(new Event('complete')))
  }

  objectStore(): {
    get: (key: string) => FakeRequest<unknown>
    getAll: () => FakeRequest<unknown[]>
    getAllKeys: () => FakeRequest<string[]>
    put: (value: unknown) => FakeRequest<string>
    delete: (key: string) => FakeRequest<undefined>
  } {
    const map = this.map
    return {
      get: (key: string) => {
        const req = new FakeRequest(map.get(key))
        if (this.mode === 'readonly') this.scheduleComplete()
        return req
      },
      getAll: () => {
        const req = new FakeRequest(Array.from(map.values()))
        if (this.mode === 'readonly') this.scheduleComplete()
        return req
      },
      getAllKeys: () => {
        const req = new FakeRequest(Array.from(map.keys()))
        if (this.mode === 'readonly') this.scheduleComplete()
        return req
      },
      put: (value: unknown) => {
        const record = value as { id: string }
        map.set(record.id, value)
        const req = new FakeRequest(record.id)
        this.scheduleComplete()
        return req
      },
      delete: (key: string) => {
        map.delete(key)
        const req = new FakeRequest(undefined)
        this.scheduleComplete()
        return req
      }
    }
  }
}

class FakeDb {
  objectStoreNames = {
    contains: (name: string) => name === 'immersive-custom-media'
  }
  private readonly map: StoreMap

  constructor(map: StoreMap) {
    this.map = map
  }

  transaction(_store: string, mode: IDBTransactionMode): FakeTx {
    return new FakeTx(this.map, mode)
  }

  close(): void {}
}

describe('immersive-custom-media-store (multi-item)', () => {
  const memory = new Map<string, unknown>()
  const local = new Map<string, string>()

  beforeEach(() => {
    memory.clear()
    local.clear()
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = {
          result: new FakeDb(memory) as unknown as IDBDatabase,
          error: null as DOMException | null,
          onsuccess: null as ((event: Event) => void) | null,
          onerror: null as ((event: Event) => void) | null,
          onupgradeneeded: null as ((event: Event) => void) | null
        }
        queueMicrotask(() => request.onsuccess?.(new Event('success')))
        return request as unknown as IDBOpenDBRequest
      }
    })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => {
        local.set(key, value)
      },
      removeItem: (key: string) => {
        local.delete(key)
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adds multiple custom media records without overwriting earlier ones', async () => {
    const a = new Blob([new Uint8Array([1, 2])], { type: 'image/png' })
    const b = new Blob([new Uint8Array([3, 4])], { type: 'image/jpeg' })
    const idA = await addImmersiveCustomMedia({ kind: 'image', name: 'desk', mimeType: 'image/png', blob: a })
    const idB = await addImmersiveCustomMedia({ kind: 'image', name: 'window', mimeType: 'image/jpeg', blob: b })
    expect(idA).toBeTruthy()
    expect(idB).toBeTruthy()
    expect(idA).not.toBe(idB)

    const listed = await listImmersiveCustomMedia()
    expect(listed).toHaveLength(2)
    expect(listed.map((item) => item.name).sort()).toEqual(['desk', 'window'])
  })

  it('round-trips custom media blob across add/list', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    const id = await addImmersiveCustomMedia({
      kind: 'image',
      name: 'desk.png',
      mimeType: 'image/png',
      blob
    })
    expect(id).toBeTruthy()

    const loaded = await loadImmersiveCustomMedia()
    expect(loaded).not.toBeNull()
    expect(loaded?.id).toBe(id)
    expect(loaded?.kind).toBe('image')
    expect(loaded?.name).toBe('desk.png')
    expect(loaded?.mimeType).toBe('image/png')
    expect(loaded?.blob).toBeInstanceOf(Blob)
    expect(await loaded!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer())
  })

  it('renames a specific media item without replacing its blob', async () => {
    const blob = new Blob(['image'], { type: 'image/png' })
    const id = await addImmersiveCustomMedia({ kind: 'image', name: 'old.png', blob })
    expect(id).toBeTruthy()

    expect(await renameImmersiveCustomMedia(id!, '学习桌面')).toBe(true)

    const listed = await listImmersiveCustomMedia()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.name).toBe('学习桌面')
    expect(await listed[0]!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer())
  })

  it('deletes one media item while keeping the rest', async () => {
    const idA = await addImmersiveCustomMedia({
      kind: 'image',
      name: 'a',
      blob: new Blob(['a'], { type: 'image/png' })
    })
    const idB = await addImmersiveCustomMedia({
      kind: 'video',
      name: 'b',
      blob: new Blob(['b'], { type: 'video/mp4' })
    })
    expect(await deleteImmersiveCustomMedia(idA!)).toBe(true)
    const listed = await listImmersiveCustomMedia()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(idB)
  })

  it('clears all stored media', async () => {
    await addImmersiveCustomMedia({ kind: 'video', name: 'a.mp4', blob: new Blob(['video'], { type: 'video/mp4' }) })
    await addImmersiveCustomMedia({ kind: 'image', name: 'b.png', blob: new Blob(['img'], { type: 'image/png' }) })
    expect(await listImmersiveCustomMedia()).toHaveLength(2)
    expect(await clearImmersiveCustomMedia()).toBe(true)
    expect(await listImmersiveCustomMedia()).toEqual([])
  })

  it('migrates legacy single-slot current record into multi-item storage', async () => {
    const blob = new Blob(['legacy'], { type: 'image/png' })
    memory.set(LEGACY_RECORD_ID, {
      id: LEGACY_RECORD_ID,
      kind: 'image',
      name: '旧场景',
      mimeType: 'image/png',
      blob,
      updatedAt: 42
    })

    const listed = await listImmersiveCustomMedia()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).not.toBe(LEGACY_RECORD_ID)
    expect(listed[0]?.name).toBe('旧场景')
    expect(memory.has(LEGACY_RECORD_ID)).toBe(false)
  })

  it('persists scene preference including custom:<id>', () => {
    expect(readImmersiveScenePreference()).toBeNull()
    writeImmersiveScenePreference('girl')
    expect(local.get(SCENE_PREF_KEY)).toBe('girl')
    expect(readImmersiveScenePreference()).toBe('girl')
    writeImmersiveScenePreference(customScenePreference('abc'))
    expect(readImmersiveScenePreference()).toBe('custom:abc')
    expect(parseCustomSceneId('custom:abc')).toBe('abc')
    writeImmersiveScenePreference('custom')
    expect(readImmersiveScenePreference()).toBe('custom')
    writeImmersiveScenePreference('云蒸霞光' as never)
    expect(readImmersiveScenePreference()).toBeNull()
    writeImmersiveScenePreference('cloud-glow')
    expect(readImmersiveScenePreference()).toBe('cloud-glow')
  })
})
