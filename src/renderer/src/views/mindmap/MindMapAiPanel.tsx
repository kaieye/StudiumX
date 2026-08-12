import { FileText, Flag, Loader2, PanelRightClose, Sparkles, X } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  buildMindMapProposalReviewPreview,
  createMindMapProposalState,
  setMindMapProposalDecision,
  transitionMindMapProposal,
  type MindMapProposalReviewPreview
} from '../../../../shared/mindmap/commands'
import type {
  MindMapProposalDecision,
  MindMapProposalScope,
  MindMapProviderProposal
} from '../../../../shared/mindmap/commands/mind-map-proposal'
import type { MindMapDocumentV2, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import type {
  MindMapProposalGenerateResult,
  MindMapStreamStatus
} from '../../../../shared/teaching-types/mindmap'
import { useAppStore } from '../../app-shell/appStore'
import { useMindMapViewStore } from './mind-map-view-store'
import { MindMapMarkersPanel } from './MindMapMarkersPanel'
import { MindMapNotesPanel } from './MindMapNotesPanel'
import { MindMapThemeGallery } from './MindMapThemeGallery'
import { MindMapThemePanel } from './MindMapThemePanel'
import { MindMapTopicStyleInspector } from './MindMapTopicStyleInspector'
import { MindMapCanvasOptionsPanel } from './MindMapCanvasOptionsPanel'

type MindMapReviewScope = Extract<
  MindMapProposalScope,
  'selection' | 'sheet' | 'source' | 'selected-file' | 'notes' | 'lesson'
>

type MindMapProposalReview = MindMapProposalReviewPreview & {
  /** Provider output remains renderer data until the explicit apply action. */
  proposal: MindMapProviderProposal | null
  /** Revision returned by read-only generation and used as the apply CAS. */
  revision: number | null
  /** Snapshot held while the proposal is under review. */
  baseDocument: MindMapDocumentV2
}

/**
 * AI-assisted mind-map generation panel (docs/mindmap/design.md §6.5).
 *
 * Collects a topic/prompt, drives the async generation, shows a live streaming
 * preview while generating, and surfaces errors with a retry affordance.
 *
 * Cancellation is propagated to the main process/provider through the
 * `cancelMindMapGeneration` IPC (generation-correlated by `generationId`), so
 * clicking cancel aborts the provider request instead of only hiding loading
 * (docs/mindmap/m0-baseline.md §2.1 P0 fix).
 */
type MindMapAiPanelProps = {
  /** P2 §5.2: whether the inspector is visible (controlled by the view store). */
  open: boolean
  /** Toggle the inspector visibility (header button + ⌘.). */
  onToggle: () => void
}

export function MindMapAiPanel({ open, onToggle }: MindMapAiPanelProps) {
  const { t } = useTranslation()
  const aiPrompt = useMindMapViewStore((s) => s.aiPrompt)
  const setAiPrompt = useMindMapViewStore((s) => s.setAiPrompt)
  const generating = useMindMapViewStore((s) => s.generating)
  const streamText = useMindMapViewStore((s) => s.streamText)
  const error = useMindMapViewStore((s) => s.error)
  const current = useMindMapViewStore((s) => s.current)
  const selectedNodeId = useMindMapViewStore((s) => s.selectedNodeId)
  const activeSheetId = useMindMapViewStore((s) => s.activeSheetId)
  const appState = useAppStore((state) => state.appState)
  const selectedMarkdownDocument = useAppStore((state) => state.selectedMarkdownDocument)
  const selectedCoursePreviewFile = useAppStore((state) => state.selectedCoursePreviewFile)
  const selectedLesson = appState.activeWorkspace?.lessons.find(
    (lesson) => lesson.absolutePath === appState.selectedLessonPath
  ) ?? null
  const selectedFilePath =
    selectedMarkdownDocument?.relativePath ?? selectedCoursePreviewFile?.relativePath ?? null

  const [proposalScope, setProposalScope] = useState<MindMapReviewScope>(() =>
    selectedNodeId
      ? 'selection'
      : selectedLesson
        ? 'lesson'
        : selectedFilePath
          ? 'selected-file'
          : 'sheet'
  )
  const [reviewPreview, setReviewPreview] = useState<MindMapProposalReview | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [proposalGenerating, setProposalGenerating] = useState(false)
  const [proposalApplying, setProposalApplying] = useState(false)
  const [applyOutcome, setApplyOutcome] = useState<{
    accepted: number
    rejected: number
  } | null>(null)
  const [streamStep, setStreamStep] = useState<MindMapStreamStatus['step']>('calling')

  const generationRef = useRef<{ workspaceId: string; generationId: string } | null>(null)

  useEffect(() => {
    const api = window.teachingSystem
    if (!api?.onMindMapStreamChunk) return undefined

    const offChunk = api.onMindMapStreamChunk((chunk) => {
      if (generationRef.current?.generationId !== chunk.generationId) return
      useMindMapViewStore.setState((state) => ({
        streamText: state.streamText + chunk.delta
      }))
    })
    const offStatus = api.onMindMapStreamStatus?.((status) => {
      if (generationRef.current?.generationId !== status.generationId) return
      setStreamStep(status.step)
    })

    return () => {
      offChunk()
      offStatus?.()
    }
  }, [])

  const canSubmit = !generating && aiPrompt.trim().length > 0

  const runGeneration = async (prompt: string): Promise<void> => {
    if (useMindMapViewStore.getState().generating) return
    const workspace = useAppStore.getState().appState?.activeWorkspace?.id ?? null
    if (!workspace) return
    const generationId = crypto.randomUUID()
    generationRef.current = { workspaceId: workspace, generationId }
    setStreamStep('calling')
    useMindMapViewStore.setState({ generating: true, streamText: '', error: null })
    try {
      const generated = await window.teachingSystem?.generateMindMap({
        workspaceId: workspace,
        title: prompt.slice(0, 40) || 'AI 导图',
        prompt,
        generationId
      })
      // A provider may settle just after the user clicked cancel. Never adopt
      // a late result from a generation whose local cancellation lease ended.
      if (generated && generationRef.current?.generationId === generationId) {
        useMindMapViewStore.setState({
          current: generated as typeof current,
          selectedNodeId: generated.sheets[0]?.root.id ?? null,
          streamText: '',
          aiPrompt: ''
        })
        void useMindMapViewStore.getState().loadDocuments()
      }
    } catch (caught) {
      // A cancelled run is intentionally not an error panel; the user already
      // asked to stop it.
      if (generationRef.current?.generationId === generationId) {
        useMindMapViewStore.setState({ error: caught instanceof Error ? caught.message : String(caught) })
      }
    } finally {
      if (generationRef.current?.generationId === generationId) {
        generationRef.current = null
        useMindMapViewStore.setState({ generating: false })
      }
    }
  }

  const cancelGeneration = (): void => {
    const active = generationRef.current
    if (!active) return
    const { workspaceId, generationId } = active
    generationRef.current = null
    setStreamStep('cancelled')
    useMindMapViewStore.setState({ generating: false })
    try {
      void window.teachingSystem?.cancelMindMapGeneration({ workspaceId, generationId })
    } catch {
      // Best-effort: the local generation promise settles independently and the
      // main process/provider abort is fire-and-forget from the renderer.
    }
  }

  const prepareReviewPreview = (): void => {
    if (!current) {
      setReviewPreview(null)
      setReviewError(t('mindmap.aiPreviewNoDocument'))
      setApplyOutcome(null)
      return
    }

    const sheetId = activeSheetId ?? current.sheets[0]?.id
    if (!sheetId) {
      setReviewPreview(null)
      setReviewError(t('mindmap.aiPreviewNoSheet'))
      setApplyOutcome(null)
      return
    }

    if (proposalScope === 'lesson' && !selectedLesson) {
      setReviewPreview(null)
      setReviewError(t('mindmap.aiPreviewNoLesson'))
      setApplyOutcome(null)
      return
    }

    if (proposalScope === 'selected-file' && !selectedFilePath) {
      setReviewPreview(null)
      setReviewError(t('mindmap.aiPreviewNoSelectedFile'))
      setApplyOutcome(null)
      return
    }

    const lessonRef = proposalScope === 'lesson' && selectedLesson
      ? {
          id: 'lesson:renderer-preview',
          workspacePath: selectedLesson.relativePath,
          contentHash: 'renderer-preview'
        }
      : undefined
    const selectedFileRef = proposalScope === 'selected-file' && selectedFilePath
      ? {
          id: 'selected-file:renderer-preview',
          workspacePath: selectedFilePath,
          contentHash: 'renderer-preview'
        }
      : undefined
    const notesRef = proposalScope === 'notes'
      ? {
          id: 'notes:renderer-preview',
          workspacePath: 'NOTES.md',
          contentHash: 'renderer-preview'
        }
      : undefined
    const result = buildMindMapProposalReviewPreview({
      document: current,
      scope: proposalScope,
      sheetId,
      selectedTopicIds: proposalScope === 'selection' && selectedNodeId ? [selectedNodeId] : [],
      selectedFileRef,
      notesRef,
      lessonRef
    })
    if (!result.ok) {
      setReviewPreview(null)
      setReviewError(result.message)
      setApplyOutcome(null)
      return
    }

    setReviewPreview({
      ...result.preview,
      proposal: null,
      revision: null,
      baseDocument: current
    })
    setReviewError(null)
    setApplyOutcome(null)
  }

  const generateProposal = async (): Promise<void> => {
    const review = reviewPreview
    const workspace = useAppStore.getState().appState?.activeWorkspace?.id ?? null
    if (!review || !current || !workspace || proposalGenerating || proposalApplying) return

    setProposalGenerating(true)
    setReviewError(null)
    setApplyOutcome(null)
    try {
      const generated = await window.teachingSystem?.generateMindMapProposal({
        workspaceId: workspace,
        id: current.id,
        scope: review.request.scope,
        sheetId: review.request.sheetId,
        selectedTopicIds: [...review.request.selectedTopicIds],
        sourceRefs: [...review.request.sourceRefs],
        ...(review.request.scope === 'lesson' && review.request.lesson
          ? { lesson: { workspacePath: review.request.lesson.workspacePath! } }
          : {}),
        ...(review.request.scope === 'selected-file' && review.request.selectedFile
          ? { selectedFile: { workspacePath: review.request.selectedFile.workspacePath! } }
          : {}),
        prompt: aiPrompt.trim()
      })
      if (!generated) throw new Error(t('mindmap.aiProposalUnavailable'))
      if (generated.documentId !== current.id) {
        throw new Error(t('mindmap.aiProposalDocumentMismatch'))
      }

      const proposalResult = generated as MindMapProposalGenerateResult
      setReviewPreview({
        request: proposalResult.request,
        proposal: proposalResult.proposal,
        revision: proposalResult.revision,
        baseDocument: current,
        state: createMindMapProposalState(
          proposalResult.proposal.proposalId,
          proposalResult.proposal.items
        )
      })
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setProposalGenerating(false)
    }
  }

  const reviewProposalItem = (itemId: string, decision: MindMapProposalDecision): void => {
    if (!reviewPreview?.proposal || reviewPreview.state.status !== 'pending') return
    try {
      const state = setMindMapProposalDecision(reviewPreview.state, itemId, decision)
      setReviewPreview({ ...reviewPreview, state })
      setReviewError(null)
      setApplyOutcome(null)
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const settleReview = (trigger: 'accept' | 'reject'): void => {
    if (!reviewPreview) return
    const result = transitionMindMapProposal(reviewPreview.state, { type: trigger })
    if (!result.ok) {
      setReviewError(result.reason ?? t('mindmap.aiPreviewTransitionError'))
      return
    }
    setReviewPreview({ ...reviewPreview, state: result.state })
    setReviewError(null)
  }

  const applyProposal = async (): Promise<void> => {
    const review = reviewPreview
    const workspace = useAppStore.getState().appState?.activeWorkspace?.id ?? null
    if (
      !review ||
      !review.proposal ||
      review.revision === null ||
      !current ||
      !workspace ||
      review.state.status !== 'pending' ||
      proposalApplying ||
      proposalGenerating
    ) {
      return
    }

    // A renderer edit made after generation must not be silently overwritten by
    // the host's revision-bound result. The main process still performs the
    // authoritative CAS check below.
    if (useMindMapViewStore.getState().current !== review.baseDocument) {
      setReviewError(t('mindmap.aiProposalLocalChanges'))
      return
    }

    setProposalApplying(true)
    setReviewError(null)
    setApplyOutcome(null)
    try {
      const applied = await window.teachingSystem?.applyMindMapProposal({
        workspaceId: workspace,
        id: current.id,
        expectedRevision: review.revision,
        proposal: review.proposal,
        decisions: { ...review.state.decisions }
      })
      if (!applied) throw new Error(t('mindmap.aiProposalUnavailable'))

      if (!applied.ok) {
        if (applied.code === 'revision_stale') {
          setReviewError(
            t('mindmap.aiProposalRevisionStale', {
              expected: applied.expectedRevision,
              current: applied.currentRevision
            })
          )
        } else {
          setReviewError(
            `${t('mindmap.aiProposalApplyError')}: ${applied.error.message}`
          )
        }
        return
      }

      const transition = transitionMindMapProposal(review.state, {
        type: applied.acceptedIds.length > 0 ? 'accept' : 'reject'
      })
      if (!transition.ok) {
        setReviewError(transition.reason ?? t('mindmap.aiPreviewTransitionError'))
        return
      }

      useMindMapViewStore.getState().adoptCommittedDocument(applied.document, {
        inverse: applied.inverse,
        label: t('mindmap.aiProposalUndoLabel')
      })
      setReviewPreview({ ...review, state: transition.state })
      setApplyOutcome({
        accepted: applied.acceptedIds.length,
        rejected: applied.rejectedIds.length
      })
      setReviewError(null)
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setProposalApplying(false)
    }
  }

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return
    void runGeneration(aiPrompt)
  }

  const inspectorTab = useMindMapViewStore((s) => s.inspectorTab)
  const setInspectorTab = useMindMapViewStore((s) => s.setInspectorTab)
  const selectedTopic = (() => {
    const sheet = current?.sheets.find((candidate) => candidate.id === activeSheetId) ?? current?.sheets[0]
    if (!sheet || !selectedNodeId) return null
    return findTopic(sheet.root, selectedNodeId)
  })()

  return (
    <aside className={`mindmap-ai-panel${open ? '' : ' is-collapsed'}`} aria-label={t('mindmap.inspector.title')}>
      {/* G15: Xmind-style segmented tabs sit directly at the top — the old
          icon+title+badge header row is gone. */}
      <div className="mindmap-inspector-tabs" role="tablist" aria-label={t('mindmap.inspector.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={inspectorTab === 'style'}
          className={`mindmap-inspector-tab${inspectorTab === 'style' ? ' is-active' : ''}`}
          onClick={() => setInspectorTab('style')}
        >
          {t('mindmap.inspector.style')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={inspectorTab === 'canvas'}
          className={`mindmap-inspector-tab${inspectorTab === 'canvas' ? ' is-active' : ''}`}
          onClick={() => setInspectorTab('canvas')}
        >
          {t('mindmap.inspector.canvas')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={inspectorTab === 'ai'}
          className={`mindmap-inspector-tab${inspectorTab === 'ai' ? ' is-active' : ''}`}
          onClick={() => setInspectorTab('ai')}
        >
          {t('mindmap.inspector.ai')}
        </button>
        <button
          type="button"
          className="mindmap-ai-panel__collapse icon-button"
          onClick={onToggle}
          title={t('mindmap.inspector.title')}
          aria-label={t('mindmap.inspector.title')}
        >
          <PanelRightClose size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="mindmap-inspector-context" aria-live="polite">
        <div className="mindmap-inspector-context__title">
          <span className="mindmap-inspector-context__eyebrow">{t('mindmap.inspector.selectedTopic')}</span>
          <strong title={selectedTopic?.title || t('mindmap.untitledTopic')}>
            {selectedTopic?.title || t('mindmap.inspector.noTopicSelected')}
          </strong>
        </div>
        {selectedTopic ? (
          <div className="mindmap-inspector-context__actions">
            <button type="button" onClick={() => { setInspectorTab('style'); requestAnimationFrame(() => document.getElementById('mindmap-inspector-notes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }}>
              <FileText size={13} aria-hidden="true" /> {t('mindmap.inspector.notesShortcut')}
            </button>
            <button type="button" onClick={() => { setInspectorTab('style'); requestAnimationFrame(() => document.getElementById('mindmap-inspector-markers')?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }}>
              <Flag size={13} aria-hidden="true" /> {t('mindmap.inspector.markersShortcut')}
            </button>
          </div>
        ) : null}
      </div>
      {inspectorTab === 'style' ? (
        <div className="mindmap-inspector-tab-content">
          <MindMapTopicStyleInspector />
          <div id="mindmap-inspector-notes">
            <MindMapNotesPanel />
          </div>
          <div id="mindmap-inspector-markers">
            <MindMapMarkersPanel />
          </div>
        </div>
      ) : inspectorTab === 'canvas' ? (
        <div className="mindmap-inspector-tab-content">
          <MindMapThemeGallery />
          <MindMapThemePanel />
          <MindMapCanvasOptionsPanel />
        </div>
      ) : (
        <div className="mindmap-inspector-tab-content mindmap-inspector-tab-content--ai">
      <form className="mindmap-ai-panel__form" onSubmit={onSubmit}>
        <label className="mindmap-ai-panel__label" htmlFor="mindmap-ai-prompt">
          {t('mindmap.aiPromptLabel')}
        </label>
        <textarea
          id="mindmap-ai-prompt"
          className="mindmap-ai-panel__input"
          value={aiPrompt}
          onChange={(event) => setAiPrompt(event.currentTarget.value)}
          placeholder={t('mindmap.aiPromptPlaceholder')}
          rows={4}
          disabled={generating}
        />
        <div className="mindmap-ai-panel__actions">
          {generating ? (
            <button type="button" className="ghost-button" onClick={cancelGeneration}>
              <X size={15} />
              {t('mindmap.aiCancel')}
            </button>
          ) : (
            <button type="submit" className="primary-button" disabled={!canSubmit}>
              <Sparkles size={15} />
              {t('mindmap.aiGenerate')}
            </button>
          )}
        </div>
      </form>

      <section className="mindmap-ai-panel__review" aria-label={t('mindmap.aiReviewTitle')}>
        <div className="mindmap-ai-panel__review-head">
          <strong>{t('mindmap.aiReviewTitle')}</strong>
          <span>
            {reviewPreview?.proposal
              ? t('mindmap.aiProposalProviderReview')
              : t('mindmap.aiReviewLocalOnly')}
          </span>
        </div>
        <label className="mindmap-ai-panel__label" htmlFor="mindmap-ai-review-scope">
          {t('mindmap.aiReviewScopeLabel')}
        </label>
        <select
          id="mindmap-ai-review-scope"
          className="mindmap-ai-panel__scope"
          value={proposalScope}
          onChange={(event) => setProposalScope(event.currentTarget.value as MindMapReviewScope)}
          disabled={generating || proposalGenerating || proposalApplying}
        >
          <option value="selection" disabled={!selectedNodeId}>
            {t('mindmap.aiReviewSelection')}
          </option>
          <option value="sheet">{t('mindmap.aiReviewSheet')}</option>
          <option value="source">{t('mindmap.aiReviewSource')}</option>
          <option value="selected-file" disabled={!selectedFilePath}>
            {t('mindmap.aiReviewSelectedFile')}
          </option>
          <option value="notes">{t('mindmap.aiReviewNotes')}</option>
          <option value="lesson" disabled={!selectedLesson}>
            {t('mindmap.aiReviewLesson')}
          </option>
        </select>
        {proposalScope === 'selected-file' && selectedFilePath ? (
          <p className="mindmap-ai-panel__review-note">
            {t('mindmap.aiReviewSelectedFilePath', { path: selectedFilePath })}
          </p>
        ) : null}
        {proposalScope === 'selected-file' && !selectedFilePath ? (
          <p className="mindmap-ai-panel__review-note">
            {t('mindmap.aiPreviewNoSelectedFile')}
          </p>
        ) : null}
        {proposalScope === 'notes' ? (
          <p className="mindmap-ai-panel__review-note">
            {t('mindmap.aiReviewNotesPath')}
          </p>
        ) : null}
        {proposalScope === 'lesson' && !selectedLesson ? (
          <p className="mindmap-ai-panel__review-note">
            {t('mindmap.aiPreviewNoLesson')}
          </p>
        ) : null}
        <button
          type="button"
          className="ghost-button"
          onClick={prepareReviewPreview}
          disabled={
            generating ||
            proposalGenerating ||
            proposalApplying ||
            !current ||
            (proposalScope === 'lesson' && !selectedLesson) ||
            (proposalScope === 'selected-file' && !selectedFilePath)
          }
        >
          {t('mindmap.aiPreviewRequest')}
        </button>

        {reviewPreview ? (
          <div className="mindmap-ai-panel__review-card">
            <p className="mindmap-ai-panel__review-note">
              {t('mindmap.aiPreviewReady')}
            </p>
            <details className="mindmap-ai-panel__request-details">
              <summary>{t('mindmap.aiRequestDetails')}</summary>
              <pre className="mindmap-ai-panel__request-json">
                {JSON.stringify(reviewPreview.request, null, 2)}
              </pre>
            </details>
            {!reviewPreview.proposal ? (
              <>
                <div className="mindmap-ai-panel__review-status" role="status" aria-live="polite">
                  {t(`mindmap.aiReviewStatus.${reviewPreview.state.status}`)}
                </div>
                <div className="mindmap-ai-panel__actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void generateProposal()}
                    disabled={
                      generating ||
                      proposalGenerating ||
                      proposalApplying ||
                      !aiPrompt.trim() ||
                      reviewPreview.state.status !== 'pending'
                    }
                  >
                    {proposalGenerating
                      ? t('mindmap.aiProposalGenerating')
                      : t('mindmap.aiGenerateProposal')}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => settleReview('reject')}
                    disabled={
                      generating ||
                      proposalGenerating ||
                      proposalApplying ||
                      reviewPreview.state.status !== 'pending'
                    }
                  >
                    {t('mindmap.aiReviewReject')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mindmap-ai-panel__review-status" role="status" aria-live="polite">
                  {t('mindmap.aiProposalReady', {
                    count: reviewPreview.proposal.items.length,
                    revision: reviewPreview.revision
                  })}
                </div>
                <ol className="mindmap-ai-panel__proposal-items">
                  {reviewPreview.proposal.items.map((item, index) => {
                    const decision = reviewPreview.state.decisions[item.id]
                    const pending = reviewPreview.state.status === 'pending'
                    return (
                      <li className="mindmap-ai-panel__proposal-item" key={item.id}>
                        <div className="mindmap-ai-panel__proposal-item-head">
                          <strong>
                            {t('mindmap.aiProposalItem', { index: index + 1 })}
                          </strong>
                          <code>{item.id}</code>
                        </div>
                        <details className="mindmap-ai-panel__request-details">
                          <summary>{t('mindmap.aiRequestDetails')}</summary>
                          <pre className="mindmap-ai-panel__request-json">
                            {JSON.stringify(item.command, null, 2)}
                          </pre>
                        </details>
                        <div className="mindmap-ai-panel__actions">
                          <button
                            type="button"
                            className="primary-button"
                            aria-pressed={decision === 'accept'}
                            onClick={() => reviewProposalItem(item.id, 'accept')}
                            disabled={!pending || proposalApplying}
                          >
                            {t('mindmap.aiProposalAcceptItem')}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            aria-pressed={decision === 'reject'}
                            onClick={() => reviewProposalItem(item.id, 'reject')}
                            disabled={!pending || proposalApplying}
                          >
                            {t('mindmap.aiProposalRejectItem')}
                          </button>
                          <span className="mindmap-ai-panel__proposal-decision" role="status">
                            {decision
                              ? t(`mindmap.aiProposalDecision.${decision}`)
                              : t('mindmap.aiProposalDecision.pending')}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ol>
                <div className="mindmap-ai-panel__actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void applyProposal()}
                    disabled={
                      generating ||
                      proposalGenerating ||
                      proposalApplying ||
                      reviewPreview.state.status !== 'pending' ||
                      Object.keys(reviewPreview.state.decisions).length === 0
                    }
                  >
                    {proposalApplying
                      ? t('mindmap.aiProposalApplying')
                      : t('mindmap.aiApplyProposal')}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {applyOutcome ? (
          <div className="mindmap-ai-panel__review-status" role="status" aria-live="polite">
            {t('mindmap.aiProposalApplied', applyOutcome)}
          </div>
        ) : null}

        {reviewError ? (
          <div className="mindmap-ai-panel__review-error" role="alert">
            {t('mindmap.aiPreviewError')}: {reviewError}
          </div>
        ) : null}
      </section>

      {generating || streamText ? (
        <div
          className="mindmap-ai-panel__stream"
          role="status"
          aria-live="polite"
          data-stream-step={streamStep}
        >
          {generating ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
          <span>
            {generating
              ? t('mindmap.aiStreaming')
              : streamStep === 'cancelled'
                ? t('mindmap.aiStreamCancelled')
                : t('mindmap.aiStreamPreview')}
          </span>
          {streamText ? <p className="mindmap-ai-panel__stream-text">{streamText}</p> : null}
        </div>
      ) : null}

      {error ? (
        <div className="mindmap-ai-panel__error" role="alert">
          <span>{t('mindmap.aiError')}</span>
          <p>{error}</p>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void runGeneration(aiPrompt || '')}
            disabled={generating}
          >
            {t('mindmap.retry')}
          </button>
        </div>
      ) : null}
        </div>
      )}
    </aside>
  )
}

function findTopic(node: MindMapTopicV2, id: string): MindMapTopicV2 | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findTopic(child, id)
    if (found) return found
  }
  return null
}
