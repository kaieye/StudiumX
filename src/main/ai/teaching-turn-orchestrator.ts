export type TeachingTurnMode = 'visible' | 'synthetic'

export type TeachingTurnOrchestratorDeps<Command, Context, LoopResult, FinalResult> = {
  buildTeachingTurnContext: (command: Command, mode: TeachingTurnMode) => Promise<Context> | Context
  runAgentLoop: (context: Context, mode: TeachingTurnMode) => Promise<LoopResult> | LoopResult
  finalizeTeachingTurn: (args: { command: Command; context: Context; loopResult: LoopResult; mode: TeachingTurnMode }) => Promise<FinalResult> | FinalResult
}

/**
 * Thin orchestration seam. It sequences hooks only; ledger/evidence settlement remains
 * the responsibility of the injected finalizer (normally TeachingTurnCoordinator).
 */
export class TeachingTurnOrchestrator<Command, Context, LoopResult, FinalResult> {
  constructor(private readonly deps: TeachingTurnOrchestratorDeps<Command, Context, LoopResult, FinalResult>) {}

  runVisibleTurn(command: Command): Promise<FinalResult> {
    return this.run(command, 'visible')
  }

  runSyntheticTurn(command: Command): Promise<FinalResult> {
    return this.run(command, 'synthetic')
  }

  private async run(command: Command, mode: TeachingTurnMode): Promise<FinalResult> {
    const context = await this.deps.buildTeachingTurnContext(command, mode)
    const loopResult = await this.deps.runAgentLoop(context, mode)
    return this.deps.finalizeTeachingTurn({ command, context, loopResult, mode })
  }
}

export function createTeachingTurnOrchestrator<C, X, L, R>(deps: TeachingTurnOrchestratorDeps<C, X, L, R>): TeachingTurnOrchestrator<C, X, L, R> {
  return new TeachingTurnOrchestrator(deps)
}
