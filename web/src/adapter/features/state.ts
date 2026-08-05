/**
 * Browser-safe bootstrap projection for the shared renderer App.
 *
 * The desktop renderer expects these three read-only calls during startup. A
 * browser session has no local workspace authority, so the Web adapter starts
 * with an explicit empty projection instead of throwing during `initialize`.
 * This preserves the desktop empty-state layout while keeping all teaching
 * execution and workspace mutation capabilities fail-closed in the base
 * adapter.
 */
import type { TeachingSystemApi } from '@shared/teaching-types/system-api'
import type { TeachingAppState } from '@shared/teaching-types/workspace'
import type { AgentRunTerminalNotice, InterruptedAgentRun } from '@shared/teaching-types/agent'

const EMPTY_STATE: TeachingAppState = {
  workspaces: [],
  activeWorkspace: null,
  temporaryConversations: [],
  previewHtml: '',
  previewUrl: '',
  selectedLessonPath: null,
  runtime: {
    status: 'idle',
    currentStep: '',
    queuedTasks: 0,
    providerLabel: ''
  },
  recentChangeSummary: null,
  changeHistory: []
}

export const feature: Partial<TeachingSystemApi> = {
  async getState(): Promise<TeachingAppState> {
    return EMPTY_STATE
  },

  async listInterruptedAgentRuns(): Promise<InterruptedAgentRun[]> {
    return []
  },

  async listTerminalAgentRunNotices(): Promise<AgentRunTerminalNotice[]> {
    return []
  },

  /** Browser has no OS suspend/resume bridge; subscribe and safely no-op. */
  onSystemPower(): () => void {
    return () => {}
  }
}
