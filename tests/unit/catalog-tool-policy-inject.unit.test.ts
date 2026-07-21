/**
 * Catalog/read probe tool-policy inject (ADR-0101 / ADR-0117 multi-path residual):
 * teaching-capability-catalog (option B preloaded) + connector-health-catalog (async load).
 * Pure-path composition tests - no Electron, no agent loop.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT,
  evaluateToolPolicy,
  type ToolPolicyDocument
} from '../../src/main/ai/tools/tool-policy'
import {
  loadAndMergeToolPolicyDocumentsFromWorkspace,
  toolPolicyDocumentOption
} from '../../src/main/ai/tools/tool-policy-fs'
import { buildToolContext } from '../../src/main/ai/tools/registry'
import {
  loadToolPolicyForCapabilityCatalog,
  snapshotTeachingCapabilities
} from '../../src/main/teaching-capability-catalog'
import { createConnectorHealthCatalog } from '../../src/main/connector-health-catalog'
import { defaultSettings } from '../../src/main/teaching-settings'

const forbiddenWriteDoc: ToolPolicyDocument = {
  version: 1,
  defaultDecision: 'prompt',
  rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
}

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-catalog-tool-policy-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

/**
 * Mirrors capability option B inject:
 *   const toolPolicyDocument = await loadToolPolicyForCapabilityCatalog(workspaceRoot)
 *   snapshotTeachingCapabilities({ ..., workspaceRoot, toolPolicyDocument })
 *   // describeWebSearch -> buildToolContext(..., ...toolPolicyDocumentOption(doc))
 */
function composeCapabilityToolContextOptions(input: {
  workspaceRoot?: string | null
  toolPolicyDocument: ToolPolicyDocument | null
}): {
  workspaceRoot?: string | null
} & ReturnType<typeof toolPolicyDocumentOption> {
  return {
    workspaceRoot: input.workspaceRoot,
    ...toolPolicyDocumentOption(input.toolPolicyDocument)
  }
}

/**
 * Mirrors connector-health evaluate inject:
 *   const root = workspace?.rootPath?.trim() || ''
 *   const doc = root ? await loadAndMerge(...) : null
 *   buildToolContext(settings, { workspaceRoot: workspace?.rootPath, ...option(doc) })
 */
function composeConnectorToolContextOptions(input: {
  workspaceRoot?: string | null
  workspaceToolPolicy: ToolPolicyDocument | null
}): {
  workspaceRoot?: string | null
} & ReturnType<typeof toolPolicyDocumentOption> {
  const root =
    typeof input.workspaceRoot === 'string' ? input.workspaceRoot.trim() : ''
  const policy = root ? input.workspaceToolPolicy : null
  return {
    workspaceRoot: input.workspaceRoot,
    ...toolPolicyDocumentOption(policy)
  }
}

describe('capability-catalog tool-policy inject decision (ADR-0101 option B / ADR-0117)', () => {
  it('omits toolPolicyDocument when preloaded doc is null (default-equivalent)', () => {
    const options = composeCapabilityToolContextOptions({
      workspaceRoot: '/tmp/studiumx-capability-fixture',
      toolPolicyDocument: null
    })
    expect(options.workspaceRoot).toBe('/tmp/studiumx-capability-fixture')
    expect('toolPolicyDocument' in options).toBe(false)

    const ctx = buildToolContext(defaultSettings('/tmp/studiumx-capability-fixture'), options)
    expect(ctx.toolPolicyDocument).toBeUndefined()
    expect(ctx.toolPolicyDocument ?? DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT).toEqual(
      DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT
    )
  })

  it('product edge: empty root yields null load, then omits field', async () => {
    const loaded = await loadToolPolicyForCapabilityCatalog(undefined)
    expect(loaded).toBeNull()
    const options = composeCapabilityToolContextOptions({
      workspaceRoot: undefined,
      toolPolicyDocument: loaded
    })
    expect(options.workspaceRoot).toBeUndefined()
    expect('toolPolicyDocument' in options).toBe(false)

    const ctx = buildToolContext(defaultSettings('/tmp/x'), options)
    expect(ctx.toolPolicyDocument).toBeUndefined()
  })

  it('passes loaded document onto ToolContext for web_search probe', () => {
    const options = composeCapabilityToolContextOptions({
      workspaceRoot: '/tmp/studiumx-capability-fixture',
      toolPolicyDocument: forbiddenWriteDoc
    })
    expect(options).toEqual({
      workspaceRoot: '/tmp/studiumx-capability-fixture',
      toolPolicyDocument: forbiddenWriteDoc
    })

    const ctx = buildToolContext(defaultSettings('/tmp/studiumx-capability-fixture'), options)
    expect(ctx.toolPolicyDocument).toEqual(forbiddenWriteDoc)
  })

  it('snapshot accepts preloaded toolPolicyDocument without throwing', () => {
    const settings = defaultSettings('/tmp/studiumx-capability-fixture')
    settings.tools.enabled = true
    settings.tools.webSearch = true
    const snapshot = snapshotTeachingCapabilities({
      settings,
      mode: 'teaching',
      workspaceRoot: '/tmp/studiumx-capability-fixture',
      toolPolicyDocument: forbiddenWriteDoc,
      skills: []
    })
    expect(snapshot.items.some((item) => item.kind === 'web_search')).toBe(true)
  })

  it('loadToolPolicyForCapabilityCatalog returns null for empty/missing root (no FS)', async () => {
    await expect(loadToolPolicyForCapabilityCatalog(undefined)).resolves.toBeNull()
    await expect(loadToolPolicyForCapabilityCatalog(null)).resolves.toBeNull()
    await expect(loadToolPolicyForCapabilityCatalog('')).resolves.toBeNull()
    await expect(loadToolPolicyForCapabilityCatalog('   ')).resolves.toBeNull()
  })

  it('loadToolPolicyForCapabilityCatalog fails closed on missing policy file', async () => {
    await expect(
      loadToolPolicyForCapabilityCatalog('/tmp/studiumx-no-such-capability-policy-root')
    ).resolves.toBeNull()
  })

  it('loadToolPolicyForCapabilityCatalog multi-path merges primary + course overlay', async () => {
    const root = await workspace()
    await mkdir(join(root, '.studiumx'), { recursive: true })
    await writeFile(
      join(root, '.studiumx', 'tool-policy.json'),
      JSON.stringify({
        version: 1,
        defaultDecision: 'allow',
        rules: [{ tools: ['write_workspace_file'], decision: 'prompt' }]
      }),
      'utf8'
    )
    await writeFile(
      join(root, '.studiumx', 'tool-policy.course.json'),
      JSON.stringify({
        version: 1,
        defaultDecision: 'prompt',
        rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
      }),
      'utf8'
    )

    const loaded = await loadToolPolicyForCapabilityCatalog(root)
    expect(loaded).not.toBeNull()
    expect(loaded!.defaultDecision).toBe('prompt')
    expect(loaded!.rules).toEqual([
      { tools: ['write_workspace_file'], decision: 'prompt' },
      { tools: ['write_workspace_file'], decision: 'forbidden' }
    ])

    // Same helper path as product multi-path load (primary-only identity path covered elsewhere).
    const direct = await loadAndMergeToolPolicyDocumentsFromWorkspace({ workspaceRoot: root })
    expect(loaded).toEqual(direct)

    const evaluation = evaluateToolPolicy({
      document: loaded!,
      toolName: 'write_workspace_file',
      effectClass: 'workspace_write'
    })
    expect(evaluation.decision).toBe('forbidden')
  })

  it('loadToolPolicyForCapabilityCatalog primary-only matches single-file behavior', async () => {
    const root = await workspace()
    await mkdir(join(root, '.studiumx'), { recursive: true })
    await writeFile(
      join(root, '.studiumx', 'tool-policy.json'),
      JSON.stringify(forbiddenWriteDoc),
      'utf8'
    )

    const loaded = await loadToolPolicyForCapabilityCatalog(root)
    expect(loaded).toEqual(forbiddenWriteDoc)
  })
})

