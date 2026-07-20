/**
 * Limited learner-facing TeachingCommand catalog for the teaching composer.
 *
 * These commands are teaching actions only — never generic agent/tool control,
 * shell, diagnostics, or effect-policy bypass. continue/retry are gated on the
 * existing TeachingTurnPresentation action; show_source is local UI;
 * end_session is session control without tool dispatch.
 */

export type TeachingCommandKind = 'continue' | 'retry' | 'show_source' | 'end_session'

/** How the command is allowed to execute. Never maps to an arbitrary tool call. */
export type TeachingCommandExecution =
  | 'presentation_action'
  | 'local_ui'
  | 'session_control'

export type TeachingCommandDefinition = {
  kind: TeachingCommandKind
  /** Canonical slash token including leading `/`. */
  slash: `/${string}`
  /** Additional bare tokens accepted by the parser (without `/`). */
  aliases: readonly string[]
  label: string
  description: string
  execution: TeachingCommandExecution
}

/**
 * Presentation action kinds that may unlock presentation_action commands.
 * Kept as a string union so this module stays free of renderer imports.
 */
export type TeachingPresentationActionKind =
  | 'confirm_goal'
  | 'begin_retrieval_practice'
  | 'retry'
  | 'continue'
  | 'wait'

export type TeachingCommandContext = {
  /** Composer must be in teaching mode; non-teaching always yields empty discovery. */
  isTeachingMode: boolean
  /** Current learner presentation primary action, if any. */
  presentationActionKind?: TeachingPresentationActionKind | null
  /** Whether trusted source ids are currently present for local disclosure. */
  hasSources?: boolean
  /**
   * Diagnostic mode does not expand this catalog with technical/agent control.
   * Accepted only so callers cannot accidentally grow a second console here.
   */
  diagnosticMode?: boolean
}

export type TeachingCommandAvailabilityReason =
  | 'available'
  | 'not_teaching_mode'
  | 'requires_presentation_action'
  | 'presentation_mismatch'
  | 'no_sources'

export type TeachingCommandAvailability = {
  kind: TeachingCommandKind
  available: boolean
  reason: TeachingCommandAvailabilityReason
}

export type TeachingCommandResolveResult =
  | {
      ok: true
      kind: TeachingCommandKind
      execution: TeachingCommandExecution
    }
  | {
      ok: false
      kind: TeachingCommandKind | null
      reason: TeachingCommandAvailabilityReason | 'unknown_command' | 'not_a_command'
    }

export const TEACHING_COMMANDS: readonly TeachingCommandDefinition[] = [
  {
    kind: 'continue',
    slash: '/continue',
    aliases: ['continue', '继续'],
    label: '继续下一步',
    description: '在学习进展已保存后继续（不绕过规划器）',
    execution: 'presentation_action'
  },
  {
    kind: 'retry',
    slash: '/retry',
    aliases: ['retry', '重试'],
    label: '查看讲解并重试',
    description: '在需要再练习时重试（不绕过规划器）',
    execution: 'presentation_action'
  },
  {
    kind: 'show_source',
    slash: '/source',
    aliases: ['source', 'show_source', '来源'],
    label: '查看来源摘要',
    description: '展开当前轮次的可信来源标识（本地界面）',
    execution: 'local_ui'
  },
  {
    kind: 'end_session',
    slash: '/end',
    aliases: ['end', 'end_session', '结束'],
    label: '结束本轮会话',
    description: '结束当前教学对话输入，不调用工具',
    execution: 'session_control'
  }
] as const

const BY_KIND = new Map(TEACHING_COMMANDS.map((command) => [command.kind, command]))

/**
 * Slash discovery query: open only while the entire input is a single `/token`
 * without arguments or line breaks (same shape as skill slash discovery).
 */
export function teachingCommandSlashQuery(input: string): string | null {
  const match = input.match(/^\/([^\s/]*)$/u)
  return match ? (match[1] ?? '').toLocaleLowerCase() : null
}

export function getTeachingCommand(kind: TeachingCommandKind): TeachingCommandDefinition {
  const command = BY_KIND.get(kind)
  if (!command) {
    throw new Error(`Unknown teaching command: ${kind}`)
  }
  return command
}

