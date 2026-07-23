/**
 * Durable store for workbench immersive custom scene media (multi-item).
 *
 * Renderer-local only (IndexedDB). Not teaching evidence / not workspace truth.
 * Object URLs are ephemeral; Blobs in IDB are the restart-surviving source.
 */

export type ImmersiveCustomMediaKind = 'image' | 'video'

export type ImmersiveCustomMediaRecord = {
  id: string
  kind: ImmersiveCustomMediaKind
  name: string
  mimeType: string
  blob: Blob
  updatedAt: number
  createdAt: number
}

export type ImmersiveCustomMediaView = {
  id: string
  kind: ImmersiveCustomMediaKind
  name: string
  mimeType: string
  blob: Blob
  updatedAt: number
  createdAt: number
}

const DB_NAME = 'studiumx-workbench-v1'
const DB_VERSION = 1
const STORE_NAME = 'immersive-custom-media'
/** Legacy single-slot key from v1 single-media store. */
const LEGACY_RECORD_ID = 'current'

const SCENE_PREF_KEY = 'studiumx:workbench:immersive-scene:v1'

export type BuiltInImmersiveScenePreference =
  | 'clock'
  | 'focus-timer'
  | 'girl'
  | 'cloud-glow'
  | 'summer-lakeside'

export type ImmersiveScenePreference =
  | BuiltInImmersiveScenePreference
  | 'custom'
  | `custom:${string}`

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'))
  })
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    if (tx.error) {
      reject(tx.error)
      return
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'))
  })
}

function createMediaId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isMediaKind(value: unknown): value is ImmersiveCustomMediaKind {
  return value === 'image' || value === 'video'
}

function toView(record: ImmersiveCustomMediaRecord): ImmersiveCustomMediaView | null {
  if (!record || typeof record.id !== 'string' || !record.id) return null
  if (!(record.blob instanceof Blob)) return null
  if (!isMediaKind(record.kind)) return null
  return {
    id: record.id,
    kind: record.kind,
    name: typeof record.name === 'string' && record.name.trim() ? record.name : '自定义场景',
    mimeType: typeof record.mimeType === 'string' ? record.mimeType : record.blob.type || '',
    blob: record.blob,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0
  }
}

/**
 * Migrate legacy single-slot `{ id: 'current' }` into a multi-item id in place.
 */
async function migrateLegacyIfNeeded(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  const legacy = (await requestToPromise(store.get(LEGACY_RECORD_ID))) as
    | ImmersiveCustomMediaRecord
    | undefined
  if (!legacy || !(legacy.blob instanceof Blob)) {
    await waitForTransaction(tx)
    return
  }
  const id = createMediaId()
  const now = Date.now()
  const migrated: ImmersiveCustomMediaRecord = {
    id,
    kind: isMediaKind(legacy.kind) ? legacy.kind : 'image',
    name: typeof legacy.name === 'string' && legacy.name.trim() ? legacy.name : '自定义场景',
    mimeType: typeof legacy.mimeType === 'string' ? legacy.mimeType : legacy.blob.type || '',
    blob: legacy.blob,
    updatedAt: typeof legacy.updatedAt === 'number' ? legacy.updatedAt : now,
    createdAt:
      typeof (legacy as { createdAt?: number }).createdAt === 'number'
        ? (legacy as { createdAt: number }).createdAt
        : now
  }
  store.put(migrated)
  store.delete(LEGACY_RECORD_ID)
  await waitForTransaction(tx)
}

