import katex from 'katex'
import {
  ExternalLink,
  ImagePlus,
  Link2,
  Loader2,
  Plus,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapCommand } from '../../../../shared/mindmap/commands'
import type {
  MindMapAssetRef,
  MindMapLink,
  MindMapTopicV2
} from '../../../../shared/mindmap/domain/types'
import { classifyExternalDestination } from '../../../../shared/external-destination'
import type { MindMapAssetReadResult } from '../../../../shared/teaching-types/mindmap'
import { useAppStore } from '../../app-shell/appStore'
import { useMindMapViewStore } from './mind-map-view-store'

/**
 * Topic content editor for formulas, links, and workspace-backed images.
 *
 * Images are deliberately kept outside the canonical JSON document: the
 * document stores only an asset reference, while this panel asks the main
 * process for a short-lived data URL when it needs to render a preview.
 */
export function MindMapTopicContentPanel() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const selection = useMindMapViewStore((state) => state.selection)
  const updateNode = useMindMapViewStore((state) => state.updateNode)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)
  const workspaceId = useAppStore((state) => state.appState?.activeWorkspace?.id ?? null)
  const openExternal = useAppStore((state) => state.openExternal)

  const activeSheet =
    current?.sheets.find((sheet) => sheet.id === activeSheetId) ?? current?.sheets[0] ?? null
  const selectedTopic =
    activeSheet && selection.kind === 'topic' && selection.topicIds.length === 1
      ? findMindMapTopic(activeSheet.root, selection.topicIds[0] ?? '')
      : null
  const selectedCount = selection.kind === 'topic' ? selection.topicIds.length : 0

  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkDrafts, setLinkDrafts] = useState<Record<string, LinkDraft>>({})
  const [assetPreviews, setAssetPreviews] = useState<Record<string, AssetPreviewState>>({})
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetError, setAssetError] = useState<string | null>(null)

  const formulaPreview = useMemo(() => {
    const formula = selectedTopic?.formula?.trim() ?? ''
    if (!formula) return null
    try {
      return katex.renderToString(formula, {
        displayMode: true,
        output: 'html',
        throwOnError: false,
        trust: false
      })
    } catch {
      return null
    }
  }, [selectedTopic?.formula])

  useEffect(() => {
    const links = selectedTopic?.links ?? []
    setLinkDrafts(Object.fromEntries(links.map((link) => [
      link.id,
      { url: link.url, title: link.title ?? '' }
    ])))
    setLinkError(null)
    setLinkUrl('')
    setLinkTitle('')
  }, [selectedTopic?.id, selectedTopic?.links])

  useEffect(() => {
    let cancelled = false
    const assetIds = selectedTopic?.assetIds ?? []
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
  }, [current, selectedTopic?.id, selectedTopic?.assetIds, workspaceId])

  if (selection.kind !== 'topic') return null

  if (!selectedTopic) {
    return (
      <section className="mindmap-topic-content-panel" aria-labelledby="mindmap-content-title">
        <div className="mindmap-topic-content-panel__head">
          <strong id="mindmap-content-title">{t('mindmap.contentPanel.title')}</strong>
        </div>
        <p className="mindmap-topic-content-panel__empty" role="status">
          {t('mindmap.contentPanel.multiSelection', { count: selectedCount })}
        </p>
      </section>
    )
  }

  const links = selectedTopic.links ?? []
  const assetIds = selectedTopic.assetIds ?? []

  const addLink = (): void => {
    const target = classifyExternalDestination(linkUrl.trim())
    if (target.kind !== 'browser') {
      setLinkError(t('mindmap.contentPanel.invalidUrl'))
      return
    }
    const link: MindMapLink = {
      id: crypto.randomUUID(),
      url: target.url,
      ...(linkTitle.trim() ? { title: linkTitle.trim() } : {})
    }
    updateNode(selectedTopic.id, { links: [...links, link] })
    setLinkUrl('')
    setLinkTitle('')
    setLinkError(null)
  }

  const updateLinkDraft = (linkId: string, field: keyof LinkDraft, value: string): void => {
    setLinkDrafts((drafts) => ({
      ...drafts,
      [linkId]: { ...(drafts[linkId] ?? { url: '', title: '' }), [field]: value }
    }))
  }

  const commitLink = (linkId: string): void => {
    const draft = linkDrafts[linkId]
    if (!draft) return
    const target = classifyExternalDestination(draft.url.trim())
    if (target.kind !== 'browser') {
      setLinkError(t('mindmap.contentPanel.invalidUrl'))
      return
    }
    const nextLinks = links.map((link) => link.id === linkId
      ? {
          ...link,
          url: target.url,
          ...(draft.title.trim() ? { title: draft.title.trim() } : { title: undefined })
        }
      : link)
    updateNode(selectedTopic.id, { links: nextLinks })
    setLinkError(null)
  }

  const removeLink = (linkId: string): void => {
    const nextLinks = links.filter((link) => link.id !== linkId)
    updateNode(selectedTopic.id, { links: nextLinks.length > 0 ? nextLinks : null })
  }

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
      const nextAssetIds = [...new Set([...assetIds, asset.id])]
      dispatchCommand(
        {
          type: 'transaction',
          commands: [
            { type: 'asset.create', asset },
            {
              type: 'topic.update',
              sheetId: activeSheet.id,
              topicId: selectedTopic.id,
              patch: { assetIds: nextAssetIds }
            }
          ]
        },
        { label: 'Add topic image' }
      )
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : String(error))
    } finally {
      setAssetBusy(false)
    }
  }

  const removeImage = (assetId: string): void => {
    if (!current || !activeSheet) return
    const nextAssetIds = assetIds.filter((id) => id !== assetId)
    const references = countAssetReferences(current, assetId)
    const commands: MindMapCommand[] = [
      {
        type: 'topic.update' as const,
        sheetId: activeSheet.id,
        topicId: selectedTopic.id,
        patch: { assetIds: nextAssetIds.length > 0 ? nextAssetIds : null }
      }
    ]
    if (references <= 1) commands.push({ type: 'asset.remove' as const, assetId })
    dispatchCommand(
      { type: 'transaction', commands },
      { label: 'Remove topic image' }
    )
  }

  return (
    <section className="mindmap-topic-content-panel" aria-labelledby="mindmap-content-title">
      <div className="mindmap-topic-content-panel__head">
        <strong id="mindmap-content-title">{t('mindmap.contentPanel.title')}</strong>
        <span title={selectedTopic.title || t('mindmap.untitledTopic')}>
          {selectedTopic.title || t('mindmap.untitledTopic')}
        </span>
      </div>

      <div className="mindmap-topic-content-panel__section">
        <label className="mindmap-topic-content-panel__label" htmlFor="mindmap-topic-formula">
          {t('mindmap.contentPanel.formula')}
        </label>
        <textarea
          id="mindmap-topic-formula"
          className="mindmap-topic-content-panel__textarea"
          value={selectedTopic.formula ?? ''}
          placeholder={t('mindmap.contentPanel.formulaPlaceholder')}
          onChange={(event) => updateNode(selectedTopic.id, { formula: event.currentTarget.value || null })}
          rows={3}
        />
        {formulaPreview ? (
          <div className="mindmap-topic-content-panel__formula-preview">
            <span className="mindmap-topic-content-panel__hint">
              {t('mindmap.contentPanel.formulaPreview')}
            </span>
            <div dangerouslySetInnerHTML={{ __html: formulaPreview }} />
          </div>
        ) : null}
      </div>

      <div className="mindmap-topic-content-panel__section">
        <div className="mindmap-topic-content-panel__section-head">
          <span className="mindmap-topic-content-panel__label">
            <Link2 size={14} aria-hidden="true" />
            {t('mindmap.contentPanel.links')}
          </span>
        </div>
        <div className="mindmap-topic-content-panel__link-form">
          <input
            className="mindmap-topic-content-panel__input"
            type="url"
            value={linkUrl}
            placeholder={t('mindmap.contentPanel.linkUrl')}
            onChange={(event) => setLinkUrl(event.currentTarget.value)}
          />
          <input
            className="mindmap-topic-content-panel__input"
            type="text"
            value={linkTitle}
            placeholder={t('mindmap.contentPanel.linkTitle')}
            onChange={(event) => setLinkTitle(event.currentTarget.value)}
          />
          <button type="button" className="mindmap-topic-content-panel__add-button" onClick={addLink}>
            <Plus size={14} aria-hidden="true" />
            {t('mindmap.contentPanel.addLink')}
          </button>
        </div>
        {linkError ? <p className="mindmap-topic-content-panel__error" role="alert">{linkError}</p> : null}
        {links.length > 0 ? (
          <ul className="mindmap-topic-content-panel__links" aria-label={t('mindmap.contentPanel.links')}>
            {links.map((link) => {
              const draft = linkDrafts[link.id] ?? { url: link.url, title: link.title ?? '' }
              return (
                <li key={link.id} className="mindmap-topic-content-panel__link-row">
                  <input
                    className="mindmap-topic-content-panel__input"
                    type="url"
                    value={draft.url}
                    aria-label={t('mindmap.contentPanel.linkUrl')}
                    onChange={(event) => updateLinkDraft(link.id, 'url', event.currentTarget.value)}
                    onBlur={() => commitLink(link.id)}
                  />
                  <input
                    className="mindmap-topic-content-panel__input"
                    type="text"
                    value={draft.title}
                    aria-label={t('mindmap.contentPanel.linkTitle')}
                    placeholder={t('mindmap.contentPanel.linkTitle')}
                    onChange={(event) => updateLinkDraft(link.id, 'title', event.currentTarget.value)}
                    onBlur={() => commitLink(link.id)}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    title={t('mindmap.contentPanel.openLink')}
                    aria-label={t('mindmap.contentPanel.openLink')}
                    onClick={() => {
                      const target = classifyExternalDestination(draft.url)
                      if (target.kind === 'browser') void openExternal(target.url)
                      else setLinkError(t('mindmap.contentPanel.invalidUrl'))
                    }}
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    title={t('mindmap.contentPanel.removeLink')}
                    aria-label={t('mindmap.contentPanel.removeLink')}
                    onClick={() => removeLink(link.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>

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
        {assetIds.length > 0 ? (
          <div className="mindmap-topic-content-panel__images">
            {assetIds.map((assetId) => {
              const state = assetPreviews[assetId]
              const asset = state && 'result' in state ? state.result?.asset : findAsset(current, assetId)
              return (
                <figure key={assetId} className="mindmap-topic-content-panel__image-card">
                  {state && 'result' in state && state.result ? (
                    <img src={state.result.dataUrl} alt={asset?.fileName ?? assetId} />
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
                    <span title={asset?.fileName ?? assetId}>{asset?.fileName ?? assetId}</span>
                    <button
                      type="button"
                      className="icon-button"
                      title={t('mindmap.contentPanel.removeImage')}
                      aria-label={t('mindmap.contentPanel.removeImage')}
                      onClick={() => removeImage(assetId)}
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
    </section>
  )
}

type LinkDraft = { url: string; title: string }
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
    count += countTopicAssetReferences(sheet.root, assetId)
  }
  return count
}

function countTopicAssetReferences(topic: MindMapTopicV2, assetId: string): number {
  const own = topic.assetIds?.includes(assetId) ? 1 : 0
  return own + topic.children.reduce((total, child) => total + countTopicAssetReferences(child, assetId), 0)
}
