import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import {
  addImmersiveCustomMedia,
  customScenePreference,
  deleteImmersiveCustomMedia,
  isBuiltInImmersiveScene,
  listImmersiveCustomMedia,
  parseCustomSceneId,
  readImmersiveScenePreference,
  renameImmersiveCustomMedia,
  writeImmersiveScenePreference
} from './immersive-custom-media-store'
import {
  classifyImmersiveMediaFile,
  IMMERSIVE_MEDIA_MAX_BYTES,
  sceneNameFromFileName,
  type ImmersiveCustomMediaItem,
  type ImmersiveSceneId
} from './immersive-scene-types'

export type UseImmersiveCustomMediaResult = {
  immersiveScene: ImmersiveSceneId
  customImmersiveMediaList: ImmersiveCustomMediaItem[]
  editingCustomSceneId: string | null
  customSceneNameDraft: string
  isSceneDropActive: boolean
  sceneFileInputRef: RefObject<HTMLInputElement | null>
  setIsSceneDropActive: Dispatch<SetStateAction<boolean>>
  setCustomSceneNameDraft: Dispatch<SetStateAction<string>>
  setEditingCustomSceneId: Dispatch<SetStateAction<string | null>>
  applyCustomImmersiveMedia: (file: File) => boolean
  selectImmersiveScene: (scene: ImmersiveSceneId) => void
  removeCustomImmersiveMedia: (id: string) => void
  startCustomSceneNameEditing: (id: string) => void
  finishCustomSceneNameEditing: () => void
}

