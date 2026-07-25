/**
 * Hardline denylist + env scrub + network helper (expanded sandbox parity).
 * Floor below 本课放行 / full_access — never a YOLO product label.
 */
import { describe, expect, it } from 'vitest'

import { detectHardlineCommand } from '../../src/main/ai/tools/shell-hardline'
import {
  isShellEnvKeyStripped,
  sanitizeShellChildEnv
} from '../../src/main/ai/tools/shell-env-scrub'
import { sandboxAllowsOutboundNetwork } from '../../src/shared/teaching-types/agent-sandbox'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { buildDefaultRegistry, buildToolContext } from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'

const cleanupPaths: string[] = []
afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('shell-hardline denylist (floor under 本课放行)', () => {
  const block = [
    { argv: ['rm', '-rf', '/'], desc: /root filesystem/i },
    { argv: ['rm', '-rf', '/*'], desc: /root filesystem/i },
    { argv: ['rm', '-rf', '~'], desc: /home/i },
    { argv: ['rm', '-rf', '$HOME'], desc: /home/i },
    { argv: ['rm', '-rf', '/etc'], desc: /system/i },
    { argv: ['rm', '-rf', 'C:\\'], desc: /root/i },
    { argv: ['mkfs.ext4', '/dev/sda1'], desc: /mkfs|format/i },
    { argv: ['dd', 'if=/dev/zero', 'of=/dev/sda'], desc: /block device/i },
    { argv: ['kill', '-9', '-1'], desc: /kill all/i },
    { argv: ['reboot'], desc: /shutdown|reboot/i },
    { argv: ['shutdown', '-h', 'now'], desc: /shutdown|reboot/i },
    { argv: ['systemctl', 'poweroff'], desc: /poweroff|reboot/i },
    { argv: ['sudo', 'reboot'], desc: /shutdown|reboot/i },
    { argv: ['bash', '-lc', 'rm -rf /'], desc: /root|system|home/i },
    { argv: ['pwsh', '-Command', 'rm -rf /'], desc: /root|system|home/i }
  ] as const

  for (const case_ of block) {
    it(`blocks ${case_.argv.join(' ')}`, () => {
      const d = detectHardlineCommand({ argv: case_.argv })
      expect(d.blocked).toBe(true)
      if (d.blocked) {
        expect(d.code).toBe('hardline_denied')
        expect(d.description).toMatch(case_.desc)
        expect(d.reason).toMatch(/hardline|本课放行|full_access/i)
      }
    })
  }

  const allow = [
    ['rm', '-rf', './build'],
    ['rm', '-rf', 'node_modules'],
    ['rm', '-rf', '/tmp/foo'],
    ['rm', '-rf', '/home/user/scratch'],
    ['rm', 'foo.txt'],
    ['git', 'status'],
    ['npm', 'run', 'build'],
    ['kill', '-9', '12345'],
    ['systemctl', 'status', 'nginx'],
    ['echo', 'reboot'],
    ['dd', 'if=/dev/zero', 'of=./image.bin'],
    ['git', 'commit', '-m', 'rm -rf /']
  ] as const

  for (const argv of allow) {
    it(`allows ${argv.join(' ')}`, () => {
      expect(detectHardlineCommand({ argv }).blocked).toBe(false)
    })
  }

  it('detects fork bomb in command text', () => {
    const d = detectHardlineCommand({ command: ':(){ :|:& };:' })
    expect(d.blocked).toBe(true)
  })
})

describe('shell-env-scrub', () => {
  it('strips provider keys and keeps PATH/HOME', () => {
    const sanitized = sanitizeShellChildEnv({
      PATH: '/usr/bin',
      HOME: '/home/learner',
      OPENAI_API_KEY: 'sk-secret',
      ANTHROPIC_API_KEY: 'sk-ant',
      GITHUB_TOKEN: 'ghp_xxx',
      AWS_SECRET_ACCESS_KEY: 'aws',
      MY_CUSTOM_API_KEY: 'x',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color'
    })
    expect(sanitized.PATH).toBe('/usr/bin')
    expect(sanitized.HOME).toBe('/home/learner')
    expect(sanitized.LANG).toBe('en_US.UTF-8')
    expect(sanitized.TERM).toBe('xterm-256color')
    expect(sanitized.OPENAI_API_KEY).toBeUndefined()
    expect(sanitized.ANTHROPIC_API_KEY).toBeUndefined()
    expect(sanitized.GITHUB_TOKEN).toBeUndefined()
    expect(sanitized.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(sanitized.MY_CUSTOM_API_KEY).toBeUndefined()
  })

  it('isShellEnvKeyStripped marks secrets', () => {
    expect(isShellEnvKeyStripped('OPENAI_API_KEY')).toBe(true)
    expect(isShellEnvKeyStripped('PATH')).toBe(false)
    expect(isShellEnvKeyStripped('HOME')).toBe(false)
  })
})

describe('sandboxAllowsOutboundNetwork helper', () => {
  it('only full_access enables outbound network posture', () => {
    expect(sandboxAllowsOutboundNetwork('read_only')).toBe(false)
    expect(sandboxAllowsOutboundNetwork('workspace_write')).toBe(false)
    expect(sandboxAllowsOutboundNetwork('full_access')).toBe(true)
  })
})

describe('hardline enforced under 本课放行 (approval full_access)', () => {
  it('blocks rm -rf / even when approvalMode=full_access and sandboxMode=full_access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-hardline-'))
    cleanupPaths.push(root)
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.workspaceShell = true
    settings.tools.sandboxMode = 'full_access'
    settings.tools.approvalMode = 'full_access'
    const handler = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
      .handlerMap(buildToolContext(settings, { workspaceRoot: root }))
      .run_workspace_command
    if (!handler) throw new Error('missing tool')
    const raw = await handler({ argv: ['rm', '-rf', '/'] })
    const result = JSON.parse(raw) as Record<string, unknown>
    expect(result.error).toBe(true)
    expect(result.hardline).toBe(true)
    expect(String(result.code)).toBe('hardline_denied')
    expect(String(result.message ?? '')).toMatch(/hardline/i)
  })

  it('still allows ordinary workspace commands under 本课放行', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-hardline-ok-'))
    cleanupPaths.push(root)
    const settings = defaultSettings(root)
    settings.tools.workspaceRead = true
    settings.tools.workspaceShell = true
    settings.tools.sandboxMode = 'full_access'
    settings.tools.approvalMode = 'full_access'
    const handler = buildDefaultRegistry(settings, { workspaceRoot: root, workspaceWrite: true })
      .handlerMap(buildToolContext(settings, { workspaceRoot: root }))
      .run_workspace_command
    if (!handler) throw new Error('missing tool')
    const raw = await handler({
      argv: ['node', '-e', "process.stdout.write('hello-hardline-ok')"]
    })
    const result = JSON.parse(raw) as Record<string, unknown>
    expect(result.error).not.toBe(true)
    expect(result.ok).toBe(true)
    expect(String(result.stdout ?? '')).toMatch(/hello-hardline-ok/)
  })
})
