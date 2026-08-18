import type {
  AgentConversationProvenanceItem,
  AgentConversationTurnPresentation
} from '../../agent-conversation-presentation'
import { AgentConversationReader } from '../agent-conversation/AgentConversationReader'
import type { MindMapStreamStatus } from '../../../../shared/teaching-types/mindmap'
import { useTranslation } from 'react-i18next'

export type MindMapGenerationMode = 'create' | 'edit'
export type MindMapGenerationStep = MindMapStreamStatus['step'] | 'applying'
export type MindMapGenerationOutcome = 'generating' | 'completed' | 'no_changes' | 'cancelled' | 'error'

export type MindMapGenerationProcessProps = {
  generationId: string
  mode: MindMapGenerationMode
  step: MindMapGenerationStep
  status: MindMapGenerationOutcome
  /** Terminal lifecycle status received from the host, before the invoke settles. */
  terminalStep?: 'error' | 'cancelled'
}

type ProcessStage = {
  key: string
  label: string
  kind: AgentConversationProvenanceItem['kind']
}

/**
 * Adapts the mind-map provider lifecycle to the same learner-facing process
 * surface used by the main conversation. These are application steps derived
 * from real IPC/provider/persistence boundaries; they are not model chain of
 * thought and never claim that a tool was invoked when it was not.
 */
export function MindMapGenerationProcess({
  generationId,
  mode,
  step,
  status,
  terminalStep
}: MindMapGenerationProcessProps) {
  const { t } = useTranslation()
  const stages = stagesFor(mode, t)
  const terminal = terminalStep ?? (status === 'error' ? 'error' : status === 'cancelled' ? 'cancelled' : null)
  const currentIndex = stageIndexForStep(step, stages.length)
  const processStatus = terminal === 'error'
    ? { kind: 'failed' as const }
    : terminal === 'cancelled'
      ? { kind: 'canceled' as const }
      : status === 'completed' || step === 'done'
        ? { kind: 'completed' as const }
        : { kind: 'active' as const }

  const items: AgentConversationProvenanceItem[] = stages.map((stage, index) => {
    const state = stateForStage({
      index,
      currentIndex,
      terminal,
      completed: processStatus.kind === 'completed',
      noChanges: status === 'no_changes',
      isLastStage: index === stages.length - 1
    })
    return {
      // AgentProcessReader treats provenance ids as immutable events so it can
      // animate a repeated status row when a new event arrives. This adapter
      // projects one lifecycle stage repeatedly as it advances, therefore the
      // state must be part of its event id; otherwise a settled/error/cancelled
      // state can leave a stale "waiting" or "running" description in the UI.
      id: `${generationId}:process:${stage.key}:${state}`,
      kind: stage.kind,
      label: stage.label,
      detail: detailForState(state, t, status === 'no_changes', index === stages.length - 1),
      state
    }
  })

  const presentation: AgentConversationTurnPresentation = {
    turnId: `${generationId}:process`,
    active: processStatus.kind === 'active',
    status: processStatus,
    items,
    answeredAsks: [],
    sources: []
  }

  return <AgentConversationReader presentation={presentation} compact />
}

function stagesFor(
  mode: MindMapGenerationMode,
  t: (key: string) => string
): ProcessStage[] {
  if (mode === 'edit') {
    return [
      // This is a provider lifecycle status, not private model reasoning.
      // Keeping it a status row preserves the concrete learner-facing stage.
      { key: 'reasoning', label: t('mindmap.aiProcess.editReasoning'), kind: 'status' },
      { key: 'proposal', label: t('mindmap.aiProcess.editGeneration'), kind: 'status' },
      { key: 'validation', label: t('mindmap.aiProcess.editValidation'), kind: 'status' },
      { key: 'apply', label: t('mindmap.aiProcess.editApplying'), kind: 'status' }
    ]
  }
  return [
    // This is a provider lifecycle status, not private model reasoning.
    // Keeping it a status row preserves the concrete learner-facing stage.
    { key: 'reasoning', label: t('mindmap.aiProcess.createReasoning'), kind: 'status' },
    { key: 'generation', label: t('mindmap.aiProcess.createGeneration'), kind: 'status' },
    { key: 'validation', label: t('mindmap.aiProcess.createValidation'), kind: 'status' },
    { key: 'rendering', label: t('mindmap.aiProcess.createRendering'), kind: 'status' }
  ]
}

function stageIndexForStep(step: MindMapGenerationStep, stageCount: number): number {
  switch (step) {
    case 'calling': return 0
    case 'streaming': return Math.min(1, stageCount - 1)
    case 'validating': return Math.min(2, stageCount - 1)
    case 'rendering':
    case 'applying': return Math.min(3, stageCount - 1)
    case 'done': return stageCount
    case 'error':
    case 'cancelled': return 0
  }
}

function stateForStage({
  index,
  currentIndex,
  terminal,
  completed,
  noChanges,
  isLastStage
}: {
  index: number
  currentIndex: number
  terminal: 'error' | 'cancelled' | null
  completed: boolean
  noChanges: boolean
  isLastStage: boolean
}): AgentConversationProvenanceItem['state'] {
  // Empty provider proposals are a normal no-change outcome. Validation did
  // finish, but there is no mutation to apply; retain a completed process card
  // while making that final stage explicit rather than implying a canvas write.
  if (noChanges && isLastStage) return 'complete'
  if (completed || index < currentIndex) return 'complete'
  if (terminal && index === currentIndex) return terminal === 'error' ? 'error' : 'canceled'
  if (!terminal && index === currentIndex) return 'active'
  return 'pending'
}

function detailForState(
  state: AgentConversationProvenanceItem['state'],
  t: (key: string) => string,
  noChanges = false,
  isLastStage = false
): string {
  if (noChanges && isLastStage) return t('mindmap.aiProcess.noChanges')
  switch (state) {
    case 'active': return t('mindmap.aiProcess.active')
    case 'complete': return t('mindmap.aiProcess.complete')
    case 'error': return t('mindmap.aiProcess.error')
    case 'canceled': return t('mindmap.aiProcess.cancelled')
    default: return t('mindmap.aiProcess.pending')
  }
}
