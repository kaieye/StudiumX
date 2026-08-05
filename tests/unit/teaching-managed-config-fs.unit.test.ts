import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_MANAGED_CONFIG_RELATIVE_PATH,
  loadManagedConfigDocumentFromJsonText,
  loadManagedConfigDocumentFromRoot,
  managedConfigOption,
  MANAGED_CONFIG_MAX_BYTES,
  normalizeManagedRelativePath,
  scopeWithManaged
} from '../../src/main/teaching-managed-config-fs'
import {
  resolveTeachingConfig,
  type TeachingConfigScope
} from '../../src/main/teaching-config-resolver'

const roots: string[] = []

async function managedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-managed-config-fs-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

const validManaged = {
  tools: { enabled: true, webSearch: false },
  memory: { maxInjected: 3 }
}

describe('normalizeManagedRelativePath', () => {
  it('accepts simple relative paths and rejects escape / absolute', () => {
    expect(normalizeManagedRelativePath('studiumx-managed-config.json')).toBe(
      'studiumx-managed-config.json'
    )
    expect(normalizeManagedRelativePath('org/policy.json')).toBe('org/policy.json')
    expect(normalizeManagedRelativePath('../escape.json')).toBeNull()
    expect(normalizeManagedRelativePath('/etc/passwd')).toBeNull()
    expect(normalizeManagedRelativePath('C:/Windows/system.ini')).toBeNull()
    expect(normalizeManagedRelativePath('')).toBeNull()
    expect(normalizeManagedRelativePath('   ')).toBeNull()
  })
})

describe('loadManagedConfigDocumentFromRoot', () => {
  it('returns null when the managed file is missing', async () => {
    const root = await managedRoot()
    await expect(loadManagedConfigDocumentFromRoot({ rootPath: root })).resolves.toBeNull()
  })

  it('loads a valid document from the default relative path', async () => {
    const root = await managedRoot()
    await writeFile(
      join(root, DEFAULT_MANAGED_CONFIG_RELATIVE_PATH),
      JSON.stringify(validManaged),
      'utf8'
    )

    const loaded = await loadManagedConfigDocumentFromRoot({ rootPath: root })
    expect(loaded).toEqual(validManaged)
    expect(DEFAULT_MANAGED_CONFIG_RELATIVE_PATH).toBe('studiumx-managed-config.json')
  })

  it('loads from an explicit relative path', async () => {
    const root = await managedRoot()
    await mkdir(join(root, 'org'), { recursive: true })
    await writeFile(
      join(root, 'org', 'managed.json'),
      JSON.stringify({ tools: { enabled: false } }),
      'utf8'
    )

    const loaded = await loadManagedConfigDocumentFromRoot({
      rootPath: root,
      relativePath: 'org/managed.json'
    })
    expect(loaded).toEqual({ tools: { enabled: false } })
  })

  it('returns null for invalid JSON', async () => {
    const root = await managedRoot()
    await writeFile(join(root, DEFAULT_MANAGED_CONFIG_RELATIVE_PATH), '{not-json', 'utf8')

    await expect(loadManagedConfigDocumentFromRoot({ rootPath: root })).resolves.toBeNull()
  })

  it('returns null for non-object top-level JSON (array / null / primitive)', async () => {
    const root = await managedRoot()
    for (const body of ['[]', 'null', '"string"', '42', 'true']) {
      await writeFile(join(root, DEFAULT_MANAGED_CONFIG_RELATIVE_PATH), body, 'utf8')
      await expect(loadManagedConfigDocumentFromRoot({ rootPath: root })).resolves.toBeNull()
    }
  })

  it('returns null for path-escape relative paths', async () => {
    const root = await managedRoot()
    await expect(
      loadManagedConfigDocumentFromRoot({
        rootPath: root,
        relativePath: '../escape.json'
      })
    ).resolves.toBeNull()

    await expect(
      loadManagedConfigDocumentFromRoot({
        rootPath: root,
        relativePath: '/etc/passwd'
      })
    ).resolves.toBeNull()

    await expect(
      loadManagedConfigDocumentFromRoot({
        rootPath: root,
        relativePath: 'C:/Windows/system.ini'
      })
    ).resolves.toBeNull()
  })

  it('returns null for empty root path', async () => {
    await expect(
      loadManagedConfigDocumentFromRoot({ rootPath: '   ' })
    ).resolves.toBeNull()
  })

  it('returns null when the document exceeds the bounded read limit', async () => {
    const root = await managedRoot()
    const oversize = `${'x'.repeat(200)}`
    await writeFile(join(root, DEFAULT_MANAGED_CONFIG_RELATIVE_PATH), oversize, 'utf8')

    await expect(
      loadManagedConfigDocumentFromRoot({
        rootPath: root,
        maxBytes: 64
      })
    ).resolves.toBeNull()
    expect(MANAGED_CONFIG_MAX_BYTES).toBe(64 * 1024)
  })
})

