import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  attachWorkspaceToolPolicyDocument,
  DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATH,
  DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATHS,
  loadAndMergeToolPolicyDocumentsFromWorkspace,
  loadToolPolicyDocumentFromJsonText,
  loadToolPolicyDocumentFromWorkspace,
  OPTIONAL_COURSE_TOOL_POLICY_RELATIVE_PATH,
  toolPolicyDocumentOption,
  WORKSPACE_TOOL_POLICY_MAX_BYTES
} from '../../src/main/ai/tools/tool-policy-fs'
import {
  DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT,
  evaluateToolPolicy
} from '../../src/main/ai/tools/tool-policy'
import { buildToolContext } from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-tool-policy-fs-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

const validDocument = {
  version: 1 as const,
  defaultDecision: 'prompt' as const,
  rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' as const }]
}

describe('loadToolPolicyDocumentFromWorkspace', () => {
  it('returns null when the policy file is missing', async () => {
    const root = await workspace()
    await expect(
      loadToolPolicyDocumentFromWorkspace({ workspaceRoot: root })
    ).resolves.toBeNull()
  })

  it('loads a valid document from the default relative path', async () => {
    const root = await workspace()
    const targetDir = join(root, '.studiumx')
    await mkdir(targetDir, { recursive: true })
    await writeFile(
      join(targetDir, 'tool-policy.json'),
      JSON.stringify(validDocument),
      'utf8'
    )

    const loaded = await loadToolPolicyDocumentFromWorkspace({ workspaceRoot: root })
    expect(loaded).toEqual({
      version: 1,
      defaultDecision: 'prompt',
      rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
    })
    expect(DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATH).toBe('.studiumx/tool-policy.json')
  })

  it('loads from an explicit relative path', async () => {
    const root = await workspace()
    await mkdir(join(root, 'course'), { recursive: true })
    await writeFile(
      join(root, 'course', 'policy.json'),
      JSON.stringify({
        version: 1,
        rules: [{ effects: ['workspace_write'], decision: 'prompt' }]
      }),
      'utf8'
    )

    const loaded = await loadToolPolicyDocumentFromWorkspace({
      workspaceRoot: root,
      relativePath: 'course/policy.json'
    })
    expect(loaded).toEqual({
      version: 1,
      rules: [{ effects: ['workspace_write'], decision: 'prompt' }]
    })
  })

  it('returns null for invalid JSON', async () => {
    const root = await workspace()
    await mkdir(join(root, '.studiumx'), { recursive: true })
    await writeFile(join(root, '.studiumx', 'tool-policy.json'), '{not-json', 'utf8')

    await expect(
      loadToolPolicyDocumentFromWorkspace({ workspaceRoot: root })
    ).resolves.toBeNull()
  })

  it('returns null for YOLO / argv fields (via pure loader)', async () => {
    const root = await workspace()
    await mkdir(join(root, '.studiumx'), { recursive: true })

    await writeFile(
      join(root, '.studiumx', 'tool-policy.json'),
      JSON.stringify({
        version: 1,
        rules: [{ tools: ['x'], decision: 'allow', yolo: true }]
      }),
      'utf8'
    )
    await expect(
      loadToolPolicyDocumentFromWorkspace({ workspaceRoot: root })
    ).resolves.toBeNull()

    await writeFile(
      join(root, '.studiumx', 'tool-policy.json'),
      JSON.stringify({
        version: 1,
        rules: [{ tools: ['x'], decision: 'forbidden', argv: ['rm', '-rf'] }]
      }),
      'utf8'
    )
    await expect(
      loadToolPolicyDocumentFromWorkspace({ workspaceRoot: root })
    ).resolves.toBeNull()

    await writeFile(
      join(root, '.studiumx', 'tool-policy.json'),
      JSON.stringify({
        version: 1,
        rules: [{ tools: ['x'], decision: 'allow', prefix_rule: 'git' }]
      }),
      'utf8'
    )
    await expect(
      loadToolPolicyDocumentFromWorkspace({ workspaceRoot: root })
    ).resolves.toBeNull()
  })

  it('returns null for path-escape relative paths', async () => {
    const root = await workspace()
    await expect(
      loadToolPolicyDocumentFromWorkspace({
        workspaceRoot: root,
        relativePath: '../escape.json'
      })
    ).resolves.toBeNull()

    await expect(
      loadToolPolicyDocumentFromWorkspace({
        workspaceRoot: root,
        relativePath: '/etc/passwd'
      })
    ).resolves.toBeNull()

    await expect(
      loadToolPolicyDocumentFromWorkspace({
        workspaceRoot: root,
        relativePath: 'C:/Windows/system.ini'
      })
    ).resolves.toBeNull()
  })

  it('returns null for empty workspace root', async () => {
    await expect(
      loadToolPolicyDocumentFromWorkspace({ workspaceRoot: '   ' })
    ).resolves.toBeNull()
  })

  it('returns null when the document exceeds the bounded read limit', async () => {
    const root = await workspace()
    await mkdir(join(root, '.studiumx'), { recursive: true })
    // Small maxBytes forces over_limit without writing 64KiB+ fixtures.
    const oversize = `${'x'.repeat(200)}`
    await writeFile(join(root, '.studiumx', 'tool-policy.json'), oversize, 'utf8')

    await expect(
      loadToolPolicyDocumentFromWorkspace({
        workspaceRoot: root,
        maxBytes: 64
      })
    ).resolves.toBeNull()
    expect(WORKSPACE_TOOL_POLICY_MAX_BYTES).toBe(64 * 1024)
  })

  it('returns null for invalid document shape (bad version)', async () => {
    const root = await workspace()
    await mkdir(join(root, '.studiumx'), { recursive: true })
    await writeFile(
      join(root, '.studiumx', 'tool-policy.json'),
      JSON.stringify({ version: 2, rules: [] }),
      'utf8'
    )
    await expect(
      loadToolPolicyDocumentFromWorkspace({ workspaceRoot: root })
    ).resolves.toBeNull()
  })
})