export async function listImmersiveCustomMedia(): Promise<ImmersiveCustomMediaView[]> {
  try {
    const db = await openDb()
    try {
      await migrateLegacyIfNeeded(db)
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const rows = (await requestToPromise(store.getAll())) as ImmersiveCustomMediaRecord[]
      await waitForTransaction(tx)
      const views = (rows ?? [])
        .map((row) => toView(row))
        .filter((row): row is ImmersiveCustomMediaView => row !== null)
        .filter((row) => row.id !== LEGACY_RECORD_ID)
      views.sort((a, b) => {
        const created = (a.createdAt || a.updatedAt) - (b.createdAt || b.updatedAt)
        if (created !== 0) return created
        return a.id.localeCompare(b.id)
      })
      return views
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

/** @deprecated Prefer listImmersiveCustomMedia — kept for callers that need the first item. */
export async function loadImmersiveCustomMedia(): Promise<ImmersiveCustomMediaView | null> {
  const all = await listImmersiveCustomMedia()
  return all[0] ?? null
}

export async function addImmersiveCustomMedia(input: {
  kind: ImmersiveCustomMediaKind
  name: string
  mimeType?: string
  blob: Blob
  id?: string
}): Promise<string | null> {
  try {
    const db = await openDb()
    try {
      await migrateLegacyIfNeeded(db)
      const now = Date.now()
      const id = (input.id && input.id.trim()) || createMediaId()
      const record: ImmersiveCustomMediaRecord = {
        id,
        kind: input.kind,
        name: input.name.trim() || '自定义场景',
        mimeType: (input.mimeType || input.blob.type || '').trim(),
        blob: input.blob,
        updatedAt: now,
        createdAt: now
      }
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const done = waitForTransaction(tx)
      tx.objectStore(STORE_NAME).put(record)
      await done
      return id
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/** Append a new multi-item custom media record (backward-compatible name). */
export async function saveImmersiveCustomMedia(input: {
  kind: ImmersiveCustomMediaKind
  name: string
  mimeType?: string
  blob: Blob
  id?: string
}): Promise<boolean> {
  const id = await addImmersiveCustomMedia(input)
  return id !== null
}

export async function renameImmersiveCustomMedia(id: string, name: string): Promise<boolean> {
  const normalizedName = name.trim()
  if (!id || !normalizedName) return false
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const current = (await requestToPromise(store.get(id))) as ImmersiveCustomMediaRecord | undefined
      if (!current || !(current.blob instanceof Blob)) {
        await waitForTransaction(tx)
        return false
      }
      store.put({
        ...current,
        name: normalizedName,
        updatedAt: Date.now()
      })
      await waitForTransaction(tx)
      return true
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

export async function deleteImmersiveCustomMedia(id: string): Promise<boolean> {
  if (!id) return false
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const done = waitForTransaction(tx)
      tx.objectStore(STORE_NAME).delete(id)
      await done
      return true
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

/** Clears every custom media record (including legacy). */
export async function clearImmersiveCustomMedia(): Promise<boolean> {
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const keys = (await requestToPromise(store.getAllKeys())) as IDBValidKey[]
      for (const key of keys) store.delete(key)
      await waitForTransaction(tx)
      return true
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

export function isBuiltInImmersiveScene(
  value: string | null | undefined
): value is BuiltInImmersiveScenePreference {
  return (
    value === 'clock' ||
    value === 'focus-timer' ||
    value === 'girl' ||
    value === 'cloud-glow' ||
    value === 'summer-lakeside'
  )
}

export function isCustomScenePreference(
  value: string | null | undefined
): value is 'custom' | `custom:${string}` {
  return value === 'custom' || (typeof value === 'string' && value.startsWith('custom:'))
}

export function customScenePreference(id: string): `custom:${string}` {
  return `custom:${id}`
}

export function parseCustomSceneId(pref: string | null | undefined): string | null {
  if (!pref) return null
  if (pref === 'custom') return null
  if (pref.startsWith('custom:')) {
    const id = pref.slice('custom:'.length).trim()
    return id || null
  }
  return null
}

export function readImmersiveScenePreference(): ImmersiveScenePreference | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(SCENE_PREF_KEY)
    if (!raw) return null
    if (isBuiltInImmersiveScene(raw)) return raw
    if (raw === 'custom') return 'custom'
    if (raw.startsWith('custom:')) {
      const id = raw.slice('custom:'.length).trim()
      return id ? (`custom:${id}` as const) : null
    }
    return null
  } catch {
    return null
  }
}

export function writeImmersiveScenePreference(scene: ImmersiveScenePreference): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(SCENE_PREF_KEY, scene)
  } catch {
    // ignore quota / private-mode failures
  }
}

export { SCENE_PREF_KEY, DB_NAME, STORE_NAME, LEGACY_RECORD_ID }
