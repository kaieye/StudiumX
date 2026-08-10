import { AlertTriangle, Check, ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapSourceRef, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import type {
  MindMapSourceRefreshApplyResult,
  MindMapSourceRefreshEntry,
  MindMapSourceRefreshPreviewResult
} from '../../../../shared/teaching-types/mindmap'
import {
  collectMindMapSources,
  mindMapSourceDisplayName,
  mindMapSourceLocation,
  type MindMapSourceOccurrence
} from './mind-map-sources'

type MindMapSourcePanelProps = {
  root: MindMapTopicV2
  selectedNodeId: string | null
  onSelect: (nodeId: string) => void
  onOpenSource: (sourceRef: MindMapSourceRef) => void
  /** Workspace/document identity used by the source refresh IPC. */
  workspaceId?: string | null
  documentId?: string | null
  /** Adopt a document after the main process has committed confirmed metadata. */
  onSourceRefreshApplied?: (
    result: Extract<MindMapSourceRefreshApplyResult, { ok: true }>
  ) => void
}

type MindMapSourceRefreshApplyError = Extract<MindMapSourceRefreshApplyResult, { ok: false }>

type SourceRefreshState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: MindMapSourceRefreshPreviewResult; selectedIds: string[] }
  | { status: 'applying'; result: MindMapSourceRefreshPreviewResult; selectedIds: string[] }
  | { status: 'applied'; count: number }
  | {
      status: 'error'
      phase: 'preview' | 'apply'
      code?: MindMapSourceRefreshApplyError['code']
      expectedRevision?: number
      currentRevision?: number
    }

function isReviewableSourceRefreshEntry(entry: MindMapSourceRefreshEntry): boolean {
  // A writeback needs an observed file hash. Missing/unreadable/unsafe sources
  // stay review-only and cannot be silently marked fresh.
  return entry.changed && entry.currentContentHash !== undefined
}

function reviewableSourceIds(result: MindMapSourceRefreshPreviewResult): string[] {
  return result.entries.filter(isReviewableSourceRefreshEntry).map((entry) => entry.sourceRef.id)
}

/**
 * Shows source anchors explicitly attached to topics in the current sheet.
 * The panel never searches workspace content; it only renders the source refs
 * already present in the in-memory mind-map document.
 *
 * Refresh first produces a read-only, reviewable diff. Only entries selected by
 * the learner and confirmed with the apply button are sent to the main process;
 * the source file itself is never returned to or written by this component.
 */