describe('loadToolPolicyDocumentFromJsonText', () => {
  it('parses valid JSON text and rejects garbage', () => {
    expect(loadToolPolicyDocumentFromJsonText(JSON.stringify(validDocument))).toEqual({
      version: 1,
      defaultDecision: 'prompt',
      rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
    })
    expect(loadToolPolicyDocumentFromJsonText('{')).toBeNull()
    expect(loadToolPolicyDocumentFromJsonText('null')).toBeNull()
  })
})

describe('toolPolicyDocumentOption', () => {
  it('omits the field when document is null or undefined (default-equivalent inject)', () => {
    expect(toolPolicyDocumentOption(null)).toEqual({})
    expect(toolPolicyDocumentOption(undefined)).toEqual({})
    expect(Object.keys(toolPolicyDocumentOption(null))).toEqual([])
  })

  it('returns toolPolicyDocument when a document is present', () => {
    const document = {
      version: 1 as const,
      defaultDecision: 'prompt' as const,
      rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' as const }]
    }
    expect(toolPolicyDocumentOption(document)).toEqual({ toolPolicyDocument: document })
  })

  it('product inject pattern: missing file omits field; valid file attaches document', async () => {
    const root = await workspace()
    const settings = defaultSettings(root)

    // Missing file → null → omit field → registry default document path.
    const missing = await loadToolPolicyDocumentFromWorkspace({ workspaceRoot: root })
    expect(missing).toBeNull()
    const ctxMissing = buildToolContext(settings, {
      workspaceRoot: root,
      ...toolPolicyDocumentOption(missing)
    })
    expect(Object.prototype.hasOwnProperty.call(ctxMissing, 'toolPolicyDocument')).toBe(true)
    // buildToolContext always assigns the option field (possibly undefined).
    expect(ctxMissing.toolPolicyDocument).toBeUndefined()
    // Callers that omit leave undefined; resolve uses ?? DEFAULT.
    expect(ctxMissing.toolPolicyDocument ?? DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT).toEqual(
      DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT
    )

    await mkdir(join(root, '.studiumx'), { recursive: true })
    await writeFile(
      join(root, '.studiumx', 'tool-policy.json'),
      JSON.stringify(validDocument),
      'utf8'
    )
    const loaded = await loadToolPolicyDocumentFromWorkspace({ workspaceRoot: root })
    expect(loaded).not.toBeNull()
    const ctxLoaded = buildToolContext(settings, {
      workspaceRoot: root,
      ...toolPolicyDocumentOption(loaded)
    })
    expect(ctxLoaded.toolPolicyDocument).toEqual({
      version: 1,
      defaultDecision: 'prompt',
      rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
    })
  })
})

