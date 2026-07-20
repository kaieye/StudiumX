import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createExternalSearchGroundingAdapter,
  createExternalUrlGroundingAdapter
} from '../../src/main/resource-grounder-external-adapters'
import {
  createMultiSourceResourceGrounder,
  createResourceGrounder,
  createWorkspaceResourceAdapter,
  groundWithAdapters,
  type GroundingSourceAdapter
} from '../../src/main/resource-grounder'
import {
  isResourceGap,
  type ExternalSearchSnippetDescriptor,
  type ExternalUrlGroundingDescriptor,
  type GroundingPack,
  type TrustedTeachingResourceDescriptor
} from '../../src/shared/teaching-types/grounding'

const AUTHORITY_ID = 'authority-resource-grounder-deepen'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function descriptor(
  sourceId: string,
  relativePath: string,
  content: string,
  overrides: Partial<TrustedTeachingResourceDescriptor> = {}
): TrustedTeachingResourceDescriptor {
  return {
    schemaVersion: 1,
    sourceId,
    relativePath,
    contentSha256: sha256(content),
    priority: 'recommended',
    authority: { kind: 'trusted_teaching_resource', authorityId: AUTHORITY_ID },
    provenance: { kind: 'workspace_resource', resourceId: `resource-${sourceId}`, revisionId: 'revision-1' },
    ...overrides
  }
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-resource-grounder-deepen-'))
  roots.push(root)
  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const target = join(root, relativePath)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
  }))
  return root
}

function externalUrl(
  sourceId: string,
  url: string,
  contentText: string,
  overrides: Partial<ExternalUrlGroundingDescriptor> = {}
): ExternalUrlGroundingDescriptor {
  return {
    schemaVersion: 1,
    sourceId,
    url,
    contentText,
    contentSha256: sha256(contentText),
    priority: 'supplemental',
    useFor: ['external_supplement', 'source_preview'],
    provider: 'web_fetch',
    retrievedAt: '2026-07-20T00:00:00.000Z',
    ...overrides
  }
}

function safeUrl(url: string): string {
  if (!/^https:\/\//.test(url) || /localhost|127\.0\.0\.1|10\./.test(url)) {
    throw new Error('unsafe url')
  }
  return url
}

