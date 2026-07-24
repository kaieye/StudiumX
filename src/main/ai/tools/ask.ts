import type { ToolDefinition } from '../provider-adapter'
import type { ToolCallContext, ToolContext, ToolEntry } from './registry'
import { registerAskPending, rejectAskPending } from '../ask-pending'
import {
  ASK_DEADLINE_AT_KEY,
  DEFAULT_ASK_TIMEOUT_MS,
  stampAskArguments
} from '../../../shared/ask-deadline'
import type { AskAnswer, AskOption, AskQuestion } from '../../../shared/teaching-types'

/**
 * The `ask` tool: the model emits one tool_call with a set of questions
 * (each with concrete options), the handler blocks until the user answers
 * via the renderer-side AskCard, and the formatted answers come back as
 * the tool_result so the model can continue.
 *
 * The question content itself rides on the existing `tool_call` event's
 * `arguments` field — the frontend parses it directly, so no extra stream
 * event is needed. Only the *answer* needs a reverse IPC channel.
 *
 * Host stamps authoritative `__deadlineAt` (ADR-0144) and re-publishes the
 * tool projection so all UI surfaces share one countdown. Timeout settles
 * to recommended/first option; cancel aborts. Timeout never auto-approves
 * write / privileged / turn-review.
 */
export const ASK_TOOL_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ask',
    description: [
      '向用户提出带选项的问题并等待回答。仅用于真正属于用户的决策岔路（例如学习方向、身份基础、目标优先级、约束选择），且每个选项都对应实质不同的后续路径。',
      '不要用于有明显默认值或你能合理推断的决策；不要用散文形式重复提问。',
      '每次提出 1-4 个问题，每个问题给出 2-4 个具体选项；推荐选项放第一个。',
      '调用后会阻塞直到用户回答，回答会作为 tool result 返回；在收到真实 tool result 之前不要假设用户做了任何选择。'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          description: '要问的问题列表（1-4 个）',
          items: {
            type: 'object',
            properties: {
              header: {
                type: 'string',
                description: '短标签（2-6 字），用于卡片标题与面包屑；可留空'
              },
              question: {
                type: 'string',
                description: '完整的问题文本，完整句子'
              },
              multiSelect: {
                type: 'boolean',
                description: '是否允许多选；默认 false（单选）'
              },
              options: {
                type: 'array',
                minItems: 2,
                maxItems: 4,
                description: '2-4 个选项，推荐项放第一个',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: '选项标签（也是选中后返回给模型的值）' },
                    description: { type: 'string', description: '可选的单行补充说明' },
                    recommended: {
                      type: 'boolean',
                      description: '是否为推荐项；超时未答时会选推荐项（否则选第一项）'
                    }
                  },
                  required: ['label']
                }
              }
            },
            required: ['question', 'options']
          }
        }
      },
      required: ['questions']
    }
  }
}

type RawAskArgs = {
  questions?: Array<{
    header?: unknown
    question?: unknown
    multiSelect?: unknown
    options?: Array<{ label?: unknown; description?: unknown; recommended?: unknown }>
  }>
  [ASK_DEADLINE_AT_KEY]?: unknown
}

type AskHandlerDeps = {
  streamId: string
  signal?: AbortSignal
  onWaiting?: (toolCallId: string) => Promise<void> | void
  onResolved?: (toolCallId: string) => Promise<void> | void
  /**
   * Publish stamped ask arguments so renderer surfaces share the authoritative
   * deadline. Called after register + onWaiting (same pattern as tool_permission).
   */
  publishWaiting?: (payload: { toolCallId: string; argumentsJson: string }) => void
  nowMs?: () => number
  timeoutMs?: number
}

/** Build a ToolEntry whose handler blocks on the pending-ask registry.
 *  Registered dynamically by the teaching conversation runtime so each
 *  stream can scope its pending entries by `streamId`. */
export function createAskToolEntry(deps: AskHandlerDeps): ToolEntry {
  return {
    definition: ASK_TOOL_DEFINITION,
    handler: async (args: unknown, _ctx: ToolContext, callCtx?: ToolCallContext): Promise<string> => {
      if (!callCtx) {
        throw new Error('ask 工具缺少 callCtx（toolCallId），无法关联用户回答。')
      }
      const nowMs = deps.nowMs?.() ?? Date.now()
      const stamped = stampAskArguments(args, {
        nowMs,
        timeoutMs: deps.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS
      })
      const questions = parseAndValidateAskArgs(stamped.args)
      const argumentsJson = JSON.stringify(stamped.args)
      const pendingPromise = registerAskPending(deps.streamId, callCtx.toolCallId, {
        questions,
        deadlineAt: stamped.deadlineAt,
        nowMs: deps.nowMs
      })
      void pendingPromise.catch(() => undefined)
      try {
        await deps.onWaiting?.(callCtx.toolCallId)
        deps.publishWaiting?.({
          toolCallId: callCtx.toolCallId,
          argumentsJson
        })
        const answers = await waitForAnswers(deps, pendingPromise)
        return formatAskAnswers(questions, answers)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error))
        if (rejectAskPending(deps.streamId, callCtx.toolCallId, normalized)) {
          await pendingPromise.catch(() => undefined)
        }
        throw error
      } finally {
        await deps.onResolved?.(callCtx.toolCallId)
      }
    }
  }
}

