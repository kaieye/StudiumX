import type { ChatMessage, ToolDefinition } from './provider-adapter'

/**
 * A request-fit estimate with its independently auditable components.
 * `totalTokens` includes input messages, tool schemas, provider framing, the
 * reserved completion budget, and caller-supplied extra overhead.
 */
export type TokenEstimate = {
  messageTokens: number
  toolSchemaTokens: number
  framingTokens: number
  outputReserveTokens: number
  extraTokens: number
  overheadTokens: number
  totalTokens: number
  source: 'local' | 'provider' | 'mixed'
}

export type ContextOverhead = {
  tools?: ToolDefinition[]
  /** Conservative allowance for provider-owned chat/request framing. */
  framingTokens?: number
  /** Completion space reserved before dispatch; never treated as input text. */
  outputReserveTokens?: number
  /** Other known endpoint overhead, kept separate from the named fit components. */
  extraTokens?: number
}

/**
 * Local, CJK-aware context estimator. It intentionally stays approximate:
 * ASCII runs are packed at about 4 chars/token, while CJK and other wide
 * characters count closer to one token each.
 */
export class ContextEstimator {
  private readonly charsPerToken: number

  constructor(charsPerToken = 4) {
    this.charsPerToken = Math.max(1, Math.floor(charsPerToken))
  }

  estimateText(text: string): number {
    if (!text) return 0
    let asciiRun = 0
    let tokens = 0
    const flushAscii = (): void => {
      if (asciiRun > 0) {
        tokens += Math.ceil(asciiRun / this.charsPerToken)
        asciiRun = 0
      }
    }

    for (const char of text) {
      if (char.charCodeAt(0) <= 0x7f) {
        asciiRun += 1
        continue
      }
      flushAscii()
      if (!isCombiningMark(char)) tokens += 1
    }
    flushAscii()
    return tokens
  }

  estimateMessage(message: ChatMessage): number {
    let text = message.role
    if (message.role === 'assistant') {
      text += ` ${message.content ?? ''}`
      if (message.tool_calls?.length) text += ` ${safeStringify(message.tool_calls)}`
    } else if (message.role === 'tool') {
      text += ` ${message.tool_call_id} ${message.content}`
    } else {
      text += ` ${message.content}`
    }
    // Chat formats charge a small structural overhead per message.
    return Math.max(1, this.estimateText(text) + 4)
  }

  estimateMessages(messages: ChatMessage[]): number {
    return messages.reduce((sum, message) => sum + this.estimateMessage(message), 0)
  }

  estimateTools(tools: ToolDefinition[] | undefined): number {
    if (!tools?.length) return 0
    return this.estimateText(safeStringify(tools))
  }

  estimateRequest(messages: ChatMessage[], overhead: ContextOverhead = {}): TokenEstimate {
    const messageTokens = this.estimateMessages(messages)
    const toolSchemaTokens = this.estimateTools(overhead.tools)
    const framingTokens = nonNegativeInteger(overhead.framingTokens)
    const outputReserveTokens = nonNegativeInteger(overhead.outputReserveTokens)
    const extraTokens = nonNegativeInteger(overhead.extraTokens)
    const overheadTokens = toolSchemaTokens + framingTokens + outputReserveTokens + extraTokens
    return {
      messageTokens,
      toolSchemaTokens,
      framingTokens,
      outputReserveTokens,
      extraTokens,
      overheadTokens,
      totalTokens: messageTokens + overheadTokens,
      source: 'local'
    }
  }
}

function nonNegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isCombiningMark(char: string): boolean {
  return /[\u0300-\u036f\ufe00-\ufe0f]/u.test(char)
}