export function MindMapSourcePanel({
  root,
  selectedNodeId,
  onSelect,
  onOpenSource,
  workspaceId = null,
  documentId = null,
  onSourceRefreshApplied
}: MindMapSourcePanelProps) {
  const { t } = useTranslation()
  const sources = useMemo(() => collectMindMapSources(root), [root])
  const [refreshState, setRefreshState] = useState<SourceRefreshState>({ status: 'idle' })
  const requestSerial = useRef(0)

  useEffect(() => {
    requestSerial.current += 1
    setRefreshState({ status: 'idle' })
    return () => {
      requestSerial.current += 1
    }
  }, [workspaceId, documentId])

  const canRefresh = Boolean(workspaceId && documentId && sources.length > 0)
  const isRefreshing = refreshState.status === 'loading' || refreshState.status === 'applying'

  const refreshSources = async (): Promise<void> => {
    if (!canRefresh || isRefreshing || !workspaceId || !documentId) return

    const serial = requestSerial.current + 1
    requestSerial.current = serial
    setRefreshState({ status: 'loading' })

    try {
      const api = window.teachingSystem
      if (!api?.previewMindMapSourceRefresh) throw new Error('Source refresh preview is unavailable.')
      const result = await api.previewMindMapSourceRefresh({
        workspaceId,
        id: documentId
      })
      if (requestSerial.current !== serial) return
      setRefreshState({
        status: 'success',
        result,
        selectedIds: reviewableSourceIds(result)
      })
    } catch {
      if (requestSerial.current !== serial) return
      setRefreshState({ status: 'error', phase: 'preview' })
    }
  }

  const toggleSource = (sourceId: string): void => {
    setRefreshState((state) => {
      if (state.status !== 'success') return state
      const selectedIds = state.selectedIds.includes(sourceId)
        ? state.selectedIds.filter((id) => id !== sourceId)
        : [...state.selectedIds, sourceId]
      return { ...state, selectedIds }
    })
  }

  const applySources = async (): Promise<void> => {
    if (
      refreshState.status !== 'success' ||
      refreshState.selectedIds.length === 0 ||
      !workspaceId ||
      !documentId
    ) {
      return
    }

    const { result, selectedIds } = refreshState
    const selected = result.entries.filter(
      (entry) => selectedIds.includes(entry.sourceRef.id) && isReviewableSourceRefreshEntry(entry)
    )
    if (selected.length === 0) return

    const serial = requestSerial.current + 1
    requestSerial.current = serial
    setRefreshState({ status: 'applying', result, selectedIds })

    try {
      const api = window.teachingSystem
      if (!api?.applyMindMapSourceRefresh) throw new Error('Source refresh apply is unavailable.')
      const applied = await api.applyMindMapSourceRefresh({
        workspaceId,
        id: documentId,
        expectedRevision: result.revision,
        updates: selected.map((entry) => ({
          sourceRef: {
            ...entry.sourceRef,
            contentHash: entry.currentContentHash,
            stale: false
          }
        }))
      })
      if (requestSerial.current !== serial) return
      if (!applied.ok) {
        setRefreshState({
          status: 'error',
          phase: 'apply',
          code: applied.code,
          expectedRevision: applied.code === 'revision_stale' ? applied.expectedRevision : undefined,
          currentRevision: applied.code === 'revision_stale' ? applied.currentRevision : undefined
        })
        return
      }
      onSourceRefreshApplied?.(applied)
      setRefreshState({ status: 'applied', count: applied.appliedSourceIds.length })
    } catch {
      if (requestSerial.current !== serial) return
      setRefreshState({ status: 'error', phase: 'apply' })
    }
  }

  return (
    <section className="mindmap-sources" aria-labelledby="mindmap-sources-title">
      <div className="mindmap-sources__head">
        <strong id="mindmap-sources-title">
          <FileText size={13} aria-hidden="true" />
          {t('mindmap.sources')}
        </strong>
        <div className="mindmap-sources__head-actions">
          <span>{t('mindmap.sourceCount', { count: sources.length })}</span>
          <button
            type="button"
            className="mindmap-sources__refresh"
            onClick={() => void refreshSources()}
            disabled={!canRefresh || isRefreshing}
            aria-busy={isRefreshing}
            aria-label={
              isRefreshing
                ? t('mindmap.sourceRefresh.checking')
                : t('mindmap.sourceRefresh.refresh')
            }
            title={t('mindmap.sourceRefresh.refresh')}
          >
            {isRefreshing ? (
              <Loader2 size={12} className="spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={12} aria-hidden="true" />
            )}
            <span>
              {isRefreshing
                ? t('mindmap.sourceRefresh.checkingShort')
                : t('mindmap.sourceRefresh.refresh')}
            </span>
          </button>
        </div>
      </div>
      <div className="mindmap-sources__list">
        {sources.length === 0 ? (
          <span className="mindmap-sources__empty">{t('mindmap.noSources')}</span>
        ) : (
          sources.map((source) => (
            <MindMapSourceItem
              key={source.sourceRef.id}
              source={source}
              selectedNodeId={selectedNodeId}
              untitledLabel={t('mindmap.untitledSource')}
              staleLabel={t('mindmap.sourceStale')}
              nodeCountLabel={(count) => t('mindmap.sourceNodeCount', { count })}
              openLabel={t('mindmap.openSource')}
              onSelect={onSelect}
              onOpenSource={onOpenSource}
            />
          ))
        )}
        <MindMapSourceRefreshFeedback
          state={refreshState}
          onToggle={toggleSource}
          onApply={() => void applySources()}
        />
      </div>
    </section>
  )
}

type MindMapSourceRefreshFeedbackProps = {
  state: SourceRefreshState
  onToggle: (sourceId: string) => void
  onApply: () => void
}