describe('ResourceGrounder deepen', () => {
  it('emits digest, trust, useFor, and freshness for trusted workspace sources', async () => {
    const content = 'Trusted theorem.'
    const root = await fixture({ 'resources/theorem.txt': content })
    const pack = await createResourceGrounder({
      workspaceRoot: root,
      trustedAuthorityId: AUTHORITY_ID,
      maxBytes: 256
    }).ground([descriptor('source-theorem', 'resources/theorem.txt', content, { priority: 'required' })])

    expect(pack.status).toBe('ready')
    expect(pack.sources).toHaveLength(1)
    expect(pack.sources[0]).toMatchObject({
      sourceId: 'source-theorem',
      contentSha256: sha256(content),
      digest: sha256(content),
      trust: 'trusted_workspace',
      useFor: ['lesson_context', 'source_preview'],
      freshness: { kind: 'revision_matched', revisionId: 'revision-1' },
      location: { kind: 'workspace_relative_path', relativePath: 'resources/theorem.txt' }
    })
  })

  it('dedupes across adapters by sourceId and content digest while keeping typed exclusions', async () => {
    const content = 'Shared bytes.'
    const root = await fixture({ 'resources/shared.txt': content })
    const workspace = createWorkspaceResourceAdapter({
      workspaceRoot: root,
      trustedAuthorityId: AUTHORITY_ID,
      maxBytes: 256
    })
    const workspacePackAdapter: GroundingSourceAdapter = {
      kind: 'workspace_resource',
      ground: async () => workspace.groundDescriptors([
        descriptor('source-shared', 'resources/shared.txt', content, { priority: 'required' })
      ])
    }
    const external = createExternalUrlGroundingAdapter([
      externalUrl('source-shared', 'https://example.com/shared', content, { priority: 'supplemental' }),
      externalUrl('source-external-dup', 'https://example.com/other', content, { priority: 'supplemental' })
    ], { maxBytes: 256, assertSafeUrl: safeUrl })

    const pack = await groundWithAdapters([workspacePackAdapter, external], { maxBytes: 256 })

    expect(pack.sources.map((source) => source.sourceId)).toEqual(['source-shared'])
    expect(pack.exclusions).toEqual(expect.arrayContaining([
      { sourceId: 'source-shared', relativePath: 'https://example.com/shared', code: 'duplicate_source_id' },
      expect.objectContaining({ sourceId: 'source-external-dup', code: 'duplicate_chunk' })
    ]))
    expect(pack.sources[0]?.trust).toBe('trusted_workspace')
  })

  it('marks external_untrusted sources with safe URL, digest, and useFor without writing the workspace', async () => {
    const root = await fixture({})
    const before = await readdir(root)
    const body = 'External teaching supplement.'
    const adapter = createExternalUrlGroundingAdapter([
      externalUrl('source-external', 'https://example.com/lesson', body)
    ], { maxBytes: 512, assertSafeUrl: safeUrl })

    const pack = await adapter.ground()
    const after = await readdir(root)

    expect(after).toEqual(before)
    expect(pack.status).toBe('ready')
    expect(pack.sources[0]).toMatchObject({
      sourceId: 'source-external',
      trust: 'external_untrusted',
      digest: sha256(body),
      useFor: ['external_supplement', 'source_preview'],
      freshness: { kind: 'retrieved_at', retrievedAt: '2026-07-20T00:00:00.000Z' },
      location: { kind: 'http_url', url: 'https://example.com/lesson' },
      provenance: {
        kind: 'external_resource',
        resourceId: 'source-external',
        provider: 'web_fetch',
        retrievedAt: '2026-07-20T00:00:00.000Z'
      }
    })
  })

  it('typed-excludes unsafe URLs and dead references as resource gaps', async () => {
    const adapter = createExternalUrlGroundingAdapter([
      externalUrl('source-unsafe', 'http://127.0.0.1/secret', 'body'),
      externalUrl('source-dead', 'https://example.com/missing', '')
    ], { maxBytes: 256, assertSafeUrl: safeUrl })

    const pack = await adapter.ground()

    expect(pack.status).toBe('unavailable')
    expect(isResourceGap(pack)).toBe(true)
    expect(pack.exclusions).toEqual(expect.arrayContaining([
      { sourceId: 'source-unsafe', relativePath: 'http://127.0.0.1/secret', code: 'unsafe_url' },
      { sourceId: 'source-dead', relativePath: 'https://example.com/missing', code: 'dead_reference' }
    ]))
    expect(pack.sources).toEqual([])
  })

  it('search adapter packages snippets as external_untrusted supplements', async () => {
    const snippet = 'Public search snippet about algebra.'
    const descriptors: ExternalSearchSnippetDescriptor[] = [{
      schemaVersion: 1,
      sourceId: 'search-algebra',
      url: 'https://example.com/algebra',
      snippet,
      title: 'Algebra',
      provider: 'web_search',
      retrievedAt: '2026-07-20T01:00:00.000Z'
    }]
    const pack = await createExternalSearchGroundingAdapter(descriptors, {
      maxBytes: 256,
      assertSafeUrl: safeUrl
    }).ground()

    expect(pack.sources).toHaveLength(1)
    expect(pack.sources[0]).toMatchObject({
      sourceId: 'search-algebra',
      trust: 'external_untrusted',
      priority: 'supplemental',
      digest: sha256(snippet),
      location: { kind: 'http_url', url: 'https://example.com/algebra' }
    })
  })

  it('turns adapter failures into explicit resource_gap exclusions', async () => {
    const failing: GroundingSourceAdapter = {
      kind: 'broken',
      ground: async () => {
        throw new Error('adapter failed')
      }
    }

    const pack = await groundWithAdapters([failing], { maxBytes: 64 })

    expect(isResourceGap(pack)).toBe(true)
    expect(pack.exclusions.some((item) => item.code === 'resource_gap')).toBe(true)
    expect(pack.sources).toEqual([])
  })

  it('multi-source grounder merges workspace and external packs deterministically', async () => {
    const content = 'Required workspace fact.'
    const root = await fixture({ 'resources/required.txt': content })
    const workspace = createWorkspaceResourceAdapter({
      workspaceRoot: root,
      trustedAuthorityId: AUTHORITY_ID,
      maxBytes: 512
    })
    const grounder = createMultiSourceResourceGrounder([
      {
        kind: 'workspace_resource',
        ground: async () => workspace.groundDescriptors([
          descriptor('source-required', 'resources/required.txt', content, { priority: 'required' })
        ])
      },
      createExternalUrlGroundingAdapter([
        externalUrl('source-external', 'https://example.com/extra', 'External only.', { priority: 'supplemental' })
      ], { maxBytes: 512, assertSafeUrl: safeUrl })
    ], { maxBytes: 512 })

    const first = await grounder.ground()
    const second = await grounder.ground()

    expect(first.identity).toBe(second.identity)
    expect(first.sources.map((source) => source.sourceId)).toEqual(['source-required', 'source-external'])
    expect(first.sources.map((source) => source.trust)).toEqual(['trusted_workspace', 'external_untrusted'])
  })

  it('keeps the classic ResourceGrounder.ground seam for trusted descriptors', async () => {
    const root = await fixture({ 'resources/valid.txt': 'valid' })
    const pack: GroundingPack = await createResourceGrounder({
      workspaceRoot: root,
      trustedAuthorityId: AUTHORITY_ID,
      maxBytes: 128
    }).ground([descriptor('source-valid', 'resources/valid.txt', 'valid')])

    expect(pack.sources[0]?.digest).toBe(sha256('valid'))
    expect(pack.exclusions).toEqual([])
  })
})

