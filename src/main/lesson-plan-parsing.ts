import { lessonPlanSchema, sanitizePlan, type LessonPlan } from '../shared/lesson-schema'

export type LessonPlanParseDiagnostic = {
  kind: 'missing_json' | 'invalid_json' | 'schema'
  message: string
}

export type LessonPlanParseResult =
  | { plan: LessonPlan; diagnostic?: undefined }
  | { plan: null; diagnostic: LessonPlanParseDiagnostic }

/**
 * Durable boundary for untrusted model text. It finds a JSON object even when
 * a provider wrapped it in prose/fences, validates the shared schema, and
 * returns compact diagnostics that the production policy can feed into repair.
 */
export function parseLessonPlan(text: string): LessonPlanParseResult {
  const candidates = jsonCandidates(text)
  if (!candidates.length) {
    return { plan: null, diagnostic: { kind: 'missing_json', message: '输出中找不到 JSON 对象' } }
  }

  let jsonError: unknown = null
  let schemaError: string | null = null
  for (const candidate of candidates) {
    let value: unknown
    try {
      value = JSON.parse(candidate)
    } catch (error) {
      jsonError ??= error
      continue
    }
    const result = lessonPlanSchema.safeParse(value)
    if (result.success) return { plan: sanitizePlan(result.data) }
    schemaError ??= formatSchemaIssues(result.error.issues)
  }

  if (schemaError) {
    return {
      plan: null,
      diagnostic: { kind: 'schema', message: `结构校验失败：${schemaError}` }
    }
  }
  return {
    plan: null,
    diagnostic: {
      kind: 'invalid_json',
      message: `JSON 解析失败：${jsonError instanceof Error ? jsonError.message : String(jsonError)}`
    }
  }
}

function jsonCandidates(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const candidates: string[] = []
  const add = (candidate: string | null) => {
    const normalized = candidate?.trim()
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized)
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed)
  if (fenced) add(fenced[1] ?? null)
  add(trimmed.startsWith('{') ? trimmed : null)
  for (let start = trimmed.indexOf('{'); start >= 0; start = trimmed.indexOf('{', start + 1)) {
    add(readBalancedObject(trimmed, start))
  }
  return candidates
}

function readBalancedObject(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function formatSchemaIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('；')
}