describe('attachWorkspaceToolPolicyDocument', () => {
  it('attaches a loaded document without inventing defaults when null', () => {
    const base = {
      settings: {} as never,
      proxyUrl: '',
      toolPolicyDocument: DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT
    }

    const withDoc = attachWorkspaceToolPolicyDocument(base, {
      version: 1,
      defaultDecision: 'prompt',
      rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
    })
    expect(withDoc.toolPolicyDocument).toEqual({
      version: 1,
      defaultDecision: 'prompt',
      rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
    })

    // Explicit null after a failed load — caller may clear; does not invent YOLO.
    const cleared = attachWorkspaceToolPolicyDocument(base, null)
    expect(cleared.toolPolicyDocument).toBeNull()

    // undefined document leaves the object unchanged (identity-preserving skip).
    const untouched = attachWorkspaceToolPolicyDocument(base, undefined)
    expect(untouched).toBe(base)
  })
})


describe('loadAndMergeToolPolicyDocumentsFromWorkspace', () => {
  it('returns null when no policy files exist (default-equivalent omit)', async () => {
    const root = await workspace()
    await expect(
      loadAndMergeToolPolicyDocumentsFromWorkspace({ workspaceRoot: root })
    ).resolves.toBeNull()
  })

  it('returns primary-only document when course overlay is missing', async () => {
    const root = await workspace()
    await mkdir(join(root, '.studiumx'), { recursive: true })
    await writeFile(
      join(root, '.studiumx', 'tool-policy.json'),
      JSON.stringify(validDocument),
      'utf8'
    )

    const loaded = await loadAndMergeToolPolicyDocumentsFromWorkspace({ workspaceRoot: root })
    expect(loaded).toEqual({
      version: 1,
      defaultDecision: 'prompt',
      rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
    })
    // Identical to single-file load for primary-only workspaces.
    const single = await loadToolPolicyDocumentFromWorkspace({ workspaceRoot: root })
    expect(loaded).toEqual(single)
  })

  it('returns secondary-only document when primary is missing', async () => {
    const root = await workspace()
    await mkdir(join(root, '.studiumx'), { recursive: true })
    await writeFile(
      join(root, '.studiumx', 'tool-policy.course.json'),
      JSON.stringify({
        version: 1,
        defaultDecision: 'prompt',
        rules: [{ tools: ['read_workspace_file'], decision: 'forbidden' }]
      }),
      'utf8'
    )

    const loaded = await loadAndMergeToolPolicyDocumentsFromWorkspace({ workspaceRoot: root })
    expect(loaded).toEqual({
      version: 1,
      defaultDecision: 'prompt',
      rules: [{ tools: ['read_workspace_file'], decision: 'forbidden' }]
    })
  })

  it('merges multi-path documents with most-restrictive-wins', async () => {
    const root = await workspace()
    await mkdir(join(root, '.studiumx'), { recursive: true })
    // Primary: allow default + prompt on write
    await writeFile(
      join(root, '.studiumx', 'tool-policy.json'),
      JSON.stringify({
        version: 1,
        defaultDecision: 'allow',
        rules: [{ tools: ['write_workspace_file'], decision: 'prompt' }]
      }),
      'utf8'
    )
    // Course overlay: forbid write (strictest for that tool)
    await writeFile(
      join(root, '.studiumx', 'tool-policy.course.json'),
      JSON.stringify({
        version: 1,
        defaultDecision: 'prompt',
        rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
      }),
      'utf8'
    )

    const loaded = await loadAndMergeToolPolicyDocumentsFromWorkspace({ workspaceRoot: root })
    expect(loaded).not.toBeNull()
    expect(loaded!.version).toBe(1)
    // defaultDecision strictest of allow+prompt → prompt
    expect(loaded!.defaultDecision).toBe('prompt')
    // rules concatenated in path order
    expect(loaded!.rules).toEqual([
      { tools: ['write_workspace_file'], decision: 'prompt' },
      { tools: ['write_workspace_file'], decision: 'forbidden' }
    ])

    const evaluation = evaluateToolPolicy({
      document: loaded!,
      toolName: 'write_workspace_file',
      effectClass: 'workspace_write'
    })
    expect(evaluation.decision).toBe('forbidden')
  })

  it('ignores invalid secondary and keeps valid primary', async () => {
    const root = await workspace()
    await mkdir(join(root, '.studiumx'), { recursive: true })
    await writeFile(
      join(root, '.studiumx', 'tool-policy.json'),
      JSON.stringify(validDocument),
      'utf8'
    )
    // Invalid secondary (YOLO field rejected by pure loader → null skip)
    await writeFile(
      join(root, '.studiumx', 'tool-policy.course.json'),
      JSON.stringify({
        version: 1,
        rules: [{ tools: ['write_workspace_file'], decision: 'allow', yolo: true }]
      }),
      'utf8'
    )

    const loaded = await loadAndMergeToolPolicyDocumentsFromWorkspace({ workspaceRoot: root })
    expect(loaded).toEqual({
      version: 1,
      defaultDecision: 'prompt',
      rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
    })
  })

  it('ignores invalid JSON secondary and keeps valid primary', async () => {
    const root = await workspace()
    await mkdir(join(root, '.studiumx'), { recursive: true })
    await writeFile(
      join(root, '.studiumx', 'tool-policy.json'),
      JSON.stringify(validDocument),
      'utf8'
    )
    await writeFile(join(root, '.studiumx', 'tool-policy.course.json'), '{not-json', 'utf8')

    const loaded = await loadAndMergeToolPolicyDocumentsFromWorkspace({ workspaceRoot: root })
    expect(loaded).toEqual(validDocument)
  })

  it('returns null for empty workspace root', async () => {
    await expect(
      loadAndMergeToolPolicyDocumentsFromWorkspace({ workspaceRoot: '   ' })
    ).resolves.toBeNull()
  })

  it('accepts explicit relativePaths order and skips blank entries', async () => {
    const root = await workspace()
    await mkdir(join(root, 'course'), { recursive: true })
    await writeFile(
      join(root, 'course', 'a.json'),
      JSON.stringify({
        version: 1,
        defaultDecision: 'allow',
        rules: [{ tools: ['write_workspace_file'], decision: 'prompt' }]
      }),
      'utf8'
    )
    await writeFile(
      join(root, 'course', 'b.json'),
      JSON.stringify({
        version: 1,
        defaultDecision: 'forbidden',
        rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
      }),
      'utf8'
    )

    const loaded = await loadAndMergeToolPolicyDocumentsFromWorkspace({
      workspaceRoot: root,
      relativePaths: ['course/a.json', '', 'course/b.json']
    })
    expect(loaded).not.toBeNull()
    expect(loaded!.defaultDecision).toBe('forbidden')
    expect(loaded!.rules).toHaveLength(2)
  })

  it('exports course overlay path convention constants', () => {
    expect(OPTIONAL_COURSE_TOOL_POLICY_RELATIVE_PATH).toBe('.studiumx/tool-policy.course.json')
    expect(DEFAULT_WORKSPACE_TOOL_POLICY_RELATIVE_PATHS).toEqual([
      '.studiumx/tool-policy.json',
      '.studiumx/tool-policy.course.json'
    ])
  })
})