describe('loadManagedConfigDocumentFromJsonText', () => {
  it('parses valid object JSON and rejects garbage / non-objects', () => {
    expect(loadManagedConfigDocumentFromJsonText(JSON.stringify(validManaged))).toEqual(
      validManaged
    )
    expect(loadManagedConfigDocumentFromJsonText('{')).toBeNull()
    expect(loadManagedConfigDocumentFromJsonText('null')).toBeNull()
    expect(loadManagedConfigDocumentFromJsonText('[]')).toBeNull()
    expect(loadManagedConfigDocumentFromJsonText('"x"')).toBeNull()
  })
})

describe('managedConfigOption', () => {
  it('omits the field when document is null, undefined, or non-object', () => {
    expect(managedConfigOption(null)).toEqual({})
    expect(managedConfigOption(undefined)).toEqual({})
    expect(managedConfigOption([])).toEqual({})
    expect(managedConfigOption('x')).toEqual({})
    expect(Object.keys(managedConfigOption(null))).toEqual([])
  })

  it('returns managed when a plain object document is present', () => {
    expect(managedConfigOption(validManaged)).toEqual({ managed: validManaged })
  })

  it('product inject pattern: missing file omits managed; valid file layers into resolver', async () => {
    const root = await managedRoot()
    const missing = await loadManagedConfigDocumentFromRoot({ rootPath: root })
    expect(missing).toBeNull()

    const scopeMissing: TeachingConfigScope = {
      fallbackDefaultRoot: root,
      user: { tools: { webSearch: true } },
      ...managedConfigOption(missing)
    }
    expect(Object.prototype.hasOwnProperty.call(scopeMissing, 'managed')).toBe(false)
    const resolvedMissing = resolveTeachingConfig(scopeMissing)
    // user layer only — managed omitted.
    expect(resolvedMissing.value.tools.webSearch).toBe(true)
    expect(resolvedMissing.sources.some((s) => s.source === 'managed')).toBe(false)

    await writeFile(
      join(root, DEFAULT_MANAGED_CONFIG_RELATIVE_PATH),
      JSON.stringify(validManaged),
      'utf8'
    )
    const loaded = await loadManagedConfigDocumentFromRoot({ rootPath: root })
    expect(loaded).not.toBeNull()
    const scopeLoaded: TeachingConfigScope = {
      fallbackDefaultRoot: root,
      user: { tools: { webSearch: true } },
      ...managedConfigOption(loaded)
    }
    const resolved = resolveTeachingConfig(scopeLoaded)
    // Managed webSearch false is overridden by the user true value (user > managed).
    // The legacy tools.enabled value is accepted for compatibility but is
    // normalized to true without preserving a managed-layer source.
    expect(resolved.value.tools.webSearch).toBe(true)
    expect(resolved.value.tools.enabled).toBe(true)
    expect(resolved.sources.some((s) => s.source === 'managed' && s.path === 'tools.enabled')).toBe(
      false
    )
  })
})

describe('scopeWithManaged', () => {
  it('attaches managed when present and omits it on miss', () => {
    const base: TeachingConfigScope = {
      fallbackDefaultRoot: 'C:/data',
      user: { tools: { enabled: true } }
    }
    const withManaged = scopeWithManaged(base, validManaged)
    expect(withManaged.managed).toEqual(validManaged)

    const without = scopeWithManaged(
      { ...base, managed: { tools: { enabled: false } } },
      null
    )
    expect(Object.prototype.hasOwnProperty.call(without, 'managed')).toBe(false)
    expect(without.user).toEqual(base.user)
  })
})
