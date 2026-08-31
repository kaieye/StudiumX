/**
 * Agent-chat / ADR-0004 conversation-turn-lane IPC command group.
 *
 * Hosts the legacy agent-chat stream surface plus the migrated lane entry
 * points (submit/cancel/steer/follow-up), the reservation runner, and the
 * lane ownership helpers that used to live in `teaching-ipc-gateway.ts`.
 * The gateway registers this group through `createAgentChatCommands`.
 *
 * Settlement and teaching authority stay untouched: this module only wires
 * ADR-0004 lane orchestration and never writes memory/profile/outcomes.
 */
import type { WebContents } from 'electron'
import { cancelStreamAskPending, resolveAskPending } from './ask-pending'
import { cancelStreamToolPermissionPending, resolveToolPermissionPending } from './tool-permission-pending'
import type { AgentEventBus } from './agent-event-bus'
import {
  type AgentConversationTurnLaneActiveReservation,
  type ConversationLaneKey,
  type SubmitConversationTurnIntent
} from './agent-conversation-turn-lane'
import { AgentSessionFacade } from './agent-session-facade'
import {
  mapAgentSessionPromptResultToIpc,
  noActiveAgentSessionIpcResult,
  rejectExplicitSkillInvocationSteerFollowUp
} from './agent-chat-steer-followup-ipc'
import { runProjectAgentSessionQueueIpc } from './agent-session-queue-ipc'
import {
  mapAgentChatStreamResultToRunResult,
  mapProductAgentChatInvokerPayload
} from './product-agent-chat-invoker'
import type { TeachingWorkspaceService } from '../teaching-workspace'
import {
  decodeToolAnswerPayload,
  parseAgentChatStreamPayload,
  parseCancelConversationTurnIntent,
  parseFollowUpAgentChatPayload,
  parseProjectAgentSessionQueuePayload,
  parseReplayAgentChatEventsPayload,
  parseSteerAgentChatPayload,
  parseSubmitConversationTurnIntent,
  requireStreamId
} from '../teaching-ipc-commands'
import type {
  AgentChatStreamPayload,
  AgentChatTurn,
  AgentConversationTurnStartedRealtimeEvent,
  AgentRealtimeEvent
} from '../../shared/teaching-types'
import { teachingEventChannels, teachingInvokeChannels } from '../../shared/teaching-ipc-contract'
import {
  type AgentStreamSession,
  type ConversationTurnOwnerBinding,
  type ConversationTurnStreamBinding,
  command,
  errorMessage,
  type GatewayCommand,
  type GatewayContext,
  identityReply,
  noStreamCleanup,
  safeSend
} from '../teaching-ipc-gateway-context'