export function useImmersiveCustomMedia(): UseImmersiveCustomMediaResult {
  const [immersiveScene, setImmersiveScene] = useState<ImmersiveSceneId>('clock')
  const [customImmersiveMediaList, setCustomImmersiveMediaList] = useState<ImmersiveCustomMediaItem[]>(
    []
  )
  const [editingCustomSceneId, setEditingCustomSceneId] = useState<string | null>(null)
  const [customSceneNameDraft, setCustomSceneNameDraft] = useState('')
  const [isSceneDropActive, setIsSceneDropActive] = useState(false)
  const customMediaUrlsRef = useRef<Map<string, string>>(new Map())
  const sceneFileInputRef = useRef<HTMLInputElement | null>(null)

  const revokeAllCustomImmersiveMedia = useCallback((): void => {
    for (const url of customMediaUrlsRef.current.values()) {
      URL.revokeObjectURL(url)
    }
    customMediaUrlsRef.current.clear()
  }, [])

  const revokeCustomImmersiveMediaById = useCallback((id: string): void => {
    const url = customMediaUrlsRef.current.get(id)
    if (!url) return
    URL.revokeObjectURL(url)
    customMediaUrlsRef.current.delete(id)
  }, [])

  const adoptCustomImmersiveMediaList = useCallback(
    (
      items: Array<{
        id: string
        kind: ImmersiveCustomMediaItem['kind']
        name: string
        blob: Blob
      }>
    ): ImmersiveCustomMediaItem[] => {
      revokeAllCustomImmersiveMedia()
      const next: ImmersiveCustomMediaItem[] = items.map((item) => {
        const url = URL.createObjectURL(item.blob)
        customMediaUrlsRef.current.set(item.id, url)
        return {
          id: item.id,
          kind: item.kind,
          url,
          name: item.name
        }
      })
      setCustomImmersiveMediaList(next)
      return next
    },
    [revokeAllCustomImmersiveMedia]
  )

  const rehydrateCustomImmersiveMediaList = useCallback(async (): Promise<void> => {
    const stored = await listImmersiveCustomMedia()
    adoptCustomImmersiveMediaList(
      stored.map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        blob: item.blob
      }))
    )
  }, [adoptCustomImmersiveMediaList])

  const applyCustomImmersiveMedia = useCallback(
    (file: File): boolean => {
      const kind = classifyImmersiveMediaFile(file)
      if (!kind) return false
      if (file.size > IMMERSIVE_MEDIA_MAX_BYTES) return false
      const sceneName = sceneNameFromFileName(file.name)
      const provisionalId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      // Optimistic preview: provisional list + scene switch; durable only after IDB add.
      const previousScene = immersiveScene
      const url = URL.createObjectURL(file)
      customMediaUrlsRef.current.set(provisionalId, url)
      setCustomImmersiveMediaList((current) => [
        ...current,
        { id: provisionalId, kind, url, name: sceneName }
      ])
      const sceneId = customScenePreference(provisionalId)
      setImmersiveScene(sceneId)
      writeImmersiveScenePreference(sceneId)
      setIsSceneDropActive(false)
      void (async () => {
        const persistedId = await addImmersiveCustomMedia({
          id: provisionalId,
          kind,
          name: sceneName,
          mimeType: file.type,
          blob: file
        })
        if (!persistedId) {
          // Rollback provisional UI if durable write failed.
          revokeCustomImmersiveMediaById(provisionalId)
          setCustomImmersiveMediaList((current) => current.filter((item) => item.id !== provisionalId))
          setImmersiveScene((current) => {
            if (current !== customScenePreference(provisionalId)) return current
            writeImmersiveScenePreference(previousScene)
            return previousScene
          })
          return
        }
        if (persistedId === provisionalId) return
        const oldUrl = customMediaUrlsRef.current.get(provisionalId)
        if (oldUrl) {
          customMediaUrlsRef.current.delete(provisionalId)
          customMediaUrlsRef.current.set(persistedId, oldUrl)
        }
        setCustomImmersiveMediaList((current) =>
          current.map((item) => (item.id === provisionalId ? { ...item, id: persistedId } : item))
        )
        setImmersiveScene((current) =>
          current === customScenePreference(provisionalId)
            ? customScenePreference(persistedId)
            : current
        )
        writeImmersiveScenePreference(customScenePreference(persistedId))
      })()
      return true
    },
    [immersiveScene, revokeCustomImmersiveMediaById]
  )

  const selectImmersiveScene = useCallback(
    (scene: ImmersiveSceneId): void => {
      if (scene.startsWith('custom:')) {
        const id = parseCustomSceneId(scene)
        if (!id) return
        const exists = customImmersiveMediaList.some((item) => item.id === id)
        if (!exists) return
      }
      setImmersiveScene(scene)
      writeImmersiveScenePreference(scene)
    },
    [customImmersiveMediaList]
  )

  const removeCustomImmersiveMedia = useCallback(
    (id: string): void => {
      const removedItem = customImmersiveMediaList.find((item) => item.id === id)
      const previousScene = immersiveScene
      const wasSelected = previousScene === customScenePreference(id)
      revokeCustomImmersiveMediaById(id)
      setCustomImmersiveMediaList((current) => current.filter((item) => item.id !== id))
      if (editingCustomSceneId === id) {
        setEditingCustomSceneId(null)
        setCustomSceneNameDraft('')
      }
      if (wasSelected) {
        setImmersiveScene('clock')
        writeImmersiveScenePreference('clock')
      }
      void (async () => {
        const ok = await deleteImmersiveCustomMedia(id)
        if (ok) return
        // Durable delete failed — re-list from IDB so UI matches store.
        await rehydrateCustomImmersiveMediaList()
        if (wasSelected && removedItem) {
          setImmersiveScene(previousScene)
          writeImmersiveScenePreference(previousScene)
        }
      })()
    },
    [
      customImmersiveMediaList,
      editingCustomSceneId,
      immersiveScene,
      rehydrateCustomImmersiveMediaList,
      revokeCustomImmersiveMediaById
    ]
  )

  const startCustomSceneNameEditing = useCallback(
    (id: string): void => {
      const target = customImmersiveMediaList.find((item) => item.id === id)
      if (!target) return
      setCustomSceneNameDraft(target.name)
      setEditingCustomSceneId(id)
    },
    [customImmersiveMediaList]
  )

  const finishCustomSceneNameEditing = useCallback((): void => {
    const id = editingCustomSceneId
    const name = customSceneNameDraft.trim()
    setEditingCustomSceneId(null)
    if (!id || !name) return
    const current = customImmersiveMediaList.find((item) => item.id === id)
    if (!current || name === current.name) return
    const previousName = current.name
    setCustomImmersiveMediaList((list) =>
      list.map((item) => (item.id === id ? { ...item, name } : item))
    )
    void (async () => {
      const ok = await renameImmersiveCustomMedia(id, name)
      if (ok) return
      // Rename failed — revert optimistic label from last known name.
      setCustomImmersiveMediaList((list) =>
        list.map((item) => (item.id === id ? { ...item, name: previousName } : item))
      )
    })()
  }, [customImmersiveMediaList, customSceneNameDraft, editingCustomSceneId])

  // Restore durable custom scenes + last scene preference after restart.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const stored = await listImmersiveCustomMedia()
      if (cancelled) return
      const adopted = adoptCustomImmersiveMediaList(
        stored.map((item) => ({
          id: item.id,
          kind: item.kind,
          name: item.name,
          blob: item.blob
        }))
      )
      const preferred = readImmersiveScenePreference()
      if (cancelled) return
      if (isBuiltInImmersiveScene(preferred)) {
        setImmersiveScene(preferred)
        return
      }
      const preferredCustomId = parseCustomSceneId(preferred)
      if (preferredCustomId && adopted.some((item) => item.id === preferredCustomId)) {
        setImmersiveScene(customScenePreference(preferredCustomId))
        return
      }
      // Legacy preference "custom": pick the first restored item if any.
      if (preferred === 'custom' && adopted[0]) {
        setImmersiveScene(customScenePreference(adopted[0].id))
        writeImmersiveScenePreference(customScenePreference(adopted[0].id))
        return
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adoptCustomImmersiveMediaList])

  useEffect(
    () => () => {
      revokeAllCustomImmersiveMedia()
    },
    [revokeAllCustomImmersiveMedia]
  )

  return {
    immersiveScene,
    customImmersiveMediaList,
    editingCustomSceneId,
    customSceneNameDraft,
    isSceneDropActive,
    sceneFileInputRef,
    setIsSceneDropActive,
    setCustomSceneNameDraft,
    setEditingCustomSceneId,
    applyCustomImmersiveMedia,
    selectImmersiveScene,
    removeCustomImmersiveMedia,
    startCustomSceneNameEditing,
    finishCustomSceneNameEditing
  }
}