describe('connector-health-catalog tool-policy inject decision (ADR-0101 option C / ADR-0117)', () => {
  it('omits toolPolicyDocument when workspace root is missing/empty (no FS load)', () => {
    const options = composeConnectorToolContextOptions({
      workspaceRoot: undefined,
      workspaceToolPolicy: forbiddenWriteDoc
    })
    expect('toolPolicyDocument' in options).toBe(false)

    const ctx = buildToolContext(defaultSettings('/tmp/x'), options)
    expect(ctx.toolPolicyDocument).toBeUndefined()
    expect(ctx.toolPolicyDocument ?? DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT).toEqual(
      DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT
    )
  })

  it('omits toolPolicyDocument when load returns null', () => {
    const options = composeConnectorToolContextOptions({
      workspaceRoot: '/tmp/studiumx-connector-fixture',
      workspaceToolPolicy: null
    })
    expect(options.workspaceRoot).toBe('/tmp/studiumx-connector-fixture')
    expect('toolPolicyDocument' in options).toBe(false)

    const ctx = buildToolContext(defaultSettings('/tmp/studiumx-connector-fixture'), options)
    expect(ctx.toolPolicyDocument).toBeUndefined()
  })

  it('passes loaded document onto ToolContext for connector evaluate', () => {
    const options = composeConnectorToolContextOptions({
      workspaceRoot: '/tmp/studiumx-connector-fixture',
      workspaceToolPolicy: forbiddenWriteDoc
    })
    expect(options).toEqual({
      workspaceRoot: '/tmp/studiumx-connector-fixture',
      toolPolicyDocument: forbiddenWriteDoc
    })

    const ctx = buildToolContext(defaultSettings('/tmp/studiumx-connector-fixture'), options)
    expect(ctx.toolPolicyDocument).toEqual(forbiddenWriteDoc)
  })

  it('evaluate with null workspace does not throw and keeps web connectors readable', async () => {
    const catalog = createConnectorHealthCatalog({
      probeCommand: async () => ({ stdout: 'rg 14.0.0\n' })
    })
    const settings = defaultSettings('/tmp/x')
    settings.tools.enabled = true
    settings.tools.webSearch = true
    settings.tools.webFetch = true
    const statuses = await catalog.evaluate(settings, null)
    expect(statuses.some((s) => s.id === 'web_search')).toBe(true)
    expect(statuses.some((s) => s.id === 'workspace_files')).toBe(true)
  })
})

describe('toolPolicyDocumentOption shared semantics (catalog residual)', () => {
  it('matches ADR-0083/0088 omit-on-null contract', () => {
    expect(toolPolicyDocumentOption(null)).toEqual({})
    expect(toolPolicyDocumentOption(undefined)).toEqual({})
    expect(toolPolicyDocumentOption(forbiddenWriteDoc)).toEqual({
      toolPolicyDocument: forbiddenWriteDoc
    })
  })
})
