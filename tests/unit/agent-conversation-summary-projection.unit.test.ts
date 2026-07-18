import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { findExplicitAgentConversationJsonRelativePath, readRawAgentConversationRecord } from '../../src/main/teaching-agent-conversations'
import {
  getContainedDurableDirectoryCapability,
  resolveContainedDurableReplaceAddonPath
} from '../../src/main/persistence/contained-durable-directory'
import {
  agentConversationSummaryProjectionRelativePath,
  projectAgentConversationSummaries,
  readAgentConversationSummaryProjectionStatus,
  mapWithConcurrency,
  AGENT_CONVERSATION_SUMMARY_PROJECTION_CONCURRENCY,
  MAX_AGENT_CONVERSATION_PROJECTION_JSON_BYTES,
  MAX_AGENT_CONVERSATION_PROJECTION_MARKDOWN_BYTES
} from '../../src/main/agent-conversation-summary-projection'

const roots: string[] = []
const archivedId = 'chat-20260718-000000-archived-projection'
const canonicalDirectory = 'conversation/2026/07'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('C-2C native capability and descriptor-relative security proof', () => {
  it('resolves packaged resources explicitly, resolves unpackaged builds from their app root, and reports Windows capability without loading', async () => {
    const root = await temporaryRoot()
    const moduleDirectory = join(root, 'out', 'main', 'persistence')
    await mkdir(moduleDirectory, { recursive: true })
    await writeFile(join(root, 'package.json'), '{\"name\":\"fixture\"}\n')

    expect(resolveContainedDurableReplaceAddonPath({
      resourcesPath: '/Applications/StudiumX.app/Contents/Resources',
      defaultApp: false,
      projectRoot: '/ignored-for-packaged-runtime'
    })).toBe(join('/Applications/StudiumX.app/Contents/Resources', 'native', 'contained_durable_replace.node'))
    expect(resolveContainedDurableReplaceAddonPath({
      resourcesPath: '/electron-dev/resources',
      defaultApp: true,
      projectRoot: root
    })).toBe(join(root, 'native', 'contained-durable-replace', 'build', 'Release', 'contained_durable_replace.node'))
    expect(resolveContainedDurableReplaceAddonPath({
      moduleUrl: pathToFileURL(join(moduleDirectory, 'contained-durable-directory.js')).href
    })).toBe(join(root, 'native', 'contained-durable-replace', 'build', 'Release', 'contained_durable_replace.node'))
    expect(getContainedDurableDirectoryCapability({
      platform: 'win32',
      resolver: { projectRoot: '/this-must-not-be-loaded-on-windows' }
    })).toEqual({ available: false, reason: 'unsupported_platform' })
  })

  it('retains descriptor-relative publication proof without adding a rename-boundary test hook', async () => {
    const source = await readFile(join(process.cwd(), 'native', 'contained-durable-replace', 'contained_durable_replace.cc'), 'utf8')
    expect(source).toContain('openat(')
    expect(source).toContain('renameat(')
    expect(source).toContain('O_NOFOLLOW')
    expect(source).toContain('fsync(parent_fd)')
    expect(source).not.toContain('onRenameBoundary')
    const loader = await readFile(join(process.cwd(), 'src', 'main', 'persistence', 'contained-durable-directory.ts'), 'utf8')
    expect(loader).not.toContain('const native = loadNativeContainedDurableReplace()')
  })
})