async function waitForAnswers(
  deps: AskHandlerDeps,
  pendingPromise: Promise<AskAnswer[]>
): Promise<AskAnswer[]> {
  if (!deps.signal) return pendingPromise
  // Race the pending answer against stream cancellation; on abort, the
  // cancel-IPC handler will reject the pending entry, but we also guard
  // here in case the signal fires without that path.
  return new Promise<AskAnswer[]>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      reject(new Error('ask canceled: stream aborted'))
    }
    if (deps.signal!.aborted) {
      onAbort()
      return
    }
    deps.signal!.addEventListener('abort', onAbort, { once: true })
    pendingPromise.then(
      (answers) => {
        if (settled) return
        settled = true
        resolve(answers)
      },
      (error) => {
        if (settled) return
        settled = true
        reject(error)
      }
    )
  })
}

function parseAndValidateAskArgs(args: unknown): AskQuestion[] {
  const raw = (args ?? {}) as RawAskArgs
  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : []
  if (rawQuestions.length === 0) {
    throw new Error('ask 参数不完整：questions 至少需要 1 个问题。')
  }
  if (rawQuestions.length > 4) {
    throw new Error('ask 参数过多：一次最多 4 个问题。')
  }
  const out: AskQuestion[] = []
  rawQuestions.forEach((rawQuestion, index) => {
    const id = `q${index + 1}`
    const prompt = cleanString(rawQuestion.question)
    if (!prompt) {
      throw new Error(`ask 第 ${index + 1} 个问题缺少 question 文本。`)
    }
    const rawOptions = Array.isArray(rawQuestion.options) ? rawQuestion.options : []
    if (rawOptions.length < 2 || rawOptions.length > 4) {
      throw new Error(`ask 第 ${index + 1} 个问题需要 2-4 个选项。`)
    }
    const options: AskOption[] = []
    const seenLabels = new Set<string>()
    for (const rawOption of rawOptions) {
      const label = cleanString(rawOption.label)
      if (!label) {
        throw new Error(`ask 第 ${index + 1} 个问题里有选项缺少 label。`)
      }
      if (seenLabels.has(label)) {
        throw new Error(`ask 第 ${index + 1} 个问题里有选项 label 重复："${label}"。`)
      }
      seenLabels.add(label)
      const description = cleanString(rawOption.description)
      const recommended = rawOption.recommended === true
      options.push({
        label,
        ...(description ? { description } : {}),
        ...(recommended ? { recommended: true } : {})
      })
    }
    // Convention: first option is recommended when none marked.
    if (!options.some((option) => option.recommended === true) && options[0]) {
      options[0] = { ...options[0], recommended: true }
    }
    const header = cleanString(rawQuestion.header)
    const multiSelect = rawQuestion.multiSelect === true
    out.push({ id, header: header || undefined, prompt, multiSelect: multiSelect || undefined, options })
  })
  return out
}

/** Format the user's answers into a model-readable tool_result string.
 *  An empty answer (user dismissed) is stated explicitly so the model
 *  doesn't pick an option on the user's behalf. */
function formatAskAnswers(questions: AskQuestion[], answers: AskAnswer[]): string {
  if (answers.length === 0) {
    return '用户跳过了所有问题，没有做任何选择。请把这理解为"不要替我决定，直接继续对话"，不要自行挑选选项，可以基于已有上下文继续。'
  }
  const lines: string[] = []
  for (const question of questions) {
    const answer = answers.find((candidate) => candidate.questionId === question.id)
    const header = question.header ? `[${question.header}] ` : ''
    if (!answer || answer.selected.length === 0) {
      lines.push(`${header}${question.prompt}\n用户未回答（不要替用户假设选择）。`)
      continue
    }
    const joined = answer.selected.map((label) => `「${label}」`).join('、')
    lines.push(`${header}${question.prompt}\n用户选择：${joined}`)
  }
  return lines.join('\n\n')
}

function cleanString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}
