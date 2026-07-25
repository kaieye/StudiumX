import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveTeachingCapabilityPolicy } from '../../src/main/ai/agent-capability-policy'
import { buildDefaultRegistry } from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const SHELL_TOOL_NAMES = ['run_workspace_command', 'shell'] as const

async function makeWorkspaceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-shell-projection-'))
  cleanupPaths.push(root)
  return root
}

function projectShellNames(options: {
  workspaceRoot: string
  workspaceShell: boolean
  workspaceWrite: boolean
  toolsEnabled?: boolean
  workspaceToolAccessGranted?: boolean
  mode?: 'teaching' | 'temporary'
}): string[] {
  const settings = defaultSettings(options.workspaceRoot)
  settings.tools.enabled = options.toolsEnabled ?? true
  settings.tools.workspaceRead = true
  settings.tools.workspaceShell = options.workspaceShell
  settings.tools.webSearch = true
  settings.tools.webFetch = true

  const registry = buildDefaultRegistry(settings, {
    workspaceRoot: options.workspaceRoot,
    workspaceWrite: options.workspaceWrite
  })
  const policy = resolveTeachingCapabilityPolicy({
    mode: options.mode ?? 'teaching',
    toolsEnabled: settings.tools.enabled,
    hasTeachingWorkspace: true,
    workspaceToolAccessGranted: options.workspaceToolAccessGranted ?? true,
    hasLessonGenerator: true
  })
  return registry
    .project({
      allow: policy.allowedToolNames,
      deny: policy.deniedToolNames
    })
    .names()
}

describe('teaching shell capability projection (Stage A)', () => {
  it('exposes run_workspace_command and shell when tools on + workspaceShell + write grant', async () => {
    const root = await makeWorkspaceRoot()
    const names = projectShellNames({
      workspaceRoot: root,
      workspaceShell: true,
      workspaceWrite: true
    })
    for (const shellTool of SHELL_TOOL_NAMES) {
      expect(names).toContain(shellTool)
    }
  })

  it('matches temporary chat projection when workspace is granted', async () => {
    const root = await makeWorkspaceRoot()
    const names = projectShellNames({
      workspaceRoot: root,
      workspaceShell: true,
      workspaceWrite: true,
      mode: 'temporary'
    })
    for (const shellTool of SHELL_TOOL_NAMES) {
      expect(names).toContain(shellTool)
    }
  })

  it('omits shell tools when workspaceShell is false', async () => {
    const root = await makeWorkspaceRoot()
    const names = projectShellNames({
      workspaceRoot: root,
      workspaceShell: false,
      workspaceWrite: true
    })
    for (const shellTool of SHELL_TOOL_NAMES) {
      expect(names).not.toContain(shellTool)
    }
  })

  it('omits shell tools when workspaceWrite is false (no session grant at registry)', async () => {
    const root = await makeWorkspaceRoot()
    const names = projectShellNames({
      workspaceRoot: root,
      workspaceShell: true,
      workspaceWrite: false
    })
    for (const shellTool of SHELL_TOOL_NAMES) {
      expect(names).not.toContain(shellTool)
    }
  })

  it('omits shell tools when tools master switch is off', async () => {
    const root = await makeWorkspaceRoot()
    const names = projectShellNames({
      workspaceRoot: root,
      workspaceShell: true,
      workspaceWrite: true,
      toolsEnabled: false
    })
    for (const shellTool of SHELL_TOOL_NAMES) {
      expect(names).not.toContain(shellTool)
    }
  })

  it('omits shell tools when workspace tool access grant is withheld', async () => {
    const root = await makeWorkspaceRoot()
    const names = projectShellNames({
      workspaceRoot: root,
      workspaceShell: true,
      workspaceWrite: true,
      workspaceToolAccessGranted: false
    })
    for (const shellTool of SHELL_TOOL_NAMES) {
      expect(names).not.toContain(shellTool)
    }
  })
})