describe.runIf(process.platform !== 'win32')('agent conversation summary projections', () => {
  it('writes a private deterministic projection without changing canonical JSON, Markdown, audit, or ledger bytes/mtimes', async () => {
    const root = await temporaryRoot()
    const paths = await writeConversation(root, archivedId, {
      title: 'Archived access_token=TOP_SECRET_TITLE_VALUE',
      turns: [
        turn('user-1', 'user', 'USER_BODY_SECRET_DO_NOT_STORE'),
        turn('assistant-1', 'assistant', 'ASSISTANT_BODY_SECRET_DO_NOT_STORE')
      ]
    })
    const auditPath = join(root, canonicalDirectory, '.agent-sessions', `${archivedId}.jsonl`)
    const ledgerPath = join(root, '.studiumx', 'learning-work.jsonl')
    await mkdir(join(root, canonicalDirectory, '.agent-sessions'), { recursive: true })
    await mkdir(join(root, '.studiumx'), { recursive: true })
    await writeFile(auditPath, '{"audit":"AUDIT_SECRET_DO_NOT_STORE"}\n')
    await writeFile(ledgerPath, '{"ledger":"LEDGER_SECRET_DO_NOT_STORE"}\n')

    const immutable = await snapshot(paths.jsonPath, paths.markdownPath, auditPath, ledgerPath)
    await expect(projectAgentConversationSummaries({ rootPath: root, conversationIds: [archivedId] }))
      .resolves.toEqual([{ conversationId: archivedId, status: 'generated' }])
    await expect(snapshot(paths.jsonPath, paths.markdownPath, auditPath, ledgerPath)).resolves.toEqual(immutable)

    const projectionPath = join(root, agentConversationSummaryProjectionRelativePath(archivedId))
    const projectionText = await readFile(projectionPath, 'utf8')
    const projection = JSON.parse(projectionText) as Record<string, any>
    expect(projection.summary.title).toContain('[redacted]')
    expect(projection.summary.turnCounts).toEqual({ total: 2, user: 1, assistant: 1 })
    for (const secret of [
      'TOP_SECRET_TITLE_VALUE', 'USER_BODY_SECRET_DO_NOT_STORE', 'ASSISTANT_BODY_SECRET_DO_NOT_STORE',
      'AUDIT_SECRET_DO_NOT_STORE', 'LEDGER_SECRET_DO_NOT_STORE'
    ]) expect(projectionText).not.toContain(secret)
    expect((await stat(projectionPath)).mode & 0o777).toBe(0o600)
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId }))
      .resolves.toMatchObject({ conversationId: archivedId, status: 'current' })
  })

  it('uses a fixed safe fallback rather than a canonical reader title derived from a turn body', async () => {
    const root = await temporaryRoot()
    const id = 'chat-20260718-000001-empty-title'
    await writeConversation(root, id, {
      title: '',
      turns: [
        turn('user-1', 'user', 'TURN_BODY_MUST_NEVER_BECOME_A_TITLE'),
        turn('assistant-1', 'assistant', 'Assistant response')
      ]
    })

    await expect(projectAgentConversationSummaries({ rootPath: root, conversationIds: [id] }))
      .resolves.toEqual([{ conversationId: id, status: 'generated' }])
    const projectionText = await readFile(join(root, agentConversationSummaryProjectionRelativePath(id)), 'utf8')
    expect(JSON.parse(projectionText).summary.title).toBe('Untitled archived conversation')
    expect(projectionText).not.toContain('TURN_BODY_MUST_NEVER_BECOME_A_TITLE')
  })

  it('supports only the canonical flat and UTC monthly C-2B layouts for explicitly supplied ids', async () => {
    const root = await temporaryRoot()
    const flatId = 'chat-20260718-000002-flat-projection'
    await writeConversation(root, flatId, { directory: 'conversation' })
    await writeConversation(root, archivedId)

    await expect(projectAgentConversationSummaries({ rootPath: root, conversationIds: [flatId, archivedId] }))
      .resolves.toEqual([
        { conversationId: flatId, status: 'generated' },
        { conversationId: archivedId, status: 'generated' }
      ])
    const flat = JSON.parse(await readFile(join(root, agentConversationSummaryProjectionRelativePath(flatId)), 'utf8'))
    const monthly = JSON.parse(await readFile(join(root, agentConversationSummaryProjectionRelativePath(archivedId)), 'utf8'))
    expect(flat.source).toMatchObject({
      jsonRelativePath: `conversation/${flatId}.json`,
      markdownRelativePath: `conversation/${flatId}.md`
    })
    expect(monthly.source).toMatchObject({
      jsonRelativePath: `${canonicalDirectory}/${archivedId}.json`,
      markdownRelativePath: `${canonicalDirectory}/${archivedId}.md`
    })
  })

  it('rejects active, deleted, temporary, malformed-path, and symlinked canonical inputs', async () => {
    const root = await temporaryRoot()
    await writeConversation(root, 'chat-20260718-000003-active', { status: 'active' })
    await writeConversation(root, 'chat-20260718-000004-deleted', { status: 'deleted' })
    await writeConversation(root, 'chat-20260718-000005-temporary', { directory: 'conversations/2026/07', status: 'archived' })
    await writeConversation(root, 'chat-20260718-000006-invalid-path', { relativePath: 'notes/chat-20260718-000006-invalid-path.md' })
    const symlinked = await writeConversation(root, 'chat-20260718-000007-symlinked')
    await unlink(symlinked.markdownPath)
    const outside = join(root, 'outside.md')
    await writeFile(outside, '# outside\n')
    await symlink(outside, symlinked.markdownPath)

    const outcomes = await projectAgentConversationSummaries({
      rootPath: root,
      conversationIds: ['chat-20260718-000003-active', 'chat-20260718-000004-deleted', 'chat-20260718-000005-temporary', 'chat-20260718-000006-invalid-path', 'chat-20260718-000007-symlinked']
    })
    expect(outcomes).toEqual([
      { conversationId: 'chat-20260718-000003-active', status: 'ineligible', reason: 'not_archived' },
      { conversationId: 'chat-20260718-000004-deleted', status: 'ineligible', reason: 'deleted' },
      { conversationId: 'chat-20260718-000005-temporary', status: 'ineligible', reason: 'temporary' },
      { conversationId: 'chat-20260718-000006-invalid-path', status: 'rejected', reason: 'invalid_source' },
      { conversationId: 'chat-20260718-000007-symlinked', status: 'rejected', reason: 'invalid_source' }
    ])
    for (const id of outcomes.map((outcome) => outcome.conversationId)) {
      await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: id }))
        .resolves.toMatchObject({ status: 'missing' })
    }
  })

  it('treats same-size, mtime-restored JSON and Markdown source drift as stale', async () => {
    const root = await temporaryRoot()
    const paths = await writeConversation(root, archivedId)
    await projectAgentConversationSummaries({ rootPath: root, conversationIds: [archivedId] })

    const jsonBefore = await readFile(paths.jsonPath)
    const jsonTimes = await stat(paths.jsonPath)
    const jsonDrift = Buffer.from(jsonBefore.toString('utf8').replace('Archived conversation', 'Archived converzation'))
    expect(jsonDrift.byteLength).toBe(jsonBefore.byteLength)
    await writeFile(paths.jsonPath, jsonDrift)
    await utimes(paths.jsonPath, jsonTimes.atime, jsonTimes.mtime)
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId }))
      .resolves.toMatchObject({ status: 'stale' })

    await writeFile(paths.jsonPath, jsonBefore)
    await utimes(paths.jsonPath, jsonTimes.atime, jsonTimes.mtime)
    await projectAgentConversationSummaries({ rootPath: root, conversationIds: [archivedId] })

    const markdownBefore = await readFile(paths.markdownPath)
    const markdownTimes = await stat(paths.markdownPath)
    const markdownDrift = Buffer.from(markdownBefore.toString('utf8').replace('canonical markdown', 'canonical markd0wn'))
    expect(markdownDrift.byteLength).toBe(markdownBefore.byteLength)
    await writeFile(paths.markdownPath, markdownDrift)
    await utimes(paths.markdownPath, markdownTimes.atime, markdownTimes.mtime)
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId }))
      .resolves.toMatchObject({ status: 'stale' })
  })


  it('rejects .studiumx and projection-directory symlink or non-directory escapes without writing outside the root', async () => {
    const root = await temporaryRoot()
    await writeConversation(root, archivedId)
    const outside = await mkdtemp(join(tmpdir(), 'studiumx-projection-outside-'))
    roots.push(outside)
    const output = join(outside, 'conversation-projections')

    await symlink(outside, join(root, '.studiumx'))
    await expect(projectAgentConversationSummaries({ rootPath: root, conversationIds: [archivedId] }))
      .resolves.toEqual([{ conversationId: archivedId, status: 'rejected', reason: 'write_failed' }])
    await expect(stat(join(outside, 'conversation-projections', `${archivedId}.summary.json`))).rejects.toMatchObject({ code: 'ENOENT' })
    await unlink(join(root, '.studiumx'))
    await writeFile(join(root, '.studiumx'), 'not a directory')
    await expect(projectAgentConversationSummaries({ rootPath: root, conversationIds: [archivedId] }))
      .resolves.toEqual([{ conversationId: archivedId, status: 'rejected', reason: 'write_failed' }])
    await unlink(join(root, '.studiumx'))

    await mkdir(join(root, '.studiumx'))
    await symlink(outside, join(root, '.studiumx', 'conversation-projections'))
    await expect(projectAgentConversationSummaries({ rootPath: root, conversationIds: [archivedId] }))
      .resolves.toEqual([{ conversationId: archivedId, status: 'rejected', reason: 'write_failed' }])
    await expect(stat(join(outside, `${archivedId}.summary.json`))).rejects.toMatchObject({ code: 'ENOENT' })
    await unlink(join(root, '.studiumx', 'conversation-projections'))
    await writeFile(join(root, '.studiumx', 'conversation-projections'), 'not a directory')
    await expect(projectAgentConversationSummaries({ rootPath: root, conversationIds: [archivedId] }))
      .resolves.toEqual([{ conversationId: archivedId, status: 'rejected', reason: 'write_failed' }])
  })

  it('binds publication to the validated output-directory identity when a parent is swapped to a symlink before temp creation', async () => {
    const root = await temporaryRoot()
    await writeConversation(root, archivedId)
    const outside = await mkdtemp(join(tmpdir(), 'studiumx-projection-parent-swap-outside-'))
    roots.push(outside)
    const originalStudiumx = join(root, '.studiumx')
    const heldStudiumx = join(root, '.studiumx-held')
    const outsideProjection = join(outside, 'conversation-projections')

    await expect(projectAgentConversationSummaries(
      { rootPath: root, conversationIds: [archivedId] },
      {
        onOutputDirectoryBound: async () => {
          // This runs after the publisher has opened and retained the output
          // directory descriptor, but before it creates its private temp file.
          await rename(originalStudiumx, heldStudiumx)
          await symlink(outside, originalStudiumx)
        }
      }
    )).resolves.toEqual([{ conversationId: archivedId, status: 'generated' }])

    const filename = `${archivedId}.summary.json`
    await expect(readdir(outside)).resolves.toEqual([])
    await expect(readFile(join(outsideProjection, filename))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(heldStudiumx, 'conversation-projections', filename), 'utf8')).resolves.toContain('conversation-summary-v1')
  })

  it('bounds JSON and Markdown source reads before parsing or hashing', async () => {
    const root = await temporaryRoot()
    const jsonOversize = 'chat-20260718-000009-json-oversize'
    const markdownOversize = 'chat-20260718-000010-markdown-oversize'
    const json = await writeConversation(root, jsonOversize)
    await writeFile(json.jsonPath, Buffer.alloc(MAX_AGENT_CONVERSATION_PROJECTION_JSON_BYTES + 1, 0x20))
    await expect(projectAgentConversationSummaries({ rootPath: root, conversationIds: [jsonOversize] }))
      .resolves.toEqual([{ conversationId: jsonOversize, status: 'rejected', reason: 'invalid_source' }])

    const markdown = await writeConversation(root, markdownOversize)
    await writeFile(markdown.markdownPath, Buffer.alloc(MAX_AGENT_CONVERSATION_PROJECTION_MARKDOWN_BYTES + 1, 0x20))
    await expect(projectAgentConversationSummaries({ rootPath: root, conversationIds: [markdownOversize] }))
      .resolves.toEqual([{ conversationId: markdownOversize, status: 'rejected', reason: 'invalid_source' }])
  })

  it('uses no broad directory scan for explicit ids and limits 100-id work concurrency', async () => {
    const root = await temporaryRoot()
    await writeConversation(root, archivedId)
    let lookupCalls = 0
    await expect(findExplicitAgentConversationJsonRelativePath(root, archivedId, {
      lstat: async (path) => {
        lookupCalls += 1
        return stat(path)
      }
    })).resolves.toBe(`${canonicalDirectory}/${archivedId}.json`)
    // Four fixed bases × (flat + inferred month ± one) is a bounded lookup,
    // rather than a readdir-based workspace collection scan.
    expect(lookupCalls).toBeLessThanOrEqual(16)
    await expect(projectAgentConversationSummaries({ rootPath: root, conversationIds: [archivedId] }))
      .resolves.toEqual([{ conversationId: archivedId, status: 'generated' }])

    let active = 0
    let peak = 0
    const values = await mapWithConcurrency(Array.from({ length: 100 }, (_, index) => index), AGENT_CONVERSATION_SUMMARY_PROJECTION_CONCURRENCY, async (value) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return value
    })
    expect(values).toEqual(Array.from({ length: 100 }, (_, index) => index))
    expect(peak).toBeLessThanOrEqual(AGENT_CONVERSATION_SUMMARY_PROJECTION_CONCURRENCY)
  })

  it('fails closed for corrupt, hash-, path-, version-, and content-tampered projections, then regenerates', async () => {
    const root = await temporaryRoot()
    await writeConversation(root, archivedId)
    const projectionPath = join(root, agentConversationSummaryProjectionRelativePath(archivedId))
    const generate = () => projectAgentConversationSummaries({ rootPath: root, conversationIds: [archivedId] })
    await generate()

    await writeFile(projectionPath, '{bad json\n')
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'invalid' })
    // Projection validation is self-contained and never blocks canonical reads.
    await expect(readRawAgentConversationRecord(root, archivedId)).resolves.toMatchObject({ id: archivedId })
    await generate()

    const original = JSON.parse(await readFile(projectionPath, 'utf8')) as Record<string, any>
    await writeFile(projectionPath, JSON.stringify({ ...original, projectionVersion: 99 }))
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'invalid' })
    await generate()

    const pathTampered = JSON.parse(await readFile(projectionPath, 'utf8')) as Record<string, any>
    pathTampered.source.jsonRelativePath = 'conversation/2026/07/chat-20260718-000008-other.json'
    await writeFile(projectionPath, JSON.stringify(pathTampered))
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'invalid' })
    await generate()

    const hashTampered = JSON.parse(await readFile(projectionPath, 'utf8')) as Record<string, any>
    hashTampered.source.jsonSha256 = '0'.repeat(64)
    await writeFile(projectionPath, `${JSON.stringify(hashTampered, null, 2)}\n`)
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'stale' })
    await generate()

    const contentTampered = JSON.parse(await readFile(projectionPath, 'utf8')) as Record<string, any>
    contentTampered.summary.title = 'Tampered but redacted-safe title'
    await writeFile(projectionPath, `${JSON.stringify(contentTampered, null, 2)}\n`)
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'stale' })
    await generate()

    const unknownFieldTampered = JSON.parse(await readFile(projectionPath, 'utf8')) as Record<string, any>
    unknownFieldTampered.auditContent = 'AUDIT_CONTENT_MUST_NOT_BE_ACCEPTED'
    await writeFile(projectionPath, JSON.stringify(unknownFieldTampered))
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'invalid' })
    await generate()

    const canonical = await readFile(projectionPath, 'utf8')
    await writeFile(projectionPath, JSON.stringify(JSON.parse(canonical)))
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'invalid' })
    await generate()

    const duplicateTopLevel = (await readFile(projectionPath, 'utf8')).replace('  \"projectionVersion\": 1,', '  \"projectionVersion\": 1,\n  \"projectionVersion\": 1,')
    await writeFile(projectionPath, duplicateTopLevel)
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'invalid' })
    await generate()

    const duplicateNested = (await readFile(projectionPath, 'utf8')).replace('    \"title\":', '    \"title\": \"sentinel\",\n    \"title\":')
    await writeFile(projectionPath, duplicateNested)
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'invalid' })
    await generate()

    const sentinelDuplicate = (await readFile(projectionPath, 'utf8')).replace('\n}', ',\n  \"auditContent\": \"SENTINEL_A\",\n  \"auditContent\": \"SENTINEL_B\"\n}')
    await writeFile(projectionPath, sentinelDuplicate)
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'invalid' })

    await unlink(projectionPath)
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'missing' })
    await expect(generate()).resolves.toEqual([{ conversationId: archivedId, status: 'generated' }])
    await expect(readAgentConversationSummaryProjectionStatus({ rootPath: root, conversationId: archivedId })).resolves.toMatchObject({ status: 'current' })
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-conversation-projection-'))
  roots.push(root)
  return root
}

