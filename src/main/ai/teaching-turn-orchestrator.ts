import {
  assertReviewNotAutoApplied,
  buildTeachingTurnReviewBundle,
  type BuildTeachingTurnReviewCandidatesInput,
  type TeachingTurnReviewFinalizeHook
} from '../../shared/teaching-turn-review'

export type TeachingTurnMode = 'visible' | 'synthetic'

export type TeachingTurnOrchestratorDeps<Command, Context, LoopResult, FinalResult> = {
  buildTeachingTurnContext: (command: Command, mode: TeachingTurnMode) => Promise<Context> | Context
  runAgentLoop: (context: Context, mode: TeachingTurnMode) => Promise<LoopResult> | LoopResult
  finalizeTeachingTurn: (args: {
    command: Command
    context: Context
    loopResult: LoopResult
    mode: TeachingTurnMode
  }) => Promise<FinalResult> | FinalResult
  /**
   * Optional: after successful finalize, emit review candidates for human approval only.
   * Must never auto-apply skills/profile or write settlement. Settlement already completed
   * before this runs — hook errors are swallowed so finalize result is preserved (ADR-0001).
   */
  onTeachingTurnReview?: TeachingTurnReviewFinalizeHook
  /**
   * Optional: map finalize args → builder input. If omitted while a hook is present,
   * uses a conservative minimal input `{ mode }` (typically empty candidates).
   */
  buildTeachingTurnReviewInput?: (args: {
    command: Command
    context: Context
    loopResult: LoopResult
    mode: TeachingTurnMode
  }) => BuildTeachingTurnReviewCandidatesInput | Promise<BuildTeachingTurnReviewCandidatesInput>
}

/**
 * Thin orchestration seam. It sequences hooks only; ledger/evidence settlement remains
 * the responsibility of the injected finalizer (normally TeachingTurnCoordinator).
 *
 * Optional post-finalize review (ADR-0001) is candidates-only and never
 * owns settlement. Default deps without a review hook keep zero behavior change.
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
    const finalResult = await this.deps.finalizeTeachingTurn({ command, context, loopResult, mode })

    if (this.deps.onTeachingTurnReview) {
      try {
        const mapped = this.deps.buildTeachingTurnReviewInput
          ? await this.deps.buildTeachingTurnReviewInput({ command, context, loopResult, mode })
          : undefined
        // Force orchestrator mode onto builder input (synthetic → empty candidates by pure rules).
        const reviewInput: BuildTeachingTurnReviewCandidatesInput = {
          ...(mapped ?? {}),
          mode
        }
        const bundle = buildTeachingTurnReviewBundle({ reviewInput })
        assertReviewNotAutoApplied(bundle)
        await this.deps.onTeachingTurnReview({ mode, bundle })
      } catch {
        // Fail-soft: settlement already completed. Review must not reverse or rewrite finalResult.
      }
    }

    return finalResult
  }
}

export function createTeachingTurnOrchestrator<C, X, L, R>(
  deps: TeachingTurnOrchestratorDeps<C, X, L, R>
): TeachingTurnOrchestrator<C, X, L, R> {
  return new TeachingTurnOrchestrator(deps)
}
