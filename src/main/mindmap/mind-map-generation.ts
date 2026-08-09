/**
 * AI-assisted mind map generation (see docs/mindmap/design.md §5.2).
 *
 * Reuses the existing provider routing / error classification / streaming layer —
 * no second provider channel. On any failure this throws a structured
 * `MindMapGenerationError`; it never fabricates a fallback document.
 */
import {
  callProvider,
  ProviderAdapterError,
  resolveActiveProvider,
  streamProvider,
  type AdapterCallbacks
} from '../ai/provider-adapter'
import type { TeachingSettingsV1 } from '../../shared/teaching-types'
import { classifyProviderError, providerErrorReason } from '../../shared/provider-error'
import { mindMapDocumentSchema } from '../../shared/mindmap/mind-map-schema'
import type { MindMapDocument } from '../../shared/mindmap/mind-map-types'
import { buildMindMapSystemPrompt, buildMindMapUserPrompt } from './mind-map-prompts'

export type MindMapGenerationErrorKind =
  | 'invalid_output' // model returned non-JSON or failed Zod validation
  | 'provider' // provider/transport error (use classifyProviderError)
  | 'resource_limit' // resource governor terminal
  | 'suspended'
  | 'cancelled'

export class MindMapGenerationError extends Error {
  readonly kind: MindMapGenerationErrorKind
  constructor(kind: MindMapGenerationErrorKind, message: string) {
    super(message)
    this.name = 'MindMapGenerationError'
    this.kind = kind
  }
}

export type MindMapGenerationInput = {
  title: string
  prompt: string
  settings: TeachingSettingsV1
}

// ---- Pure parsing (unit-testable without a live provider) ----

/** Strip an optional surrounding ```json / ``` markdown fence if present. */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)```\s*$/.exec(trimmed)
  if (match) return match[1].trim()
  // A dangling opening fence (streaming artifact) — drop the first line.
  const opening = /^```(?:json)?\s*\r?\n([\s\S]*)$/.exec(trimmed)
  return opening ? opening[1].trim() : trimmed
}

function formatZodError(error: import('zod').ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}

/**
 * Pure helper: parse raw model text into a validated MindMapDocument.
 * Throws `MindMapGenerationError('invalid_output')` on any failure.
 */
export function parseMindMapOutput(raw: string): MindMapDocument {
  const cleaned = stripCodeFence(raw)

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new MindMapGenerationError('invalid_output', `模型输出不是有效 JSON：${detail}`)
  }

  const result = mindMapDocumentSchema.safeParse(parsed)
  if (!result.success) {
    throw new MindMapGenerationError(
      'invalid_output',
      `模型输出未通过思维导图结构校验：${formatZodError(result.error)}`
    )
  }
  return result.data
}

// ---- Generation ----

/**
 * Generate a mind map from the topic/prompt using the configured provider.
 * When `onStream` is provided the response is streamed and each delta is
 * forwarded; the accumulated output is then parsed and validated.
 */
export async function generateMindMap(
  input: MindMapGenerationInput,
  onStream?: (text: string) => void
): Promise<MindMapDocument> {
  const provider = resolveActiveProvider(input.settings)
  if (!provider || !provider.apiKey.trim()) {
    throw new MindMapGenerationError('provider', '未配置可用的 AI Provider 或 API Key。')
  }

  const systemPrompt = buildMindMapSystemPrompt({ title: input.title, prompt: input.prompt })
  const userPrompt = buildMindMapUserPrompt({ title: input.title, prompt: input.prompt })
  const request = { systemPrompt, userPrompt, jsonMode: true }

  let text: string
  try {
    if (onStream) {
      const callbacks: AdapterCallbacks = { onToken: (delta) => onStream(delta) }
      const result = await streamProvider({
        settings: input.settings,
        provider,
        request,
        callbacks
      })
      text = result.text
    } else {
      const result = await callProvider({
        settings: input.settings,
        provider,
        request
      })
      text = result.text
    }
  } catch (error) {
    throw mapProviderError(error)
  }

  return parseMindMapOutput(text)
}

/**
 * Normalize a provider/transport failure into a `MindMapGenerationError`.
 * Provider errors are classified via `classifyProviderError` for a canonical
 * message. Cancellation and resource-terminal outcomes are reserved kinds; this
 * slice has no signal/governor input to detect them, so the provider path maps
 * to `provider` (see design §5.2 for the governor wiring in a later slice).
 */
function mapProviderError(error: unknown): MindMapGenerationError {
  if (error instanceof MindMapGenerationError) return error

  if (error instanceof ProviderAdapterError) {
    return new MindMapGenerationError('provider', `AI 生成失败：${adapterErrorReason(error)}`)
  }

  const info = classifyProviderError(error)
  const reason = info
    ? providerErrorReason(info)
    : error instanceof Error
      ? error.message
      : String(error)
  return new MindMapGenerationError('provider', `AI 生成失败：${reason}`)
}

function adapterErrorReason(error: ProviderAdapterError): string {
  switch (error.kind) {
    case 'no_api_key':
      return '未配置 API Key'
    case 'network':
      return '网络错误'
    case 'http':
      return providerErrorReason(classifyProviderError(error.message) ?? { kind: 'http' })
    case 'parse':
      return '响应解析失败'
    case 'timeout':
      return '请求超时'
    case 'unsupported':
      return '不支持的 endpoint 格式'
    default:
      return error.message
  }
}