function MindMapSourceRefreshFeedback({
  state,
  onToggle,
  onApply
}: MindMapSourceRefreshFeedbackProps) {
  const { t } = useTranslation()
  if (state.status === 'idle') return null

  if (state.status === 'loading') {
    return (
      <div className="mindmap-sources__refresh-status" role="status" aria-live="polite">
        <Loader2 size={12} className="spin" aria-hidden="true" />
        <span>{t('mindmap.sourceRefresh.checking')}</span>
      </div>
    )
  }

  if (state.status === 'applying') {
    return (
      <div className="mindmap-sources__refresh-status" role="status" aria-live="polite">
        <Loader2 size={12} className="spin" aria-hidden="true" />
        <span>{t('mindmap.sourceRefresh.applying')}</span>
      </div>
    )
  }

  if (state.status === 'applied') {
    return (
      <div className="mindmap-sources__refresh-success" role="status" aria-live="polite">
        <Check size={12} aria-hidden="true" />
        <span>{t('mindmap.sourceRefresh.applied', { count: state.count })}</span>
      </div>
    )
  }

  if (state.status === 'error') {
    const message =
      state.phase === 'preview'
        ? t('mindmap.sourceRefresh.error')
        : state.code === 'revision_stale'
          ? t('mindmap.sourceRefresh.revisionStale', {
              expectedRevision: state.expectedRevision ?? '?',
              currentRevision: state.currentRevision ?? '?'
            })
          : state.code === 'source_unknown'
            ? t('mindmap.sourceRefresh.sourceUnknown')
            : state.code === 'source_conflict'
              ? t('mindmap.sourceRefresh.sourceConflict')
              : t('mindmap.sourceRefresh.applyError')
    return (
      <div className="mindmap-sources__refresh-error" role="alert" aria-live="assertive">
        {message}
      </div>
    )
  }

  return (
    <MindMapSourceRefreshResult
      result={state.result}
      selectedIds={state.selectedIds}
      onToggle={onToggle}
      onApply={onApply}
      applying={false}
    />
  )
}

type MindMapSourceRefreshResultProps = {
  result: MindMapSourceRefreshPreviewResult
  selectedIds: string[]
  onToggle: (sourceId: string) => void
  onApply: () => void
  applying: boolean
}

