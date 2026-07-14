import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAgentArtifacts } from '../../src/main/agent-artifact-lifecycle'
import { collectAgentArtifactProtectionSnapshot } from '../../src/main/agent-artifact-protection'
import { agentConversationSessionAuditRelativePathForMarkdown } from '../../src/shared/agent-conversation-catalog'

const createdRoots: string[] = []

async function createRoot(prefix = 'studiumx-artifact-protection-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  createdRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('agent artifact protection snapshot', () => {
  it('fails closed when a canonical conversation contains a malformed artifact reference', async () => {
    const rootPath = await createRoot()
    const artifact = await writeManagedArtifact(rootPath, 'conversation-invalid-ref', 'referenced output')
    await writeConversation(rootPath, 'conversation-invalid-ref', [{
      id: 'turn-1',
      role: 'assistant',
      content: '[Tool result archived]',
      createdAt: '2026-07-14T00:00:00.000Z',
      metadata: {
        version: 1,
        toolResults: [{
          toolCallId: 'tool-1',
          toolName: 'read_file',
          bytes: artifact.bytes,
          lines: 1,
          archive: { ...artifact, sha256: 'broken-digest' }
        }]
      }
    }])

    const result = await cleanupWithProtection(rootPath)

    expect(result.totals.scannedEntries).toBe(1)
    expect(result.totals.deletedEntries).toBe(0)
    expect(result.actions).toEqual([])
    expect(result.issues.some((issue) => issue.code === 'protection_refresh_failed')).toBe(true)
    await expect(readFile(join(rootPath, artifact.relativePath), 'utf8')).resolves.toBe('referenced output')
  })

  it('fails closed when a conversation audit contains a malformed artifact reference', async () => {
    const rootPath = await createRoot()
    const conversationId = 'conversation-invalid-audit'
    const artifact = await writeManagedArtifact(rootPath, conversationId, 'audit referenced output')
    const conversationRelativePath = await writeConversation(rootPath, conversationId, [])
    const auditPath = join(rootPath, agentConversationSessionAuditRelativePathForMarkdown(conversationRelativePath))
    await mkdir(dirname(auditPath), { recursive: true })
    await writeFile(auditPath, `${JSON.stringify({
      type: 'tool_result',
      id: 'audit-1',
      archive: { ...artifact, sha256: 'broken-digest' }
    })}\n`, 'utf8')

    const result = await cleanupWithProtection(rootPath)

    expect(result.totals.deletedEntries).toBe(0)
    expect(result.issues.some((issue) => issue.code === 'protection_refresh_failed')).toBe(true)
    await expect(readFile(join(rootPath, artifact.relativePath), 'utf8')).resolves.toBe('audit referenced output')
  })

  it('rejects oversized or symlinked canonical conversation records before parsing them', async () => {
    const oversizedRoot = await createRoot()
    const oversizedRecordPath = join(oversizedRoot, 'conversations', 'conversation-oversized-record.json')
    await mkdir(dirname(oversizedRecordPath), { recursive: true })
    await writeFile(oversizedRecordPath, Buffer.alloc(16 * 1024 * 1024 + 1, 0x20))

    await expect(collectAgentArtifactProtectionSnapshot(oversizedRoot)).rejects.toThrow(/size limit/i)

    const symlinkRoot = await createRoot()
    const externalRoot = await createRoot('studiumx-artifact-protection-external-record-')
    const externalRecordPath = join(externalRoot, 'outside.json')
    await writeFile(externalRecordPath, '{"turns":[]}\n', 'utf8')
    const symlinkRecordPath = join(symlinkRoot, 'conversations', 'conversation-symlink-record.json')
    await mkdir(dirname(symlinkRecordPath), { recursive: true })
    try {
      await symlink(externalRecordPath, symlinkRecordPath, 'file')
    } catch (error) {
      if (isErrnoException(error, 'EPERM')) return
      throw error
    }

    await expect(collectAgentArtifactProtectionSnapshot(symlinkRoot)).rejects.toThrow(/regular file/i)
  })

  it('rejects oversized or symlinked conversation audits before parsing them', async () => {
    const oversizedRoot = await createRoot()
    const conversationRelativePath = await writeConversation(oversizedRoot, 'conversation-oversized-audit', [])
    const oversizedAuditPath = join(
      oversizedRoot,
      agentConversationSessionAuditRelativePathForMarkdown(conversationRelativePath)
    )
    await mkdir(dirname(oversizedAuditPath), { recursive: true })
    await writeFile(oversizedAuditPath, Buffer.alloc(8 * 1024 * 1024 + 1, 0x20))

    await expect(collectAgentArtifactProtectionSnapshot(oversizedRoot)).rejects.toThrow(/size limit/i)

    const symlinkRoot = await createRoot()
    const symlinkConversationPath = await writeConversation(symlinkRoot, 'conversation-symlink-audit', [])
    const symlinkAuditPath = join(
      symlinkRoot,
      agentConversationSessionAuditRelativePathForMarkdown(symlinkConversationPath)
    )
    const externalRoot = await createRoot('studiumx-artifact-protection-external-')
    const externalAuditPath = join(externalRoot, 'outside.jsonl')
    await writeFile(externalAuditPath, '{"type":"session"}\n', 'utf8')
    await mkdir(dirname(symlinkAuditPath), { recursive: true })
    try {
      await symlink(externalAuditPath, symlinkAuditPath, 'file')
    } catch (error) {
      if (isErrnoException(error, 'EPERM')) return
      throw error
    }

    await expect(collectAgentArtifactProtectionSnapshot(symlinkRoot)).rejects.toThrow(/regular file|storage root/i)
  })
})

async function cleanupWithProtection(rootPath: string) {
  return cleanupAgentArtifacts({
    storageRoot: rootPath,
    dryRun: false,
    now: '2026-07-14T12:00:00.000Z',
    policy: {
      retentionDays: 0,
      gracePeriodHours: 0,
      maxTotalBytes: 1
    },
    resolveProtectionSnapshot: () => collectAgentArtifactProtectionSnapshot(rootPath)
  })
}

async function writeConversation(rootPath: string, id: string, turns: unknown[]): Promise<string> {
  const relativePath = `conversations/${id}.md`
  const jsonPath = join(rootPath, 'conversations', `${id}.json`)
  await mkdir(dirname(jsonPath), { recursive: true })
  await writeFile(jsonPath, `${JSON.stringify({
    schemaVersion: 1,
    id,
    workspaceId: 'workspace-1',
    title: id,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    relativePath,
    turns
  })}\n`, 'utf8')
  return relativePath
}

async function writeManagedArtifact(rootPath: string, conversationId: string, content: string) {
  const sha256 = createHash('sha256').update(content).digest('hex')
  const relativePath = `conversations/.agent-sessions/${conversationId}/tool-results/${sha256}.txt`
  const targetPath = join(rootPath, relativePath)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content, 'utf8')
  await utimes(targetPath, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'))
  return {
    kind: 'tool_result' as const,
    relativePath,
    sha256,
    bytes: Buffer.byteLength(content, 'utf8'),
    archivedAt: '2026-01-01T00:00:00.000Z'
  }
}

function isErrnoException(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}
