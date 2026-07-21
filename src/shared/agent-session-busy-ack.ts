/**
 * Closed-copy busy-ack string for renderer banner (B-12).
 *
 * Must stay aligned with AGENT_SESSION_BUSY_QUEUED_ACK in
 * src/main/ai/agent-session-facade.ts (main re-exports this constant).
 * Renderer/shared must not import main-process modules.
 */
export const AGENT_SESSION_BUSY_QUEUED_ACK =
  '当前回合进行中，消息已加入队列，将在安全边界按顺序继续。'

/** Hard cap for renderer-local busy follow-up queue (matches AgentInputQueue default). */
export const AGENT_BUSY_FOLLOW_UP_QUEUE_HARD_CAP = 16
