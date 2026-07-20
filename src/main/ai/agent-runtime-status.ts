export type RuntimeStatus = {
  running: boolean
  pendingPrompt: boolean
  backgroundJobs: number
  cancelRequested: boolean
  cancellable: boolean
}

export type AgentRuntimeStatus = RuntimeStatus

export type AgentRuntimeStatusInput = Partial<AgentRuntimeStatus> & {
  active?: boolean
  pendingApproval?: boolean
  pendingQuestion?: boolean
  jobs?: number
}

/** Purely aggregates injected runtime flags; never mutates or performs I/O. */
export function buildAgentRuntimeStatus(input: AgentRuntimeStatusInput = {}): AgentRuntimeStatus {
  const running = input.running ?? input.active ?? false
  const pendingPrompt = input.pendingPrompt ?? (input.pendingApproval === true || input.pendingQuestion === true)
  const backgroundJobs = Math.max(0, Math.floor(input.backgroundJobs ?? input.jobs ?? 0))
  const cancelRequested = input.cancelRequested ?? false
  const cancellable = input.cancellable ?? (running && !cancelRequested)
  return { running, pendingPrompt, backgroundJobs, cancelRequested, cancellable }
}

export const getAgentRuntimeStatus = buildAgentRuntimeStatus
