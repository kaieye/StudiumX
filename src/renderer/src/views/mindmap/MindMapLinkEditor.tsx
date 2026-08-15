import { ExternalLink, Link2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapLink, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import { classifyExternalDestination } from '../../../../shared/external-destination'
import { useAppStore } from '../../app-shell/appStore'
import { useMindMapViewStore } from './mind-map-view-store'
import { appendLinkMarkdown, removeLinkMarkdown } from './mind-map-topic-markdown'

type MindMapLinkEditorProps = {
  topic: MindMapTopicV2
}

/**
 * Inline link editor for the popover's target topic, shown inside the floating topic
 * popover (see MindMapTopicPopover).
 *
 * Links are written through updateNode and serialized into the topic title as
 * Markdown so they remain visible and clickable inside the node. The editor
 * deliberately restricts destinations to http(s) browser links, the same
 * policy the rest of the product uses for external destinations.
 */
export function MindMapLinkEditor({ topic: selectedTopic }: MindMapLinkEditorProps) {
  const { t } = useTranslation()
  const updateNode = useMindMapViewStore((state) => state.updateNode)
  const openExternal = useAppStore((state) => state.openExternal)

  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkDrafts, setLinkDrafts] = useState<Record<string, LinkDraft>>({})

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

  const links = selectedTopic.links ?? []

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
    updateNode(selectedTopic.id, {
      title: appendLinkMarkdown(selectedTopic.title, link),
      links: [...links, link]
    })
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
    const titleWithoutManagedLinks = removeLinkMarkdown(selectedTopic.title, links)
    updateNode(selectedTopic.id, {
      title: nextLinks.reduce(appendLinkMarkdown, titleWithoutManagedLinks),
      links: nextLinks
    })
    setLinkError(null)
  }

  const removeLink = (linkId: string): void => {
    const nextLinks = links.filter((link) => link.id !== linkId)
    const titleWithoutManagedLinks = removeLinkMarkdown(selectedTopic.title, links)
    updateNode(selectedTopic.id, {
      title: nextLinks.reduce(appendLinkMarkdown, titleWithoutManagedLinks),
      links: nextLinks.length > 0 ? nextLinks : null
    })
  }

  return (
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
  )
}

type LinkDraft = { url: string; title: string }