async function writeConversation(root: string, id: string, options: {
  directory?: string
  status?: 'active' | 'archived' | 'deleted'
  title?: string
  turns?: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>
  relativePath?: string
} = {}): Promise<{ jsonPath: string; markdownPath: string }> {
  const directory = options.directory ?? canonicalDirectory
  const relativePath = options.relativePath ?? `${directory}/${id}.md`
  const jsonPath = join(root, directory, `${id}.json`)
  const markdownPath = join(root, relativePath)
  await mkdir(join(root, directory), { recursive: true })
  if (relativePath !== `${directory}/${id}.md`) await mkdir(join(root, relativePath.split('/').slice(0, -1).join('/')), { recursive: true })
  const record = {
    id,
    workspaceId: 'workspace-1',
    title: options.title ?? 'Archived conversation',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:01:00.000Z',
    relativePath,
    messageCount: 2,
    branch: {
      schemaVersion: 1,
      sessionId: id,
      branchId: id,
      revision: 1,
      status: options.status ?? 'archived'
    },
    turns: options.turns ?? [
      turn('user-1', 'user', 'Question body'),
      turn('assistant-1', 'assistant', 'Answer body')
    ]
  }
  await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`)
  if (relativePath === `${directory}/${id}.md`) await writeFile(markdownPath, '# canonical markdown\n')
  return { jsonPath, markdownPath }
}

function turn(id: string, role: 'user' | 'assistant', content: string) {
  return { id, role, content, createdAt: '2026-07-18T00:00:00.000Z' }
}

async function snapshot(...paths: string[]): Promise<Array<{ bytes: Buffer; mtimeMs: number }>> {
  return Promise.all(paths.map(async (path) => ({ bytes: await readFile(path), mtimeMs: (await stat(path)).mtimeMs })))
}
