import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  missingToolPathMessage,
  readToolPathArg,
  requireToolPathArg
} from '../../src/main/ai/tools/tool-arguments'
import {
  listWorkspaceTool,
  readWorkspaceFileTool,
  runWorkspaceWriteWithDurableDependenciesForTesting,
  searchWorkspaceTool
} from '../../src/main/ai/tools/workspace'
import { buildToolContext } from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'
import { extractReadPathTargets } from '../../src/main/ai/tools/parallel-read-dispatcher'

const roots: string[] = []

async function makeWorkspace(): Promise<{ root: string; ctx: ReturnType<typeof buildToolContext> }> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-path-alias-'))
  roots.push(root)
  await writeFile(join(root, 'MISSION.md'), '# Mission\nLearn MCP safely.\n', 'utf8')
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'a.md'), 'note-a\n', 'utf8')
  return { root, ctx: buildToolContext(defaultSettings(root), { workspaceRoot: root }) }
}

function parse(result: string): Record<string, unknown> {
  return JSON.parse(result) as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('tool path argument aliases', () => {
  it('reads canonical path and common aliases, preferring path', () => {
    expect(readToolPathArg({ path: 'a.md', file_path: 'b.md' })).toEqual({
      path: 'a.md',
      sourceKey: 'path'
    })
    expect(readToolPathArg({ file_path: 'MISSION.md' })).toEqual({
      path: 'MISSION.md',
      sourceKey: 'file_path'
    })
    expect(readToolPathArg({ filepath: 'x.md' }).path).toBe('x.md')
    expect(readToolPathArg({ filePath: 'y.md' }).path).toBe('y.md')
    expect(readToolPathArg({ file_path: '   ' }).path).toBeUndefined()
    expect(readToolPathArg(null).path).toBeUndefined()
  })

  it('requireToolPathArg throws actionable missing messages', () => {
    expect(() => requireToolPathArg({})).toThrow('缺少参数 path。')
    expect(() => requireToolPathArg({ file_path: '' })).toThrow(/path/)
    expect(() => requireToolPathArg({ target: 'a.md' })).toThrow(/不要使用 target/)
    expect(requireToolPathArg({ file_path: 'MISSION.md' })).toBe('MISSION.md')
  })

  it('missingToolPathMessage supports English locale for skill resources', () => {
    expect(missingToolPathMessage({}, 'en')).toBe('Missing path.')
    expect(missingToolPathMessage({ file_path: '' }, 'en')).toMatch(/path/)
  })
})

describe('workspace tools accept file_path alias', () => {
  it('read_workspace_file succeeds with file_path', async () => {
    const { ctx } = await makeWorkspace()
    const result = parse(await readWorkspaceFileTool.handler({ file_path: 'MISSION.md' }, ctx))
    expect(result.error).toBeUndefined()
    expect(result.path).toBe('MISSION.md')
    expect(String(result.content)).toContain('Learn MCP safely')
  })

  it('read_workspace_file still requires a path when no alias is usable', async () => {
    const { ctx } = await makeWorkspace()
    const result = parse(await readWorkspaceFileTool.handler({}, ctx))
    expect(result.tool).toBe('read_workspace_file')
    expect(String(result.error)).toContain('缺少参数 path')
  })

  it('list_workspace respects file_path instead of silently listing root', async () => {
    const { ctx } = await makeWorkspace()
    const result = parse(
      await listWorkspaceTool.handler({ file_path: 'notes', recursive: false }, ctx)
    )
    expect(result.error).toBeUndefined()
    expect(result.root).toBe('notes')
    const entries = result.entries as Array<{ path: string }>
    expect(entries.some((entry) => entry.path === 'notes/a.md' || entry.path.endsWith('a.md'))).toBe(true)
  })

  it('search_workspace scopes file_path to the target file', async () => {
    const { ctx } = await makeWorkspace()
    const result = parse(
      await searchWorkspaceTool.handler(
        { pattern: 'Learn MCP', file_path: 'MISSION.md', regex: false },
        ctx
      )
    )
    expect(result.error).toBeUndefined()
    expect(result.path).toBe('MISSION.md')
    expect(result.count).toBeGreaterThan(0)
  })

  it('write_workspace_file accepts file_path for durable create', async () => {
    const { root, ctx } = await makeWorkspace()
    const result = parse(
      await runWorkspaceWriteWithDurableDependenciesForTesting(
        { file_path: 'notes/from-alias.md', content: 'hello-alias\n' },
        ctx
      )
    )
    expect(result.error).toBeUndefined()
    expect(result.path).toBe('notes/from-alias.md')
    expect(result.created).toBe(true)
    const written = await (await import('node:fs/promises')).readFile(
      join(root, 'notes', 'from-alias.md'),
      'utf8'
    )
    expect(written).toBe('hello-alias\n')
  })
})

describe('parallel-read path extraction', () => {
  it('includes file_path aliases as read targets', () => {
    expect(extractReadPathTargets({ file_path: 'MISSION.md' })).toEqual(['MISSION.md'])
    expect(extractReadPathTargets({ path: 'a.md', file_path: 'b.md' })).toEqual(['a.md', 'b.md'])
  })
})
