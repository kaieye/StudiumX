import { describe, expect, it } from 'vitest'
import {
  TEACHING_COMMANDS,
  FORBIDDEN_TEACHING_COMPOSER_COMMAND_TOKENS,
  discoverTeachingCommands,
  getTeachingCommand,
  listTeachingCommandsForHelp,
  isForbiddenTechnicalComposerToken,
  parseTeachingCommandInput,
  resolveTeachingCommandSubmission,
  teachingCommandAvailability,
  teachingCommandSlashQuery,
  teachingCommandValue
} from '../../src/shared/teaching-command'

describe('TeachingCommand catalog', () => {
  it('exposes only the closed teaching action union', () => {
    expect(TEACHING_COMMANDS.map((command) => command.kind).sort()).toEqual([
      'continue',
      'end_session',
      'retry',
      'show_source'
    ].sort())
    for (const command of TEACHING_COMMANDS) {
      expect(command.slash.startsWith('/')).toBe(true)
      expect(FORBIDDEN_TEACHING_COMPOSER_COMMAND_TOKENS).not.toContain(command.kind)
      expect(isForbiddenTechnicalComposerToken(command.slash)).toBe(false)
    }
  })

  it('derives help metadata from the single command registry', () => {
    expect(listTeachingCommandsForHelp()).toBe(TEACHING_COMMANDS)
    expect(listTeachingCommandsForHelp().map((command) => ({
      slash: command.slash,
      label: command.label,
      description: command.description
    }))).toEqual(TEACHING_COMMANDS.map((command) => ({
      slash: command.slash,
      label: command.label,
      description: command.description
    })))
  })

  it('discovers slash commands only in teaching mode and never technical tokens', () => {
    expect(teachingCommandSlashQuery('/con')).toBe('con')
    expect(teachingCommandSlashQuery('/continue extra')).toBeNull()
    expect(teachingCommandSlashQuery('hello')).toBeNull()

    expect(discoverTeachingCommands('/', { isTeachingMode: false })).toEqual([])
    const all = discoverTeachingCommands('/', { isTeachingMode: true, diagnosticMode: true })
    expect(all).toHaveLength(4)
    expect(all.map((item) => item.kind)).not.toEqual(expect.arrayContaining(['shell', 'mcp', 'debug']))

    const filtered = discoverTeachingCommands('/ret', { isTeachingMode: true })
    expect(filtered.map((item) => item.kind)).toEqual(['retry'])
  })

  it('parses bare teaching commands and rejects arguments or unknown tokens', () => {
    expect(parseTeachingCommandInput('/continue')).toBe('continue')
    expect(parseTeachingCommandInput('/retry')).toBe('retry')
    expect(parseTeachingCommandInput('/source')).toBe('show_source')
    expect(parseTeachingCommandInput('/end')).toBe('end_session')
    expect(parseTeachingCommandInput('/end_session')).toBe('end_session')
    expect(parseTeachingCommandInput('继续学习')).toBeNull()
    expect(parseTeachingCommandInput('/continue now')).toBeNull()
    expect(parseTeachingCommandInput('/shell')).toBeNull()
    expect(parseTeachingCommandInput('/mcp')).toBeNull()
    expect(parseTeachingCommandInput('/debug')).toBeNull()
    expect(isForbiddenTechnicalComposerToken('shell')).toBe(true)
    expect(isForbiddenTechnicalComposerToken('/doctor')).toBe(true)
  })

  it('gates continue/retry on presentation actions so planner cannot be bypassed', () => {
    expect(teachingCommandAvailability('continue', { isTeachingMode: true }).available).toBe(false)
    expect(teachingCommandAvailability('continue', {
      isTeachingMode: true,
      presentationActionKind: 'continue'
    })).toEqual({ kind: 'continue', available: true, reason: 'available' })
    expect(teachingCommandAvailability('retry', {
      isTeachingMode: true,
      presentationActionKind: 'confirm_goal'
    }).reason).toBe('presentation_mismatch')

    const blocked = resolveTeachingCommandSubmission('/continue', { isTeachingMode: true })
    expect(blocked).toEqual({
      ok: false,
      kind: 'continue',
      reason: 'requires_presentation_action'
    })

    const allowed = resolveTeachingCommandSubmission('/retry', {
      isTeachingMode: true,
      presentationActionKind: 'retry'
    })
    expect(allowed).toEqual({
      ok: true,
      kind: 'retry',
      execution: 'presentation_action'
    })

    expect(resolveTeachingCommandSubmission('/end', { isTeachingMode: true })).toEqual({
      ok: true,
      kind: 'end_session',
      execution: 'session_control'
    })
    expect(resolveTeachingCommandSubmission('/source', { isTeachingMode: true })).toEqual({
      ok: true,
      kind: 'show_source',
      execution: 'local_ui'
    })
    expect(resolveTeachingCommandSubmission('/shell', { isTeachingMode: true }).ok).toBe(false)
    expect(resolveTeachingCommandSubmission('normal learner text', { isTeachingMode: true }).reason).toBe('not_a_command')
  })

  it('keeps command values and labels stable for composer insertion', () => {
    const cont = getTeachingCommand('continue')
    expect(teachingCommandValue(cont)).toBe('/continue')
    expect(cont.execution).toBe('presentation_action')
    expect(getTeachingCommand('show_source').execution).toBe('local_ui')
    expect(getTeachingCommand('end_session').execution).toBe('session_control')
  })
})