export function teachingCommandAvailability(
  kind: TeachingCommandKind,
  context: TeachingCommandContext
): TeachingCommandAvailability {
  if (!context.isTeachingMode) {
    return { kind, available: false, reason: 'not_teaching_mode' }
  }

  switch (kind) {
    case 'continue': {
      if (context.presentationActionKind === 'continue') {
        return { kind, available: true, reason: 'available' }
      }
      if (!context.presentationActionKind) {
        return { kind, available: false, reason: 'requires_presentation_action' }
      }
      return { kind, available: false, reason: 'presentation_mismatch' }
    }
    case 'retry': {
      if (context.presentationActionKind === 'retry') {
        return { kind, available: true, reason: 'available' }
      }
      if (!context.presentationActionKind) {
        return { kind, available: false, reason: 'requires_presentation_action' }
      }
      return { kind, available: false, reason: 'presentation_mismatch' }
    }
    case 'show_source': {
      // Local UI disclosure: always discoverable in teaching mode.
      // Empty source lists simply leave the disclosure empty — no planner/tool path.
      return { kind, available: true, reason: 'available' }
    }
    case 'end_session':
      return { kind, available: true, reason: 'available' }
    default: {
      const _exhaustive: never = kind
      return { kind: _exhaustive, available: false, reason: 'not_teaching_mode' }
    }
  }
}

/**
 * Discover teaching commands for the composer slash menu.
 * Always limited to the closed TeachingCommand union — diagnosticMode never
 * unlocks technical/agent control here.
 */
export function discoverTeachingCommands(
  input: string,
  context: TeachingCommandContext,
  limit = 8
): TeachingCommandDefinition[] {
  if (!context.isTeachingMode) return []
  // diagnosticMode is intentionally ignored for catalog expansion.
  void context.diagnosticMode

  const query = teachingCommandSlashQuery(input)
  if (query === null) return []

  return TEACHING_COMMANDS.filter((command) => {
    if (!query) return true
    const haystack = `${command.kind} ${command.slash} ${command.label} ${command.description} ${command.aliases.join(' ')}`
      .toLocaleLowerCase()
    return haystack.includes(query)
  }).slice(0, Math.max(1, limit))
}

/**
 * Parse a bare teaching command submission (`/continue`, `/retry`, …).
 * Returns null when the input is free-form learner text.
 */
export function parseTeachingCommandInput(input: string): TeachingCommandKind | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  // Single-token only — arguments would look like tool invocation and are rejected.
  if (/\s/.test(trimmed)) return null
  const token = trimmed.slice(1).toLocaleLowerCase()
  if (!token) return null

  for (const command of TEACHING_COMMANDS) {
    if (command.slash.slice(1).toLocaleLowerCase() === token) return command.kind
    if (command.kind === token) return command.kind
    if (command.aliases.some((alias) => alias.toLocaleLowerCase() === token)) return command.kind
  }
  return null
}

/**
 * Resolve a composer submission against policy.
 * Unavailable presentation actions fail closed — never invent a planner step or tool call.
 */
export function resolveTeachingCommandSubmission(
  input: string,
  context: TeachingCommandContext
): TeachingCommandResolveResult {
  if (!context.isTeachingMode) {
    return { ok: false, kind: null, reason: 'not_teaching_mode' }
  }

  const kind = parseTeachingCommandInput(input)
  if (!kind) {
    return { ok: false, kind: null, reason: 'not_a_command' }
  }

  const availability = teachingCommandAvailability(kind, context)
  if (!availability.available) {
    return { ok: false, kind, reason: availability.reason }
  }

  const definition = getTeachingCommand(kind)
  return { ok: true, kind, execution: definition.execution }
}

export function teachingCommandValue(command: TeachingCommandDefinition): string {
  return `${command.slash}`
}

/** Reject known technical/agent control slash tokens so they never enter this catalog. */
export const FORBIDDEN_TEACHING_COMPOSER_COMMAND_TOKENS = [
  'shell',
  'mcp',
  'debug',
  'diagnostics',
  'doctor',
  'tools',
  'tool',
  'model',
  'provider',
  'config',
  'settings',
  'exec',
  'run',
  'agent'
] as const

export function isForbiddenTechnicalComposerToken(token: string): boolean {
  const normalized = token.replace(/^\//, '').toLocaleLowerCase()
  return (FORBIDDEN_TEACHING_COMPOSER_COMMAND_TOKENS as readonly string[]).includes(normalized)
}
