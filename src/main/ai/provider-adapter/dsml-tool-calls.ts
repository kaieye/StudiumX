import { stripRawAgentToolCallBlocks } from '../../../shared/agent-conversation-turns'

export type DsmlToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

const DSML_TOOL_CALLS_RE = /<｜｜DSML｜｜tool_calls>([\s\S]*?)<\/｜｜DSML｜｜tool_calls>/gi
const DSML_INVOKE_RE = /<｜｜DSML｜｜invoke\s+([^>]*)>([\s\S]*?)<\/｜｜DSML｜｜invoke>/gi
const DSML_PARAMETER_RE = /<｜｜DSML｜｜parameter\s+([^>]*)>([\s\S]*?)<\/｜｜DSML｜｜parameter>/gi

export function stripDsmlToolCallBlocks(text: string): string {
  return stripRawAgentToolCallBlocks(text)
}

export function parseDsmlToolCalls(text: string): DsmlToolCall[] {
  if (!text || !text.includes('DSML')) return []
  const calls: DsmlToolCall[] = []
  let blockMatch: RegExpExecArray | null
  DSML_TOOL_CALLS_RE.lastIndex = 0
  while ((blockMatch = DSML_TOOL_CALLS_RE.exec(text)) !== null) {
    const block = blockMatch[1] ?? ''
    let invokeMatch: RegExpExecArray | null
    DSML_INVOKE_RE.lastIndex = 0
    while ((invokeMatch = DSML_INVOKE_RE.exec(block)) !== null) {
      const name = readDsmlAttribute(invokeMatch[1] ?? '', 'name')
      if (!name) continue
      const args: Record<string, unknown> = {}
      const parameterBlock = invokeMatch[2] ?? ''
      let parameterMatch: RegExpExecArray | null
      DSML_PARAMETER_RE.lastIndex = 0
      while ((parameterMatch = DSML_PARAMETER_RE.exec(parameterBlock)) !== null) {
        const parameterAttrs = parameterMatch[1] ?? ''
        const parameterName = readDsmlAttribute(parameterAttrs, 'name')
        if (!parameterName) continue
        const stringAttr = readDsmlAttribute(parameterAttrs, 'string')
        const rawValue = decodeDsmlText(parameterMatch[2] ?? '')
        args[parameterName] = coerceDsmlParameterValue(rawValue, stringAttr === 'true')
      }
      const argText = JSON.stringify(args)
      calls.push({
        id: `dsml_${calls.length}_${stableHash(`${name}:${argText}`)}`,
        type: 'function',
        function: { name, arguments: argText }
      })
    }
  }
  return calls
}

function readDsmlAttribute(attrs: string, name: string): string {
  const pattern = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')
  return decodeDsmlText(attrs.match(pattern)?.[1] ?? '').trim()
}

function decodeDsmlText(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .trim()
}

function coerceDsmlParameterValue(value: string, forceString: boolean): unknown {
  if (forceString) return value
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true'
  if (/^null$/i.test(value)) return null
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

function stableHash(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}
