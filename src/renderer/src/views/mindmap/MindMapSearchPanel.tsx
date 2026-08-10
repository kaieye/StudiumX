import { ArrowDown, ArrowUp, Replace, ReplaceAll, Search } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import {
  searchMindMapTopics,
  type MindMapSearchField,
  type MindMapSearchMatch
} from './mind-map-search'

type MindMapSearchPanelProps = {
  root: MindMapTopicV2
  selectedNodeId: string | null
  onSelect: (nodeId: string) => void
  onReplace: (nodeId: string, query: string, replacement: string) => void
  onReplaceAll: (nodeIds: string[], query: string, replacement: string) => void
}

/**
 * In-memory search and replace for the active sheet.
 *
 * Search results intentionally stay local to the current topic tree. Editing
 * is delegated to the parent so it can use the shared mind-map command and
 * undo/redo path rather than mutating a topic in place.
 */
export function MindMapSearchPanel({
  root,
  selectedNodeId,
  onSelect,
  onReplace,
  onReplaceAll
}: MindMapSearchPanelProps) {
  const { t } = useTranslation()
  const queryId = useId()
  const replacementId = useId()
  const resultsId = useId()
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const matches = useMemo(() => searchMindMapTopics(root, query), [root, query])

  useEffect(() => {
    setActiveMatchIndex(0)
  }, [query])

  useEffect(() => {
    setActiveMatchIndex((index) => (matches.length === 0 ? 0 : Math.min(index, matches.length - 1)))
  }, [matches.length])

  const selectedMatchIndex = matches.findIndex((match) => match.nodeId === selectedNodeId)
  const currentMatchIndex = selectedMatchIndex >= 0 ? selectedMatchIndex : matches.length > 0 ? Math.min(activeMatchIndex, matches.length - 1) : -1
  const currentMatch = currentMatchIndex >= 0 ? matches[currentMatchIndex] : undefined

  const selectMatch = (index: number): void => {
    const match = matches[index]
    if (!match) return
    setActiveMatchIndex(index)
    onSelect(match.nodeId)
  }

  const moveMatch = (delta: number): void => {
    if (matches.length === 0) return
    const nextIndex = (currentMatchIndex + delta + matches.length) % matches.length
    selectMatch(nextIndex)
  }

  const replaceCurrent = (): void => {
    if (!currentMatch || query.trim().length === 0) return
    onReplace(currentMatch.nodeId, query, replacement)
  }

  const replaceAll = (): void => {
    if (matches.length === 0 || query.trim().length === 0) return
    onReplaceAll(
      matches.map((match) => match.nodeId),
      query,
      replacement
    )
  }

  return (
    <section className="mindmap-search" aria-labelledby={`${queryId}-title`}>
      <div className="mindmap-search__head">
        <strong id={`${queryId}-title`}>
          <Search size={13} aria-hidden="true" />
          {t('mindmap.search')}
        </strong>
        <span aria-live="polite">{t('mindmap.searchResults', { count: matches.length })}</span>
      </div>
      <div className="mindmap-search__fields">
        <label htmlFor={queryId}>{t('mindmap.searchLabel')}</label>
        <input
          id={queryId}
          type="search"
          value={query}
          placeholder={t('mindmap.searchPlaceholder')}
          aria-describedby={resultsId}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              moveMatch(event.shiftKey ? -1 : 1)
            }
          }}
        />
        <label htmlFor={replacementId}>{t('mindmap.replaceLabel')}</label>
        <input
          id={replacementId}
          type="text"
          value={replacement}
          placeholder={t('mindmap.replacePlaceholder')}
          onChange={(event) => setReplacement(event.currentTarget.value)}
        />
      </div>
      <div className="mindmap-search__actions">
        <button
          type="button"
          className="icon-button"
          aria-label={t('mindmap.previousMatch')}
          title={t('mindmap.previousMatch')}
          disabled={matches.length === 0}
          onClick={() => moveMatch(-1)}
        >
          <ArrowUp size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('mindmap.nextMatch')}
          title={t('mindmap.nextMatch')}
          disabled={matches.length === 0}
          onClick={() => moveMatch(1)}
        >
          <ArrowDown size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={currentMatch === undefined || query.trim().length === 0}
          onClick={replaceCurrent}
        >
          <Replace size={13} aria-hidden="true" />
          {t('mindmap.replace')}
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={matches.length === 0 || query.trim().length === 0}
          onClick={replaceAll}
        >
          <ReplaceAll size={13} aria-hidden="true" />
          {t('mindmap.replaceAll')}
        </button>
      </div>
      <div id={resultsId} className="mindmap-search__results" role="listbox" aria-label={t('mindmap.searchResultsLabel')}>
        {matches.length === 0 ? (
          <span className="mindmap-search__empty">{t('mindmap.noSearchResults')}</span>
        ) : (
          matches.map((match, index) => (
            <MindMapSearchResult
              key={match.nodeId}
              match={match}
              active={index === currentMatchIndex}
              fieldLabel={(field) => fieldLabel(t, field)}
              untitledLabel={t('mindmap.untitledTopic')}
              onClick={() => selectMatch(index)}
            />
          ))
        )}
      </div>
    </section>
  )
}

type MindMapSearchResultProps = {
  match: MindMapSearchMatch
  active: boolean
  fieldLabel: (field: MindMapSearchField) => string
  untitledLabel: string
  onClick: () => void
}

function MindMapSearchResult({ match, active, fieldLabel, untitledLabel, onClick }: MindMapSearchResultProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`mindmap-search__result${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      <span className="mindmap-search__result-title">{match.title.trim() || untitledLabel}</span>
      <span className="mindmap-search__result-fields">
        {match.fields.map(fieldLabel).join(' · ')}
      </span>
    </button>
  )
}

function fieldLabel(
  t: (key: string) => string,
  field: MindMapSearchField
): string {
  switch (field) {
    case 'title':
      return t('mindmap.searchFieldTitle')
    case 'note':
      return t('mindmap.searchFieldNote')
    case 'label':
      return t('mindmap.searchFieldLabel')
    case 'link':
      return t('mindmap.searchFieldLink')
  }
}