function MindMapSourceRefreshResult({
  result,
  selectedIds,
  onToggle,
  onApply,
  applying
}: MindMapSourceRefreshResultProps) {
  const { t } = useTranslation()
  const resultLabel = t('mindmap.sourceRefresh.resultsLabel')
  const reviewableCount = result.entries.filter(isReviewableSourceRefreshEntry).length
  const summary =
    result.entries.length === 0
      ? t('mindmap.sourceRefresh.noEntries')
      : result.changedCount === 0 && result.attentionCount === 0
        ? t('mindmap.sourceRefresh.noChanges')
        : t('mindmap.sourceRefresh.summary', {
            count: result.entries.length,
            changed: result.changedCount,
            attention: result.attentionCount
          })

  return (
    <div className="mindmap-sources__refresh-result" aria-label={resultLabel}>
      <div className="mindmap-sources__refresh-summary" role="status" aria-live="polite">
        {summary}
      </div>
      {reviewableCount > 0 ? (
        <div className="mindmap-sources__refresh-actions">
          <span>{t('mindmap.sourceRefresh.selectHint')}</span>
          <button
            type="button"
            className="mindmap-sources__apply"
            onClick={onApply}
            disabled={applying || selectedIds.length === 0}
          >
            {applying ? <Loader2 size={11} className="spin" aria-hidden="true" /> : null}
            {t('mindmap.sourceRefresh.apply', { count: selectedIds.length })}
          </button>
        </div>
      ) : null}
      {result.entries.length > 0 ? (
        <ul className="mindmap-sources__refresh-list" aria-label={resultLabel}>
          {result.entries.map((entry) => (
            <MindMapSourceRefreshEntryView
              key={entry.sourceRef.id}
              entry={entry}
              selected={selectedIds.includes(entry.sourceRef.id)}
              selectable={isReviewableSourceRefreshEntry(entry)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

type MindMapSourceRefreshEntryProps = {
  entry: MindMapSourceRefreshEntry
  selected: boolean
  selectable: boolean
  onToggle: (sourceId: string) => void
}

function MindMapSourceRefreshEntryView({
  entry,
  selected,
  selectable,
  onToggle
}: MindMapSourceRefreshEntryProps) {
  const { t } = useTranslation()
  const title = mindMapSourceDisplayName(entry.sourceRef, t('mindmap.untitledSource'))
  const location = mindMapSourceLocation(entry.sourceRef)
  const statusLabel = t(`mindmap.sourceRefresh.status.${entry.status}`)
  const hasPreviousHash = entry.previousContentHash !== undefined
  const hasCurrentHash = entry.currentContentHash !== undefined
  const hasHashDiff =
    hasPreviousHash !== hasCurrentHash ||
    (hasPreviousHash && hasCurrentHash && entry.previousContentHash !== entry.currentContentHash)
  const hasChangedField = hasHashDiff || entry.change !== 'unchanged'

  return (
    <li className={`mindmap-sources__refresh-entry is-${entry.status}`}>
      <div className="mindmap-sources__refresh-entry-head">
        {selectable ? (
          <label className="mindmap-sources__refresh-select">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggle(entry.sourceRef.id)}
              aria-label={t('mindmap.sourceRefresh.select', { title })}
            />
            <strong title={title}>{title}</strong>
          </label>
        ) : (
          <strong title={title}>{title}</strong>
        )}
        <span>{statusLabel}</span>
      </div>
      {location ? <span className="mindmap-sources__refresh-location">{location}</span> : null}
      {hasChangedField ? (
        <dl className="mindmap-sources__refresh-diff">
          {hasHashDiff ? (
            <>
              {hasPreviousHash ? (
                <div>
                  <dt>{t('mindmap.sourceRefresh.previousHash')}</dt>
                  <dd><code>{entry.previousContentHash}</code></dd>
                </div>
              ) : null}
              {hasCurrentHash ? (
                <div>
                  <dt>{t('mindmap.sourceRefresh.currentHash')}</dt>
                  <dd><code>{entry.currentContentHash}</code></dd>
                </div>
              ) : null}
            </>
          ) : null}
          <div>
            <dt>{t('mindmap.sourceRefresh.changeLabel')}</dt>
            <dd>{t(`mindmap.sourceRefresh.change.${entry.change}`)}</dd>
          </div>
        </dl>
      ) : (
        <span className="mindmap-sources__refresh-unchanged">
          {t('mindmap.sourceRefresh.unchanged')}
        </span>
      )}
    </li>
  )
}

type MindMapSourceItemProps = {
  source: MindMapSourceOccurrence
  selectedNodeId: string | null
  untitledLabel: string
  staleLabel: string
  nodeCountLabel: (count: number) => string
  openLabel: string
  onSelect: (nodeId: string) => void
  onOpenSource: (sourceRef: MindMapSourceRef) => void
}

function MindMapSourceItem({
  source,
  selectedNodeId,
  untitledLabel,
  staleLabel,
  nodeCountLabel,
  openLabel,
  onSelect,
  onOpenSource
}: MindMapSourceItemProps) {
  const title = mindMapSourceDisplayName(source.sourceRef, untitledLabel)
  const location = mindMapSourceLocation(source.sourceRef)
  const isSelected = selectedNodeId !== null && source.nodeIds.includes(selectedNodeId)
  const nodeTitles = source.nodeTitles.filter((value) => value.trim().length > 0).join(', ')

  return (
    <button
      type="button"
      className={`mindmap-sources__item${isSelected ? ' is-selected' : ''}`}
      aria-pressed={isSelected}
      aria-label={`${title} — ${openLabel}`}
      onClick={() => {
        const firstNodeId = source.nodeIds[0]
        if (firstNodeId) onSelect(firstNodeId)
        onOpenSource(source.sourceRef)
      }}
    >
      <span className="mindmap-sources__item-title">
        {source.sourceRef.stale === true ? <AlertTriangle size={12} aria-hidden="true" /> : null}
        {title}
      </span>
      {location ? <span className="mindmap-sources__item-location">{location}</span> : null}
      <span className="mindmap-sources__item-meta">
        {source.sourceRef.stale === true ? `${staleLabel} · ` : ''}
        {nodeCountLabel(source.nodeIds.length)}
        {nodeTitles ? ` · ${nodeTitles}` : ''}
        <ExternalLink size={11} aria-hidden="true" />
      </span>
    </button>
  )
}
