import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, ImagePlus, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapCommand } from '../../../../shared/mindmap/commands'
import type { MindMapAssetRef, MindMapImagePlacement, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import type { MindMapAssetReadResult } from '../../../../shared/teaching-types/mindmap'
import { useAppStore } from '../../app-shell/appStore'
import { useMindMapViewStore } from './mind-map-view-store'

/**
 * Inline workspace-backed image editor for the selected topic, shown inside
 * the floating topic popover (see MindMapTopicPopover).
 *
 * Images are stored as sheet-level `MindMapImageElement`s attached to a topic
 * via `topicId`. The document stores only an asset reference; this editor asks
 * the main process for a short-lived data URL when it needs a preview.
 */
export function MindMapImageEditor() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const selectedNodeId = useMindMapViewStore((state) => state.selectedNodeId)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)
  const addImage = useMindMapViewStore((state) => state.addImage)
  const workspaceId = useAppStore((state) => state.appState?.activeWorkspace?.id ?? null)

  const activeSheet =
    current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0] ?? null
  const selectedTopic =
    activeSheet && selectedNodeId ? findMindMapTopic(activeSheet.root, selectedNodeId) : null
  const attachedImages = useMemo(
    () =>
      current && selectedNodeId
        ? (activeSheet?.images ?? []).filter((image) => image.topicId === selectedNodeId)
        : [],
    [current, activeSheetId, selectedNodeId]
  )

  const [assetPreviews, setAssetPreviews] = useState<Record<string, AssetPreviewState>>({})
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetError, setAssetError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const assetIds = attachedImages.map((image) => image.assetId)
    if (!workspaceId || !current || assetIds.length === 0) {
      setAssetPreviews({})
      return () => {
        cancelled = true
      }
    }

    const load = async (): Promise<void> => {
      const entries = await Promise.all(assetIds.map(async (assetId) => {
        try {
          const result = await window.teachingSystem?.readMindMapAsset({
            workspaceId,
            id: current.id,
            assetId
          })
          return [assetId, result ? { result } : { error: true }] as const
        } catch {
          return [assetId, { error: true }] as const
        }
      }))
      if (cancelled) return
      setAssetPreviews(Object.fromEntries(entries))
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [current, attachedImages, workspaceId])

  if (!selectedTopic || !activeSheet) return null

  const importImage = async (): Promise<void> => {
    if (!workspaceId || !current || !activeSheet) return
    setAssetBusy(true)
    setAssetError(null)
    try {
      const result = await window.teachingSystem?.importMindMapAsset({
        workspaceId,
        id: current.id
      })
      if (!result || result.canceled) return
      const asset = result.asset
      dispatchCommand(
        { type: 'asset.create', asset },
        { label: 'Add image asset' }
      )
      addImage(asset.id, { topicId: selectedTopic.id })
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : String(error))
    } finally {
      setAssetBusy(false)
    }
  }

  const removeAttachedImage = (imageId: string): void => {
    if (!current || !activeSheet) return
    const image = (activeSheet.images ?? []).find((candidate) => candidate.id === imageId)
    const commands: MindMapCommand[] = [{ type: 'image.remove' as const, sheetId: activeSheet.id, imageId }]
    if (image && countAssetReferences(current, image.assetId) <= 1) {
      commands.push({ type: 'asset.remove' as const, assetId: image.assetId })
    }
    dispatchCommand({ type: 'transaction', commands }, { label: 'Remove topic image' })
  }

  const placement = selectedTopic.imagePlacement ?? 'bottom'

  const setPlacement = (next: MindMapImagePlacement): void => {
    if (next === placement) return
    dispatchCommand(
      {
        type: 'topic.update',
        sheetId: activeSheet.id,
        topicId: selectedTopic.id,
        patch: { imagePlacement: next }
      },
      { label: 'Set topic image placement' }
    )
  }

  const placementOptions: Array<{ value: MindMapImagePlacement; icon: ReactNode }> = [
    { value: 'top', icon: <ArrowUpToLine size={16} aria-hidden="true" /> },
    { value: 'bottom', icon: <ArrowDownToLine size={16} aria-hidden="true" /> },
    { value: 'left', icon: <ArrowLeftToLine size={16} aria-hidden="true" /> },
    { value: 'right', icon: <ArrowRightToLine size={16} aria-hidden="true" /> }
  ]

  return (
    <div className="mindmap-topic-content-panel__section">
      <div className="mindmap-topic-content-panel__section-head">
        <span className="mindmap-topic-content-panel__label">
          <ImagePlus size={14} aria-hidden="true" />
          {t('mindmap.contentPanel.images')}
        </span>
        <button
          type="button"
          className="mindmap-topic-content-panel__add-button"
          onClick={() => void importImage()}
          disabled={assetBusy || !workspaceId}
        >
          {assetBusy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
          {t('mindmap.contentPanel.addImage')}
        </button>
      </div>
      {assetError ? <p className="mindmap-topic-content-panel__error" role="alert">{assetError}</p> : null}
      {attachedImages.length > 0 ? (
        <div className="mindmap-topic-content-panel__placement">
          <span className="mindmap-topic-content-panel__placement-label">
            {t('mindmap.contentPanel.imagePlacement')}
          </span>
          <div className="mindmap-topic-content-panel__placement-options" role="radiogroup" aria-label={t('mindmap.contentPanel.imagePlacement')}>
            {placementOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`mindmap-topic-content-panel__placement-option${placement === option.value ? ' is-active' : ''}`}
                role="radio"
                aria-checked={placement === option.value}
                title={t(`mindmap.contentPanel.imagePlacement.${option.value}`)}
                aria-label={t(`mindmap.contentPanel.imagePlacement.${option.value}`)}
                onClick={() => setPlacement(option.value)}
              >
                {option.icon}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {attachedImages.length > 0 ? (
        <div className="mindmap-topic-content-panel__images">
          {attachedImages.map((image) => {
            const state = assetPreviews[image.assetId]
            const asset = state && 'result' in state ? state.result?.asset : findAsset(current, image.assetId)
            return (
              <figure key={image.id} className="mindmap-topic-content-panel__image-card">
                {state && 'result' in state && state.result ? (
                  <img src={state.result.dataUrl} alt={asset?.fileName ?? image.assetId} />
                ) : state && 'error' in state ? (
                  <div className="mindmap-topic-content-panel__image-placeholder" role="status">
                    {t('mindmap.contentPanel.assetError')}
                  </div>
                ) : (
                  <div className="mindmap-topic-content-panel__image-placeholder" role="status">
                    <Loader2 size={16} className="spin" aria-hidden="true" />
                    {t('mindmap.contentPanel.assetLoading')}
                  </div>
                )}
                <figcaption>
                  <span title={asset?.fileName ?? image.assetId}>{asset?.fileName ?? image.assetId}</span>
                  <button
                    type="button"
                    className="icon-button"
                    title={t('mindmap.contentPanel.removeImage')}
                    aria-label={t('mindmap.contentPanel.removeImage')}
                    onClick={() => removeAttachedImage(image.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </figcaption>
              </figure>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

type AssetPreviewState =
  | { result: MindMapAssetReadResult }
  | { error: true }

function findMindMapTopic(node: MindMapTopicV2, id: string): MindMapTopicV2 | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findMindMapTopic(child, id)
    if (found) return found
  }
  return null
}

function findAsset(document: ReturnType<typeof useMindMapViewStore.getState>['current'], id: string): MindMapAssetRef | null {
  return document?.assets.find((asset) => asset.id === id) ?? null
}

function countAssetReferences(document: NonNullable<ReturnType<typeof useMindMapViewStore.getState>['current']>, assetId: string): number {
  let count = 0
  for (const sheet of document.sheets) {
    for (const image of sheet.images ?? []) {
      if (image.assetId === assetId) count += 1
    }
  }
  return count
}
