import assert from 'node:assert/strict'

import { defaultSettings } from '../../src/main/teaching-settings'
import { buildDefaultRegistry, buildToolContext, ToolRegistry } from '../../src/main/ai/tools/registry'
import type { ToolEntry } from '../../src/main/ai/tools/registry'

const settings = defaultSettings('C:\\teachos-test-workspaces')
settings.tools.enabled = true
settings.tools.workspaceRead = true
settings.tools.webSearch = true
settings.tools.webFetch = true

const firstTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'sample_tool',
      description: 'First handler.',
      parameters: { type: 'object', properties: {} }
    }
  },
  handler: async (args, ctx, callCtx) => JSON.stringify({
    version: 'first',
    args,
    proxyUrl: ctx.proxyUrl,
    workspaceRoot: ctx.workspaceRoot,
    callCtx
  })
}

const replacementTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'sample_tool',
      description: 'Replacement handler.',
      parameters: { type: 'object', properties: { value: { type: 'string' } } }
    }
  },
  handler: async (args) => JSON.stringify({ version: 'replacement', args })
}

const registry = new ToolRegistry()
registry.register(firstTool)

assert.deepEqual(
  registry.definitions().map((tool) => tool.function.name),
  ['sample_tool'],
  'registered tools should be exposed as definitions'
)

const ctx = buildToolContext({
  ...settings,
  provider: {
    ...settings.provider,
    proxy: { enabled: true, url: ' http://127.0.0.1:7890 ' }
  }
}, { workspaceRoot: ' C:\\workspace\\course ' })

const handlerMap = registry.handlerMap(ctx)
assert.equal(typeof handlerMap.sample_tool, 'function', 'handlerMap should bind registered handlers')
assert.deepEqual(
  JSON.parse(await handlerMap.sample_tool({ value: 1 }, { toolCallId: 'call-1', toolName: 'sample_tool' })),
  {
    version: 'first',
    args: { value: 1 },
    proxyUrl: 'http://127.0.0.1:7890',
    workspaceRoot: 'C:\\workspace\\course',
    callCtx: { toolCallId: 'call-1', toolName: 'sample_tool' }
  },
  'bound handlers should receive ctx and per-call context'
)

registry.register(replacementTool)
assert.equal(registry.definitions().length, 1, 'registering the same function name should overwrite the previous entry')
assert.equal(registry.definitions()[0]?.function.description, 'Replacement handler.')
assert.equal(JSON.parse(await registry.handlerMap(ctx).sample_tool({ value: 'new' })).version, 'replacement')
assert.equal(handlerMap.sample_tool !== registry.handlerMap(ctx).sample_tool, true, 'handlerMap should create fresh bound functions')
assert.deepEqual(registry.names(), ['sample_tool'], 'names should expose registered tool names')

const secondTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'second_tool',
      description: 'Second handler.',
      parameters: { type: 'object', properties: {} }
    }
  },
  handler: async () => JSON.stringify({ version: 'second' })
}
registry.register(secondTool)
assert.deepEqual(registry.names(), ['sample_tool', 'second_tool'], 'names should preserve registry insertion order')
assert.deepEqual(
  registry.project({ allow: ['second_tool'] }).definitions().map((tool) => tool.function.name),
  ['second_tool'],
  'project allow-list should keep only selected tools'
)
assert.deepEqual(
  registry.project({ deny: ['sample_tool'] }).definitions().map((tool) => tool.function.name),
  ['second_tool'],
  'project deny-list should remove selected tools'
)
assert.deepEqual(
  registry.project({ allow: ['sample_tool', 'second_tool'], deny: ['sample_tool'] }).definitions().map((tool) => tool.function.name),
  ['second_tool'],
  'project deny-list should win over allow-list'
)

const noWorkspaceRegistry = buildDefaultRegistry(settings, { workspaceRoot: null })
assert.equal(
  noWorkspaceRegistry.definitions().some((tool) => tool.function.name.startsWith('read_workspace')),
  false,
  'workspace tools require a workspace root'
)
assert.equal(
  noWorkspaceRegistry.definitions().some((tool) => tool.function.name === 'web_search'),
  true,
  'web_search should be registered when enabled'
)
assert.equal(
  noWorkspaceRegistry.definitions().some((tool) => tool.function.name === 'web_fetch'),
  true,
  'web_fetch should be registered when enabled'
)

const readOnlyRegistry = buildDefaultRegistry(settings, { workspaceRoot: 'C:\\workspace\\course' })
assert.equal(
  readOnlyRegistry.definitions().some((tool) => tool.function.name === 'write_workspace_file'),
  false,
  'workspace write tool requires explicit workspaceWrite'
)

const writeRegistry = buildDefaultRegistry(settings, { workspaceRoot: 'C:\\workspace\\course', workspaceWrite: true })
assert.equal(
  writeRegistry.definitions().some((tool) => tool.function.name === 'write_workspace_file'),
  true,
  'workspaceWrite should expose write_workspace_file'
)

console.log('agent tool registry baseline ok')
