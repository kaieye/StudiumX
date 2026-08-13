import { Loader2, PanelRightClose, SendHorizontal, Sparkles, Square } from 'lucide-react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapProposalDecision } from '../../../../shared/mindmap/commands/mind-map-proposal'
import type { MindMapStreamStatus } from '../../../../shared/teaching-types/mindmap'
import { useAppStore } from '../../app-shell/appStore'
import { useMindMapViewStore } from './mind-map-view-store'
import { MindMapMarkersPanel } from './MindMapMarkersPanel'
import { MindMapNotesPanel } from './MindMapNotesPanel'
import { MindMapThemeGallery } from './MindMapThemeGallery'
import { MindMapThemePanel } from './MindMapThemePanel'
import { MindMapTopicStyleInspector } from './MindMapTopicStyleInspector'
import { MindMapCanvasOptionsPanel } from './MindMapCanvasOptionsPanel'
import { MindMapElementStyleInspector } from './MindMapElementStyleInspector'

type MindMapAiGenerationMessage = {
  generationId: string
  prompt: string
  preview: string
  status: 'generating' | 'completed' | 'cancelled' | 'error'
  error?: string
}

/**
 * AI chat panel for the mind map (docs/mindmap/design.md §6.5).
 *
 * The conversation edits the current canvas directly: sending a message asks
 * the provider for a proposal against the active sheet and applies every item
 * immediately — no review or approval step. When no document is open yet, it
 * falls back to generating a brand-new document from the prompt.
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
  const selection = useMindMapViewStore((s) => s.selection)

  const [streamStep, setStreamStep] = useState<MindMapStreamStatus['step']>('calling')
  const [generationMessages, setGenerationMessages] = useState<MindMapAiGenerationMessage[]>([])

  const generationRef = useRef<{
    workspaceId: string
    generationId: string
    prompt: string
  } | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const threadShouldStickRef = useRef(true)

  useEffect(() => {
    const api = window.teachingSystem
    if (!api?.onMindMapStreamChunk) return undefined

    const offChunk = api.onMindMapStreamChunk((chunk) => {
      if (generationRef.current?.generationId !== chunk.generationId) return
      useMindMapViewStore.setState((state) => ({
        streamText: state.streamText + chunk.delta
      }))
      setGenerationMessages((messages) => messages.map((message) => (
        message.generationId === chunk.generationId
          ? { ...message, preview: message.preview + chunk.delta }
          : message
      )))
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

  /** Apply a provider diff to the open canvas immediately, without review. */
  const editCurrentCanvas = async (
    workspace: string,
    documentId: string,
    sheetId: string,
    prompt: string,
    generationId: string
  ): Promise<void> => {
    const generated = await window.teachingSystem?.generateMindMapProposal({
      workspaceId: workspace,
      id: documentId,
      scope: 'sheet',
      sheetId,
      selectedTopicIds: [],
      sourceRefs: [],
      prompt,
      generationId
    })
    if (!generated) throw new Error(t('mindmap.aiProposalUnavailable'))
    if (generated.documentId !== documentId) {
      throw new Error(t('mindmap.aiProposalDocumentMismatch'))
    }

    // No approval step: every proposed item is accepted and applied directly.
    const decisions: Record<string, MindMapProposalDecision> = {}
    for (const item of generated.proposal.items) {
      decisions[item.id] = 'accept'
    }
    const applied = await window.teachingSystem?.applyMindMapProposal({
      workspaceId: workspace,
      id: documentId,
      expectedRevision: generated.revision,
      proposal: generated.proposal,
      decisions
    })
    if (!applied) throw new Error(t('mindmap.aiProposalUnavailable'))
    if (!applied.ok) {
      if (applied.code === 'revision_stale') {
        throw new Error(
          t('mindmap.aiProposalRevisionStale', {
            expected: applied.expectedRevision,
            current: applied.currentRevision
          })
        )
      }
      throw new Error(`${t('mindmap.aiProposalApplyError')}: ${applied.error.message}`)
    }

    // A cancelled run must not adopt a late result.
    if (generationRef.current?.generationId !== generationId) return
    useMindMapViewStore.getState().adoptCommittedDocument(applied.document, {
      inverse: applied.inverse,
      label: t('mindmap.aiProposalUndoLabel')
    })
    setGenerationMessages((messages) => messages.map((message) => (
      message.generationId === generationId
        ? { ...message, status: 'completed' }
        : message
    )))
  }

  /** Fallback when no document is open yet: generate a brand-new document. */
  const generateNewDocument = async (
    workspace: string,
    prompt: string,
    generationId: string
  ): Promise<void> => {
    const generated = await window.teachingSystem?.generateMindMap({
      workspaceId: workspace,
      title: prompt.slice(0, 40) || 'AI 导图',
      prompt,
      generationId
    })
    // A provider may settle just after the user clicked cancel. Never adopt
    // a late result from a generation whose local cancellation lease ended.
    if (!generated && generationRef.current?.generationId === generationId) {
      throw new Error(t('mindmap.aiError'))
    }
    if (generated && generationRef.current?.generationId === generationId) {
      const rootId = generated.sheets[0]?.root.id ?? null
      useMindMapViewStore.setState({
        current: generated,
        selection: rootId ? { kind: 'topic', topicIds: [rootId] } : { kind: 'canvas' },
        selectedNodeId: rootId,
        activeSheetId: generated.sheets[0]?.id ?? null,
        streamText: '',
        aiPrompt: ''
      })
      setGenerationMessages((messages) => messages.map((message) => (
        message.generationId === generationId
          ? { ...message, status: 'completed' }
          : message
      )))
      void useMindMapViewStore.getState().loadDocuments()
    }
  }

  const runGeneration = async (prompt: string): Promise<void> => {
    if (useMindMapViewStore.getState().generating) return
    const workspace = useAppStore.getState().appState?.activeWorkspace?.id ?? null
    if (!workspace) return
    const generationId = crypto.randomUUID()
    const submittedPrompt = prompt.trim()
    generationRef.current = { workspaceId: workspace, generationId, prompt: submittedPrompt }
    setGenerationMessages((messages) => [
      ...messages,
      { generationId, prompt: submittedPrompt, preview: '', status: 'generating' }
    ])
    setStreamStep('calling')
    useMindMapViewStore.setState({ generating: true, streamText: '', error: null })
    try {
      const current = useMindMapViewStore.getState().current
      const sheetId = useMindMapViewStore.getState().activeSheetId ?? current?.sheets[0]?.id
      if (current && sheetId) {
        await editCurrentCanvas(workspace, current.id, sheetId, submittedPrompt, generationId)
      } else {
        await generateNewDocument(workspace, submittedPrompt, generationId)
      }
    } catch (caught) {
      // A cancelled run is intentionally not an error panel; the user already
      // asked to stop it.
      if (generationRef.current?.generationId === generationId) {
        const message = caught instanceof Error ? caught.message : String(caught)
        useMindMapViewStore.setState({ error: message, aiPrompt: submittedPrompt })
        setGenerationMessages((messages) => messages.map((entry) => (
          entry.generationId === generationId
            ? { ...entry, status: 'error', error: message }
            : entry
        )))
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
    const { workspaceId, generationId, prompt } = active
    generationRef.current = null
    setStreamStep('cancelled')
    setGenerationMessages((messages) => messages.map((message) => (
      message.generationId === generationId
        ? { ...message, status: 'cancelled' }
        : message
    )))
    useMindMapViewStore.setState({ generating: false, aiPrompt: prompt })
    try {
      void window.teachingSystem?.cancelMindMapGeneration({ workspaceId, generationId })
    } catch {
      // Best-effort: the local generation promise settles independently and the
      // main process/provider abort is fire-and-forget from the renderer.
    }
  }

  const submitPrompt = (): void => {
    if (!canSubmit) return
    const workspace = useAppStore.getState().appState?.activeWorkspace?.id ?? null
    if (!workspace) return
    const prompt = aiPrompt.trim()
    setAiPrompt('')
    void runGeneration(prompt)
  }

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    submitPrompt()
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submitPrompt()
  }

  const retryGeneration = (prompt: string): void => {
    if (generating || !prompt.trim()) return
    setAiPrompt('')
    void runGeneration(prompt)
  }

  const updateThreadStickiness = (): void => {
    const thread = threadRef.current
    if (!thread) return
    threadShouldStickRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 24
  }

  useEffect(() => {
    const thread = threadRef.current
    if (!thread || !threadShouldStickRef.current) return
    thread.scrollTop = thread.scrollHeight
  }, [generationMessages])

  const inspectorTab = useMindMapViewStore((s) => s.inspectorTab)
  const setInspectorTab = useMindMapViewStore((s) => s.setInspectorTab)

  return (
    <aside className={`mindmap-ai-panel${open ? '' : ' is-collapsed'}`} aria-label={t('mindmap.inspector.title')}>
      <div className="mindmap-inspector-tabs" role="tablist" aria-label={t('mindmap.inspector.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={inspectorTab === 'format'}
          className={`mindmap-inspector-tab${inspectorTab === 'format' ? ' is-active' : ''}`}
          onClick={() => setInspectorTab('format')}
        >
          {t('mindmap.inspector.format')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={inspectorTab === 'content'}
          className={`mindmap-inspector-tab${inspectorTab === 'content' ? ' is-active' : ''}`}
          onClick={() => setInspectorTab('content')}
        >
          {t('mindmap.inspector.content')}
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
      {inspectorTab === 'format' ? (
        <div className="mindmap-inspector-tab-content">
          <MindMapThemeGallery />
          <MindMapThemePanel />
          <MindMapCanvasOptionsPanel />
        </div>
      ) : inspectorTab === 'content' ? (
        <div className="mindmap-inspector-tab-content mindmap-inspector-tab-content--content">
          {selection.kind === 'topic' ? (
            <>
              <MindMapTopicStyleInspector />
              <div id="mindmap-inspector-notes">
                <MindMapNotesPanel />
              </div>
              <div id="mindmap-inspector-markers">
                <MindMapMarkersPanel />
              </div>
            </>
          ) : selection.kind === 'element' ? (
            <MindMapElementStyleInspector />
          ) : (
            <div className="mindmap-inspector-empty" role="status">
              {t('mindmap.inspector.contentTopicOnly')}
            </div>
          )}
        </div>
      ) : (
        <div className="mindmap-inspector-tab-content mindmap-inspector-tab-content--ai">
          <div className="mindmap-ai-panel__conversation">
            <div
              ref={threadRef}
              className="mindmap-ai-panel__thread"
              role="log"
              aria-label={t('mindmap.inspector.ai')}
              aria-live="off"
              onScroll={updateThreadStickiness}
            >
              {generationMessages.length === 0 && !error ? (
                <div className="mindmap-ai-panel__empty">
                  <Sparkles size={18} aria-hidden="true" />
                  <strong>{t('mindmap.aiTitle')}</strong>
                </div>
              ) : null}

              {generationMessages.map((message) => {
                const active = message.status === 'generating'
                const preview = message.preview || (active ? streamText : '')
                return (
                  <div className="mindmap-ai-panel__exchange" key={message.generationId}>
                    <div className="mindmap-ai-panel__turn mindmap-ai-panel__turn--user">
                      <p className="mindmap-ai-panel__message mindmap-ai-panel__message--user">
                        {message.prompt}
                      </p>
                    </div>
                    <div className="mindmap-ai-panel__turn mindmap-ai-panel__turn--assistant">
                      <article
                        className={`mindmap-ai-panel__message mindmap-ai-panel__message--assistant${message.status === 'error' ? ' is-error' : ''}`}
                        data-stream-step={active ? streamStep : undefined}
                        data-generation-status={message.status}
                      >
                        <div className="mindmap-ai-panel__message-status">
                          {active ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
                          <span>
                            {active
                              ? t('mindmap.aiStreaming')
                              : message.status === 'cancelled'
                                ? t('mindmap.aiStreamCancelled')
                                : message.status === 'error'
                                  ? t('mindmap.aiError')
                                  : preview
                                    ? t('mindmap.aiStreamPreview')
                                    : t('mindmap.aiApplied')}
                          </span>
                        </div>
                        {preview ? <pre className="mindmap-ai-panel__message-preview">{preview}</pre> : null}
                        {message.error ? <p className="mindmap-ai-panel__message-error">{message.error}</p> : null}
                        {message.status === 'error' ? (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => retryGeneration(message.prompt)}
                            disabled={generating}
                          >
                            {t('mindmap.retry')}
                          </button>
                        ) : null}
                        {message.status === 'generating' || message.status === 'cancelled' ? (
                          <span className="mindmap-ai-panel__message-announcement" role="status" aria-live="polite">
                            {message.status === 'generating'
                              ? t('mindmap.aiStreaming')
                              : t('mindmap.aiStreamCancelled')}
                          </span>
                        ) : null}
                      </article>
                    </div>
                  </div>
                )
              })}

              {error && generationMessages.length === 0 ? (
                <div className="mindmap-ai-panel__error" role="alert">
                  <span>{t('mindmap.aiError')}</span>
                  <p>{error}</p>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => retryGeneration(aiPrompt.trim())}
                    disabled={generating || !aiPrompt.trim()}
                  >
                    {t('mindmap.retry')}
                  </button>
                </div>
              ) : null}
            </div>

            <form className="mindmap-ai-panel__composer" onSubmit={onSubmit}>
              <label className="mindmap-ai-panel__composer-label" htmlFor="mindmap-ai-prompt">
                {t('mindmap.aiPromptLabel')}
              </label>
              <div className="mindmap-ai-panel__composer-box">
                <textarea
                  id="mindmap-ai-prompt"
                  className="mindmap-ai-panel__input"
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.currentTarget.value)}
                  onKeyDown={onComposerKeyDown}
                  placeholder={t('mindmap.aiPromptPlaceholder')}
                  rows={2}
                  disabled={generating}
                />
                {generating ? (
                  <button
                    type="button"
                    className="mindmap-ai-panel__send"
                    onClick={cancelGeneration}
                    aria-label={t('mindmap.aiCancel')}
                    title={t('mindmap.aiCancel')}
                  >
                    <Square size={14} aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="mindmap-ai-panel__send"
                    disabled={!canSubmit}
                    aria-label={t('mindmap.aiGenerate')}
                    title={t('mindmap.aiGenerate')}
                  >
                    <SendHorizontal size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  )
}