export function createAgentChatCommands(context: GatewayContext): GatewayCommand[] {
  const { workspaceService: service, learningAnalyticsService: analytics } = context

  const retainAgentEventBus = (streamId: string, eventBus: AgentEventBus): void => {
    context.retainedAgentEventBuses.delete(streamId)
    context.retainedAgentEventBuses.set(streamId, eventBus)
    while (context.retainedAgentEventBuses.size > 32) {
      const oldestStreamId = context.retainedAgentEventBuses.keys().next().value
      if (typeof oldestStreamId !== 'string') break
      context.retainedAgentEventBuses.delete(oldestStreamId)
    }
  }
  const startReservedConversationTurn = (reservation: AgentConversationTurnLaneActiveReservation): void => {
    const owner = findConversationTurnOwner(context, reservation)
    if (!owner || owner.sender.isDestroyed()) {
      // A queued reservation must never inherit a prior renderer's event sink.
      // If its owner disappeared before activation, cancel this exact lane and
      // clear its FIFO rather than starting a model run without a safe receiver.
      const cancelled = context.conversationTurnLane.cancel({
        target: reservation.target,
        clientRequestId: `host-owner-unavailable:${reservation.streamId}:${reservation.activeTurnId}`,
        expectedActiveTurnId: reservation.activeTurnId
      })
      if (cancelled.code === 'cancelled') {
        clearConversationTurnOwnersForTarget(context, reservation.target)
        context.conversationTurnLane.complete({
          target: reservation.target,
          activeTurnId: reservation.activeTurnId,
          streamId: reservation.streamId
        })
      }
      return
    }
    // This is deliberately sent on the typed realtime event channel rather
    // than as an untyped side channel. A direct starter already knows its
    // stream from the disposition; a queued owner uses this correlation to
    // begin projecting the newly activated stream.
    safeSend(owner.sender, teachingEventChannels.agentChatEvent, conversationTurnStartedEvent(reservation))
    void runReservedConversationTurn(owner.sender, reservation)
  }

  const runReservedConversationTurn = async (
    sender: WebContents,
    reservation: AgentConversationTurnLaneActiveReservation
  ): Promise<void> => {
    const { streamId, activeTurnId, intent } = reservation
    let releaseTarget = reservation.target
    const controller = new AbortController()
    let productStreamResult: Awaited<ReturnType<TeachingWorkspaceService['agentChatStream']>> | undefined
    const runtime = { eventBus: null as AgentEventBus | null }
    let latestRealtimeSequence = 0
    let terminalObserved = false

    const forwardRealtimeEvent = (event: AgentRealtimeEvent): void => {
      latestRealtimeSequence = Math.max(latestRealtimeSequence, event.sequence)
      if (event.kind === 'terminal') terminalObserved = true
      safeSend(sender, teachingEventChannels.agentChatEvent, event)
    }

    const facade = new AgentSessionFacade({
      streamId,
      conversationId: reservation.target.kind === 'canonical' ? reservation.target.conversationId : undefined,
      createAbortController: () => controller,
      // The lane, rather than the façade, is the sole automatic queue consumer
      // for this migrated host path.
      autoDrain: false,
      run: async (invokerInput) => {
        try {
          const canonical = await loadCanonicalConversationForReservation(service, reservation)
          // Cancellation may arrive while canonical state is being read. Do not
          // start a provider run after the exact lane reservation was cancelled.
          if (invokerInput.signal.aborted || controller.signal.aborted) return { streamId, canceled: true }
          // The renderer revision is only an observation. Every reservation,
          // including one promoted from FIFO, starts from the just-read canonical
          // branch revision rather than rejecting or reusing a stale claim.
          const payload = conversationReservationPayload({ reservation, canonical })
          const result = await service.agentChatStream(payload, {
            streamId,
            signal: invokerInput.signal,
            onChunk: (chunk) => safeSend(sender, teachingEventChannels.agentChatChunk, chunk),
            onStatus: (status) => safeSend(sender, teachingEventChannels.agentChatStatus, status),
            onTool: (toolEvent) => safeSend(sender, teachingEventChannels.agentChatTool, toolEvent),
            onRealtimeEvent: forwardRealtimeEvent,
            onEventBusReady: (eventBus) => {
              runtime.eventBus = eventBus
              retainAgentEventBus(streamId, eventBus)
            }
          })
          productStreamResult = result
          if ('error' in result && result.error) return { streamId, error: result.message, stopReason: result.stopReason }
          if ('canceled' in result && result.canceled) return { streamId, canceled: true }
          if ('resourceStopped' in result && result.resourceStopped) return {
            streamId,
            resourceStopped: true,
            status: result.status,
            message: result.message,
            stopReason: result.stopReason,
            usage: result.usage
          }
          if (!('turns' in result)) return { streamId, error: 'conversation_turn_result_unavailable' }

          // The runtime may return a complete transcript, but it must prove the
          // canonical prefix byte-for-byte before host is permitted to persist it.
          // A delta-only or divergent response is not safe to append by guesswork.
          const turns = mergeHostConversationTurns(canonical?.record.turns ?? [], result.turns)
          if (!turns) throw new Error('conversation_transcript_prefix_mismatch')
          const saved = await service.saveAgentConversation({
            workspaceId: reservation.target.workspaceId,
            runId: streamId,
            mode: intent.mode,
            conversationId: reservation.target.kind === 'canonical' ? reservation.target.conversationId : null,
            ...(canonical ? { expectedBranchRevision: canonical.revision } : {}),
            selectedLessonPath: null,
            selectedCourseRelativePath: null,
            turns
          })
          analytics.invalidate(['conversation'])

          if (reservation.target.kind === 'pending') {
            const canonicalTarget: ConversationLaneKey = {
              kind: 'canonical',
              workspaceId: reservation.target.workspaceId,
              scope: reservation.target.scope,
              conversationId: saved.conversation.id
            }
            const promotion = context.conversationTurnLane.promotePending({
              pendingTarget: reservation.target,
              canonicalTarget
            })
            if (promotion.code !== 'rekeyed') {
              // Do not allow a stale pending FIFO to execute if its canonical
              // rekey cannot be made atomically (for example, a canonical lane
              // appeared while the first save was settling).
              const cancelled = context.conversationTurnLane.cancel({
                target: reservation.target,
                clientRequestId: `host-promotion-failed:${streamId}:${activeTurnId}`,
                expectedActiveTurnId: activeTurnId
              })
              if (cancelled.code === 'cancelled') {
                clearConversationTurnOwnersForTarget(context, reservation.target)
              }
              return { streamId, error: 'conversation_lane_promotion_failed' }
            }
            releaseTarget = promotion.target
            moveConversationTurnOwnersToCanonicalTarget(context, reservation.target, promotion.target)
            const binding = context.conversationTurnStreams.get(streamId)
            if (binding && binding.activeTurnId === activeTurnId) binding.target = promotion.target
            safeSend(sender, teachingEventChannels.agentChatEvent, {
              sequence: 0,
              streamId,
              kind: 'conversation_promoted',
              createdAt: new Date().toISOString(),
              conversationId: saved.conversation.id
            })
          }
          return mapAgentChatStreamResultToRunResult(streamId, result)
        } catch (error) {
          if (invokerInput.signal.aborted || controller.signal.aborted) return { streamId, canceled: true }
          // Do not log model/save errors here: their text can contain provider,
          // transcript, or tool-sensitive data. The lane is released below.
          return { streamId, error: error instanceof Error ? error.name : 'conversation_turn_failed' }
        }
      }
    })

    context.conversationTurnStreams.set(streamId, { target: reservation.target, activeTurnId, controller, facade })
    context.activeAgentChatStreams.set(streamId, controller)
    context.agentSessionFacades.attach(streamId, facade)

    let failed = false
    try {
      const prompt = await facade.prompt({
        text: intent.text,
        conversationId: reservation.target.kind === 'canonical' ? reservation.target.conversationId : undefined
      })
      failed = !prompt.ok || Boolean(productStreamResult && 'error' in productStreamResult && productStreamResult.error)
      // A pre-run canonical rejection is represented by the façade result rather
      // than a service result, and must still unlock the exact reservation.
      if (prompt.ok && prompt.run?.error) failed = true
    } catch {
      failed = !controller.signal.aborted
    } finally {
      // A failure before runTeachingConversationTurnActive creates its event bus
      // would otherwise leave the renderer's optimistic draft permanently busy.
      if (failed && !terminalObserved) {
        const message = '对话未能完成，请重试。'
        if (runtime.eventBus) {
          runtime.eventBus.publishTerminal('error', message)
        } else {
          forwardRealtimeEvent(conversationTurnFailedEvent(streamId, latestRealtimeSequence + 1, message))
        }
      }
      context.conversationTurnStreams.delete(streamId)
      context.conversationTurnOwners.delete(conversationTurnOwnerKey(releaseTarget, intent.clientRequestId))
      if (context.activeAgentChatStreams.get(streamId) === controller) context.activeAgentChatStreams.delete(streamId)
      context.agentSessionFacades.detach(streamId)
      facade.setPhase('idle')
      cancelStreamAskPending(streamId)
      cancelStreamToolPermissionPending(streamId)

      const resourceTerminal = Boolean(productStreamResult && 'resourceStopped' in productStreamResult && productStreamResult.resourceStopped)
      const release = resourceTerminal
        ? context.conversationTurnLane.suspend({ target: releaseTarget, activeTurnId, streamId })
        : failed
          ? context.conversationTurnLane.fail({ target: releaseTarget, activeTurnId, streamId })
          : context.conversationTurnLane.complete({ target: releaseTarget, activeTurnId, streamId })
      // Resource terminals require explicit user continuation; never drain queued
      // follow-ups after a resource boundary. Retry exhaustion remains fail-path behavior.
      if (!resourceTerminal && release.code === 'released' && release.next) startReservedConversationTurn(release.next)
    }
  }
  return [
    command({
      channel: teachingInvokeChannels.submitConversationTurn,
      parser: (payload) => parseSubmitConversationTurnIntent(payload),
      action: async (event, intent) => {
        // Do not create a host reservation that would race a legacy stream for
        // the exact same canonical conversation. Legacy remains compatible, but
        // cannot become a second producer for a migrated lane.
        if (intent.target.kind === 'canonical' && hasLegacyConversationTarget(context, intent.target)) {
          return { code: 'rejected' as const, reason: 'branch_unavailable' as const }
        }

        // The lane owns exact identity validation. The façade is only an
        // injection adapter, and its unsafe busy policy would otherwise queue a
        // steer behind this one reservation (with autoDrain deliberately off).
        // Reject before creating a lane receipt unless this exact active facade
        // is at an actual injection boundary; never retarget/demote to follow-up.
        if (intent.delivery === 'steer' && !canInjectHostLaneSteer(context, intent)) {
          return { code: 'refresh_required' as const, reason: 'active_turn_mismatch' as const }
        }

        const disposition = context.conversationTurnLane.submit(intent)
        if (disposition.code === 'started' || disposition.code === 'queued') {
          // Queued dispositions intentionally have no future streamId in the
          // frozen public contract. The host retains the submitter binding so
          // its eventual active stream projects only to that renderer.
          context.conversationTurnOwners.set(conversationTurnOwnerKey(intent.target, intent.clientRequestId), {
            target: intent.target,
            clientRequestId: intent.clientRequestId,
            sender: event.sender
          })
        }
        if (disposition.code === 'started') {
          const reservation: AgentConversationTurnLaneActiveReservation = {
            target: intent.target,
            activeTurnId: disposition.activeTurnId,
            streamId: disposition.streamId,
            intent
          }
          startReservedConversationTurn(reservation)
          return disposition
        }
        if (disposition.code === 'steered') {
          const binding = context.conversationTurnStreams.get(disposition.streamId)
          if (!binding || binding.activeTurnId !== disposition.activeTurnId || !sameConversationLaneKey(binding.target, intent.target)) {
            // Never use a newer stream/facade as a fallback target.
            return { code: 'refresh_required' as const, reason: 'active_turn_mismatch' as const }
          }
          const steerResult = await binding.facade.steer({ text: intent.text })
          // An unsafe façade boundary must not silently become a deferred
          // follow-up: the lane's exact `steer` intent is never retargeted.
          if (!steerResult.ok || steerResult.disposition !== 'steered') {
            return { code: 'refresh_required' as const, reason: 'active_turn_mismatch' as const }
          }
        }
        return disposition
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.cancelConversationTurn,
      parser: (payload) => parseCancelConversationTurnIntent(payload),
      action: (_event, intent) => {
        // The lane is authoritative for exact active-turn CAS and queue clearing.
        // A non-cancel disposition must never trigger best-effort stream cleanup.
        const disposition = context.conversationTurnLane.cancel(intent)
        if (disposition.code !== 'cancelled') return disposition

        // Bind cleanup to both the exact active turn and exact lane key. Never
        // fall back to another stream, even if the pending lane was promoted.
        const match = findConversationTurnStreamBinding(
          context,
          intent.target,
          disposition.cancelledActiveTurnId
        )
        if (!match) return disposition

        const { streamId, binding } = match
        clearConversationTurnOwnersForTarget(context, binding.target)
        if (!binding.controller.signal.aborted) binding.controller.abort()
        if (context.activeAgentChatStreams.get(streamId) === binding.controller) {
          context.activeAgentChatStreams.delete(streamId)
        }
        context.agentSessionFacades.abortAndDetach(streamId, 'cancel_conversation_turn')
        context.agentInputQueues.clearOnCancel(streamId, 'cancel_conversation_turn')
        cancelStreamAskPending(streamId)
        cancelStreamToolPermissionPending(streamId)
        // Do not complete/release here: the active host run owns final lane
        // release. lane.cancel already cleared its exact FIFO, so finalization
        // cannot promote a cancelled successor.
        return disposition
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.agentChatStream, parser: (payload) => parseAgentChatStreamPayload(payload),
      action: async (event, payload) => {
        const suppliedStreamId = payload.streamId
        const legacyTarget = legacyCanonicalConversationTarget(payload)
        if (legacyTarget && hasActiveConversationLane(context, legacyTarget)) {
          return {
            streamId: suppliedStreamId ?? '',
            error: true as const,
            message: 'Agent conversation is already managed by the host lane.'
          }
        }
        // A retry may reuse an id only after the earlier run settled. While it
        // is active, reject the duplicate instead of replacing its controller
        // and letting two turns share one stream identity.
        if (suppliedStreamId && context.activeAgentChatStreams.has(suppliedStreamId)) {
          return {
            streamId: suppliedStreamId,
            error: true as const,
            message: 'Agent chat stream id is already active.'
          }
        }
        const streamId = suppliedStreamId ?? `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
        const controller = new AbortController()
        context.activeAgentChatStreams.set(streamId, controller)
        if (legacyTarget) context.legacyConversationTargets.set(streamId, legacyTarget)
        const senderSessions = context.agentStreamSessions.get(event) ?? new Set<AgentStreamSession>()
        senderSessions.add({ streamId, controller, payload })
        context.agentStreamSessions.set(event, senderSessions)
        // B-02: product stream is driven through AgentSessionFacade.prompt with a real
        // invoker that calls service.agentChatStream once (not a second loop).
        // autoDrain stays false (ADR-0004): mid-run steer/follow-up IPC is available, but product
        // multi-turn autoDrain remains off until renderer queue sync lands (ADR-0004 residual).
        // createAbortController always returns the shared controller so cancel aborts
        // the same signal the service stream observes.
        let productStreamResult: Awaited<ReturnType<TeachingWorkspaceService['agentChatStream']>> | undefined
        const facade = new AgentSessionFacade({
          streamId,
          conversationId: payload.conversationId,
          createAbortController: () => controller,
          autoDrain: false,
          run: async (invokerInput) => {
            try {
              const mappedPayload = mapProductAgentChatInvokerPayload(payload, {
                text: invokerInput.text,
                conversationId: invokerInput.conversationId,
                expectedRevision: invokerInput.expectedRevision,
                streamId: invokerInput.streamId ?? streamId,
                runId: invokerInput.runId
              })
              const result = await service.agentChatStream(mappedPayload, {
                streamId,
                signal: invokerInput.signal,
                onChunk: (chunk) => safeSend(event.sender, teachingEventChannels.agentChatChunk, chunk),
                onStatus: (status) => safeSend(event.sender, teachingEventChannels.agentChatStatus, status),
                onTool: (toolEvent) => safeSend(event.sender, teachingEventChannels.agentChatTool, toolEvent),
                onRealtimeEvent: (realtimeEvent) => safeSend(event.sender, teachingEventChannels.agentChatEvent, realtimeEvent),
                onEventBusReady: (eventBus) => retainAgentEventBus(streamId, eventBus)
              })
              productStreamResult = result
              return mapAgentChatStreamResultToRunResult(streamId, result)
            } catch (error) {
              if (invokerInput.signal.aborted || controller.signal.aborted) {
                productStreamResult = { canceled: true as const }
                return { streamId, canceled: true }
              }
              const message = errorMessage(error)
              context.logger.error(`Agent chat stream failed: ${message}`)
              productStreamResult = { error: true as const, message }
              return { streamId, error: message }
            }
          }
        })
        context.agentSessionFacades.attach(streamId, facade)
        try {
          // Idle prompt → accept + run. prompt() sets phase provider while live and
          // settles to idle/turn_boundary; do not pre-set provider (would busy-queue).
          const promptResult = await facade.prompt({
            text: payload.userInput,
            conversationId: payload.conversationId,
            expectedRevision: payload.expectedBranchRevision
          })
          if (!promptResult.ok) {
            // Unexpected on first turn (idle); fail closed without inventing a second loop.
            return {
              streamId,
              error: true as const,
              message: `Agent session rejected prompt: ${promptResult.reason}`
            }
          }
          if (productStreamResult !== undefined) {
            return { streamId, ...productStreamResult }
          }
          // Invoker returned without capturing (e.g. empty DEFAULT); map façade run.
          const run = promptResult.run
          if (run?.canceled) return { streamId, canceled: true as const }
          if (run?.error) return { streamId, error: true as const, message: run.error }
          return {
            streamId,
            error: true as const,
            message: 'Agent chat stream completed without a product result.'
          }
        } catch (error) {
          if (controller.signal.aborted) return { streamId, canceled: true as const }
          const message = errorMessage(error); context.logger.error(`Agent chat stream failed: ${message}`); return { streamId, error: true as const, message }
        } finally {
          // Detach when stream ends cleanly; cancel path uses abortAndDetach first.
          context.agentSessionFacades.detach(streamId)
          facade.setPhase('idle')
        }
      },
      reply: identityReply,
      streamCleanup: (event, payload) => {
        const senderSessions = context.agentStreamSessions.get(event)
        const session = [...(senderSessions ?? [])].find((candidate) => candidate.payload === payload)
        // A duplicate supplied stream id is rejected before it owns the sender
        // session. Its generic command cleanup must not detach the live turn.
        if (!session || session.payload !== payload) return
        if (context.activeAgentChatStreams.get(session.streamId) === session.controller) context.activeAgentChatStreams.delete(session.streamId)
        context.legacyConversationTargets.delete(session.streamId)
        senderSessions?.delete(session)
        if (senderSessions?.size === 0) context.agentStreamSessions.delete(event)
        // Safety: drop façade if action finally did not run (e.g. parse failure).
        context.agentSessionFacades.detach(session.streamId)
      }
    }),
    command({
      channel: teachingInvokeChannels.replayAgentChatEvents, parser: (rawPayload) => parseReplayAgentChatEventsPayload(rawPayload),
      action: (_event, payload) => context.retainedAgentEventBuses.get(payload.streamId)?.replayAfter(payload.afterSequence) ?? unavailableReplay(payload.streamId, payload.afterSequence),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.cancelAgentChatStream, parser: (streamId) => requireStreamId(streamId),
      action: (_event, streamId) => {
        const laneBinding = context.conversationTurnStreams.get(streamId)
        if (laneBinding) {
          // The public compatibility API only exposes streamId. Bind it to the
          // exact active lane identity before clearing any queue; no best-effort
          // retargeting is permitted.
          const cancelled = context.conversationTurnLane.cancel({
            target: laneBinding.target,
            clientRequestId: `legacy-stream-cancel:${streamId}:${laneBinding.activeTurnId}`,
            expectedActiveTurnId: laneBinding.activeTurnId
          })
          if (cancelled.code !== 'cancelled') return { canceled: false }
          clearConversationTurnOwnersForTarget(context, laneBinding.target)
          laneBinding.controller.abort()
          context.activeAgentChatStreams.delete(streamId)
          context.agentSessionFacades.abortAndDetach(streamId, 'cancel_agent_chat_stream')
          context.agentInputQueues.clearOnCancel(streamId, 'cancel_agent_chat_stream')
          cancelStreamAskPending(streamId); cancelStreamToolPermissionPending(streamId)
          return { canceled: true }
        }
        const controller = context.activeAgentChatStreams.get(streamId)
        if (controller) { controller.abort(); context.activeAgentChatStreams.delete(streamId) }
        // B-01/B-02: cancel clears queued follow-up/steer (registry + optional façade).
        // steer ≠ silent drop on cancel; façade.abort also clearOnCancel+reopen its own queue.
        context.agentSessionFacades.abortAndDetach(streamId, 'cancel_agent_chat_stream')
        context.agentInputQueues.clearOnCancel(streamId, 'cancel_agent_chat_stream')
        cancelStreamAskPending(streamId); cancelStreamToolPermissionPending(streamId)
        return { canceled: Boolean(controller) }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.steerAgentChatStream,
      parser: (payload) => parseSteerAgentChatPayload(payload),
      action: async (_event, payload) => {
        // Host-lane streams accept only the exact ADR-0004 submit delivery:'steer'
        // path. Legacy APIs must not discover or drive their façade.
        if (context.conversationTurnStreams.has(payload.streamId)) return noActiveAgentSessionIpcResult()
        // Mid-run steer delegates to the attached façade (≠ abort). Product autoDrain stays false.
        const facade = context.agentSessionFacades.get(payload.streamId)
        if (!facade) return noActiveAgentSessionIpcResult()
        const explicitSkillRejection = rejectExplicitSkillInvocationSteerFollowUp(payload.text, facade.snapshot())
        if (explicitSkillRejection) return explicitSkillRejection
        const result = await facade.steer({
          text: payload.text,
          conversationId: payload.conversationId,
          expectedRevision: payload.expectedRevision
        })
        return mapAgentSessionPromptResultToIpc(result, facade.snapshot())
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.followUpAgentChatStream,
      parser: (payload) => parseFollowUpAgentChatPayload(payload),
      action: async (_event, payload) => {
        // Host-lane streams are isolated from the legacy follow-up façade path.
        if (context.conversationTurnStreams.has(payload.streamId)) return noActiveAgentSessionIpcResult()
        // Mid-run follow-up: busy policy queues by default; does not flip autoDrain.
        const facade = context.agentSessionFacades.get(payload.streamId)
        if (!facade) return noActiveAgentSessionIpcResult()
        const explicitSkillRejection = rejectExplicitSkillInvocationSteerFollowUp(payload.text, facade.snapshot())
        if (explicitSkillRejection) return explicitSkillRejection
        const result = await facade.followUp({
          text: payload.text,
          conversationId: payload.conversationId,
          expectedRevision: payload.expectedRevision
        })
        return mapAgentSessionPromptResultToIpc(result, facade.snapshot())
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.projectAgentSessionQueue,
      parser: (payload) => parseProjectAgentSessionQueuePayload(payload),
      action: (_event, payload) => {
        // Read-only queue projection (ADR-0004). Product autoDrain remains false.
        // Never drains, steers, prompts, aborts, or flips autoDrain.
        const facade = context.agentSessionFacades.get(payload.streamId)
        return runProjectAgentSessionQueueIpc(payload, facade)
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.answerAgentChatTool, parser: (payload) => decodeToolAnswerPayload(payload),
      action: (_event, payload) => {
        if (resolveAskPending(payload.streamId, payload.toolCallId, payload.answers)) return { ok: true }
        if (resolveToolPermissionPending(payload.streamId, payload.toolCallId, payload.answers)) return { ok: true }
        throw new Error('No pending Ask or tool permission request matches this stream and tool call.')
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
  ]
}

type CanonicalConversationForReservation = {
  record: { turns: AgentChatTurn[]; branch?: { revision?: number; status?: string } }
  revision: number
}

async function loadCanonicalConversationForReservation(
  service: TeachingWorkspaceService,
  reservation: AgentConversationTurnLaneActiveReservation
): Promise<CanonicalConversationForReservation | null> {
  if (reservation.target.kind === 'pending') return null
  const record = await service.readAgentConversation({
    workspaceId: reservation.target.workspaceId,
    conversationId: reservation.target.conversationId,
    scope: reservation.target.scope
  })
  const revision = record.branch?.revision
  if (record.branch?.status !== 'active' || !Number.isSafeInteger(revision) || (revision ?? -1) < 0) {
    throw new Error('canonical_conversation_unavailable')
  }
  return { record, revision: revision as number }
}

function conversationReservationPayload(input: {
  reservation: AgentConversationTurnLaneActiveReservation
  canonical: CanonicalConversationForReservation | null
}): AgentChatStreamPayload {
  const { reservation, canonical } = input
  const turns = canonical?.record.turns ?? []
  return {
    streamId: reservation.streamId,
    workspaceId: reservation.target.workspaceId,
    mode: reservation.intent.mode,
    ...(reservation.target.kind === 'canonical'
      ? { conversationId: reservation.target.conversationId, expectedBranchRevision: canonical?.revision }
      : {}),
    // Attachments here are host-local durable transcript data. Runtime strips
    // them from provider history and only sends `reservation.intent` images for
    // this explicitly submitted turn.
    messages: turns.map((turn) => ({
      role: turn.role,
      content: turn.content,
      ...(turn.imageAttachments?.length ? { imageAttachments: turn.imageAttachments } : {})
    })),
    ...(turns.length ? { messageTurnIds: turns.map((turn) => turn.id) } : {}),
    userInput: reservation.intent.text,
    ...(reservation.intent.skillIds?.length ? { skillIds: reservation.intent.skillIds } : {}),
    ...(reservation.intent.imageAttachments?.length ? { imageAttachments: reservation.intent.imageAttachments } : {})
  }
}

/**
 * A complete runtime transcript may be persisted only when it proves the exact
 * canonical prefix. Host never guesses that a delta belongs after the latest
 * record: doing so would turn a stale or divergent response into a force write.
 */
function mergeHostConversationTurns(
  canonicalTurns: readonly AgentChatTurn[],
  streamTurns: readonly AgentChatTurn[]
): AgentChatTurn[] | null {
  if (streamTurns.length < canonicalTurns.length) return null
  if (!canonicalTurns.every((turn, index) => sameHostConversationTurn(turn, streamTurns[index]))) return null
  return [...streamTurns]
}

function sameHostConversationTurn(left: AgentChatTurn, right: AgentChatTurn | undefined): boolean {
  if (!right) return false
  return left.id === right.id &&
    left.role === right.role &&
    left.content === right.content &&
    sameImageAttachments(left.imageAttachments, right.imageAttachments)
}

function sameImageAttachments(
  left: AgentChatTurn['imageAttachments'],
  right: AgentChatTurn['imageAttachments']
): boolean {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return !left?.length && !right?.length
  return left.every((attachment, index) => {
    const candidate = right[index]
    return candidate?.id === attachment.id &&
      candidate.name === attachment.name &&
      candidate.mimeType === attachment.mimeType &&
      candidate.sizeBytes === attachment.sizeBytes &&
      candidate.dataBase64 === attachment.dataBase64
  })
}

function conversationTurnStartedEvent(
  reservation: AgentConversationTurnLaneActiveReservation
): AgentConversationTurnStartedRealtimeEvent {
  return {
    sequence: 0,
    streamId: reservation.streamId,
    kind: 'conversation_turn_started',
    createdAt: new Date().toISOString(),
    activeTurnId: reservation.activeTurnId,
    clientRequestId: reservation.intent.clientRequestId,
    ...(reservation.target.kind === 'canonical' ? { conversationId: reservation.target.conversationId } : {})
  }
}

function conversationTurnFailedEvent(streamId: string, sequence: number, message: string): AgentRealtimeEvent {
  return {
    sequence,
    streamId,
    kind: 'terminal',
    createdAt: new Date().toISOString(),
    outcome: 'error',
    message
  }
}

function conversationTurnOwnerKey(target: ConversationLaneKey, clientRequestId: string): string {
  return JSON.stringify([
    target.kind,
    target.workspaceId,
    target.scope,
    target.kind === 'canonical' ? target.conversationId : target.pendingConversationId,
    clientRequestId
  ])
}

function findConversationTurnOwner(
  context: GatewayContext,
  reservation: AgentConversationTurnLaneActiveReservation
): ConversationTurnOwnerBinding | null {
  const binding = context.conversationTurnOwners.get(
    conversationTurnOwnerKey(reservation.target, reservation.intent.clientRequestId)
  )
  return binding && sameConversationLaneKey(binding.target, reservation.target) ? binding : null
}

function clearConversationTurnOwnersForTarget(context: GatewayContext, target: ConversationLaneKey): void {
  for (const [key, binding] of context.conversationTurnOwners) {
    if (sameConversationLaneKey(binding.target, target)) context.conversationTurnOwners.delete(key)
  }
}

function moveConversationTurnOwnersToCanonicalTarget(
  context: GatewayContext,
  pendingTarget: ConversationLaneKey,
  canonicalTarget: ConversationLaneKey
): void {
  for (const [key, binding] of [...context.conversationTurnOwners]) {
    if (!sameConversationLaneKey(binding.target, pendingTarget)) continue
    context.conversationTurnOwners.delete(key)
    const moved: ConversationTurnOwnerBinding = { ...binding, target: canonicalTarget }
    context.conversationTurnOwners.set(conversationTurnOwnerKey(canonicalTarget, moved.clientRequestId), moved)
  }
}

function findConversationTurnStreamBinding(
  context: GatewayContext,
  target: ConversationLaneKey,
  activeTurnId: string
): { streamId: string; binding: ConversationTurnStreamBinding } | null {
  for (const [streamId, binding] of context.conversationTurnStreams) {
    if (binding.activeTurnId === activeTurnId && sameConversationLaneKey(binding.target, target)) {
      return { streamId, binding }
    }
  }
  return null
}

function canInjectHostLaneSteer(
  context: GatewayContext,
  intent: SubmitConversationTurnIntent
): boolean {
  const expectedActiveTurnId = intent.expectedActiveTurnId
  if (!expectedActiveTurnId) return false
  const lane = context.conversationTurnLane.snapshot().lanes.find((candidate) => sameConversationLaneKey(candidate.key, intent.target))
  const active = lane?.active
  if (!active || active.activeTurnId !== expectedActiveTurnId) return false
  const binding = context.conversationTurnStreams.get(active.streamId)
  return Boolean(
    binding &&
    binding.activeTurnId === expectedActiveTurnId &&
    sameConversationLaneKey(binding.target, intent.target) &&
    binding.facade.snapshot().phase === 'turn_boundary'
  )
}

function sameConversationLaneKey(left: ConversationLaneKey, right: ConversationLaneKey): boolean {
  return left.kind === right.kind &&
    left.workspaceId === right.workspaceId &&
    left.scope === right.scope &&
    (left.kind === 'canonical' && right.kind === 'canonical'
      ? left.conversationId === right.conversationId
      : left.kind === 'pending' && right.kind === 'pending'
        ? left.pendingConversationId === right.pendingConversationId
        : false)
}

function legacyCanonicalConversationTarget(payload: AgentChatStreamPayload): ConversationLaneKey | null {
  if (!payload.workspaceId || !payload.conversationId) return null
  return {
    kind: 'canonical',
    workspaceId: payload.workspaceId,
    scope: payload.mode === 'temporary' ? 'temporary' : 'workspace',
    conversationId: payload.conversationId
  }
}

function hasActiveConversationLane(context: GatewayContext, target: ConversationLaneKey): boolean {
  return context.conversationTurnLane.snapshot().lanes.some((lane) =>
    lane.active !== undefined && sameConversationLaneKey(lane.key, target)
  )
}

function hasLegacyConversationTarget(context: GatewayContext, target: ConversationLaneKey): boolean {
  return [...context.legacyConversationTargets.values()].some((legacy) => sameConversationLaneKey(legacy, target))
}

function unavailableReplay(streamId: string, afterSequence: number) {
  return { streamId, available: false, requestedAfterSequence: afterSequence, fromSequence: afterSequence + 1, nextSequence: afterSequence + 1, hasGap: true, droppedEvents: 0, droppedBytes: 0, events: [] }
}
