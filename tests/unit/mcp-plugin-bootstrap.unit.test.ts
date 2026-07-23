import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  bootstrapPluginMcpFromFilesystem,
  listPluginCandidateDirs,
  loadPluginMcpFragmentFromDir,
  unregisterBootstrappedPlugin
} from '../../src/main/mcp/plugin-mcp-bootstrap'
import { PluginMcpRegistry } from '../../src/main/mcp/plugin-mcp-registry'

async function writePlugin(
  root: string,
  dirName: string,
  manifest: unknown,
  fileName = 'plugin.json'
): Promise<string> {
  const pluginRoot = join(root, dirName)
  await mkdir(pluginRoot, { recursive: true })
  await writeFile(join(pluginRoot, fileName), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return pluginRoot
}

describe('plugin MCP filesystem bootstrap (ADR-0139/0141)', () => {
  it('lists candidate dirs that contain manifests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-plugin-scan-'))
    await writePlugin(root, 'alpha', {
      id: 'alpha',
      name: 'Alpha',
      version: '1.0.0',
      schemaVersion: 1,
      mcpServers: [{ serverId: 's', transport: 'stdio', command: 'echo' }]
    })
    await mkdir(join(root, 'empty'), { recursive: true })
    const dirs = await listPluginCandidateDirs(root)
    expect(dirs.some((d) => d.endsWith('alpha'))).toBe(true)
    expect(dirs.some((d) => d.endsWith('empty'))).toBe(false)
  })

  it('loads extension-style contribution mcpServers JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-plugin-contrib-'))
    const pluginRoot = join(root, 'pack')
    await mkdir(join(pluginRoot, 'mcp'), { recursive: true })
    await writeFile(
      join(pluginRoot, 'mcp', 'servers.json'),
      JSON.stringify({
        mcpServers: [
          {
            serverId: 'tools',
            label: 'Tools',
            transport: 'stdio',
            command: '{{pluginRoot}}/bin',
            args: []
          }
        ]
      }),
      'utf8'
    )
    await writeFile(
      join(pluginRoot, 'plugin.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'contrib-pack',
        name: 'Contrib',
        version: '0.1.0',
        contributions: [{ kind: 'mcpServers', path: 'mcp/servers.json' }]
      }),
      'utf8'
    )
    const loaded = await loadPluginMcpFragmentFromDir(pluginRoot)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.pluginId).toBe('contrib-pack')
    expect(Array.isArray(loaded.fragment.mcpServers)).toBe(true)
  })

  it('registers builtin as trusted and local as auto-trusted into source servers', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'mcp-plugin-boot-'))
    const builtinRoot = join(fixtureRoot, 'builtin-mcp-plugins')
    const localRoot = join(fixtureRoot, 'local-plugins')
    await mkdir(builtinRoot, { recursive: true })
    await mkdir(localRoot, { recursive: true })

    await writePlugin(builtinRoot, 'shipped', {
      pluginId: 'shipped-pack',
      mcpServers: [
        {
          serverId: 'core',
          label: 'Core',
          transport: 'stdio',
          command: '{{pluginRoot}}/run',
          args: ['--builtin']
        }
      ]
    })
    await writePlugin(localRoot, 'user-pack', {
      id: 'user-pack',
      name: 'User Pack',
      version: '1.0.0',
      schemaVersion: 1,
      mcpServers: [
        {
          serverId: 'fs',
          transport: 'stdio',
          command: '{{pluginRoot}}/mcp',
          args: []
        }
      ]
    })

    const registry = new PluginMcpRegistry()
    const result = await bootstrapPluginMcpFromFilesystem({
      registry,
      scanRoots: [localRoot],
      resolveBuiltinRoots: () => [builtinRoot],
      userHome: fixtureRoot,
      userDataPath: null,
      autoTrustLocal: true
    })

    expect(result.hits.filter((h) => h.ok)).toHaveLength(2)
    const trusted = registry.listTrustedServers()
    expect(trusted.length).toBeGreaterThanOrEqual(2)
    const source = registry.toPluginSourceServers('2026-07-23T00:00:00.000Z')
    expect(source.length).toBeGreaterThanOrEqual(2)
    expect(source.every((s) => s.command?.includes(fixtureRoot) || s.command?.includes('run') || s.command?.includes('mcp'))).toBe(
      true
    )

    const ids = await unregisterBootstrappedPlugin(registry, 'user-pack')
    expect(ids.length).toBe(1)
    expect(registry.list('user-pack')).toHaveLength(0)
  })

  it('fail-soft skips missing roots and bad manifests', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'mcp-plugin-soft-'))
    const badRoot = join(fixtureRoot, 'plugins')
    await mkdir(badRoot, { recursive: true })
    await writePlugin(badRoot, 'broken', { notAPlugin: true })

    const registry = new PluginMcpRegistry()
    const result = await bootstrapPluginMcpFromFilesystem({
      registry,
      scanRoots: [join(fixtureRoot, 'does-not-exist'), badRoot],
      resolveBuiltinRoots: () => [join(fixtureRoot, 'no-builtin')],
      userDataPath: null,
      userHome: fixtureRoot
    })
    // broken has no plugin id → hit with ok:false; no throw
    expect(result.hits.every((h) => typeof h.ok === 'boolean')).toBe(true)
    expect(registry.list()).toHaveLength(0)
  })
})
