import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  APPROVAL_RECEIPT_KIND,
  APPROVAL_RECEIPT_LEDGER_RELATIVE_PATH,
  APPROVAL_RECEIPT_SCHEMA_VERSION,
  appendApprovalReceipt,
  assertApprovalReceiptNotAuthorizationToken,
  buildRedactedArgsDigest,
  isApprovalReceiptReusableAuthorization,
  isForcedHumanMemoryApprovalTool,
  isHighRiskApprovalTool,
  parseApprovalReceiptLine,
  readApprovalReceipts,
  recordForcedHumanApprovalReceipt,
  redactArgsForDigest,
  shouldRecordForcedHumanApproval
} from '../../src/main/ai/tools/approval-receipt'
import type { ToolPermissionRequest } from '../../src/main/ai/tools/registry'
import { ToolRegistry, buildToolContext } from '../../src/main/ai/tools/registry'
import { createMemoryTools } from '../../src/main/ai/tools/memory-tools'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingMemoryRecord } from '../../src/shared/teaching-types'

const temps: string[] = []

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'approval-receipt-'))
  temps.push(dir)
  return dir
}

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

function memoryRequest(toolName: 'remember_teaching_memory' | 'forget_teaching_memory'): ToolPermissionRequest {
  return {
    id: 'call-mem-1',
    kind: 'workspace_write',
    toolName,
    operation: toolName,
    targetPath: toolName === 'remember_teaching_memory' ? 'memory://title' : 'memory://mem_1',
    creates: toolName === 'remember_teaching_memory'
  }
}

describe('approval durable receipts (DB-P0-4)', () => {
  it('writes append-only JSONL with required fields and redacted args digest', async () => {
    const root = await tempRoot()
    const sensitiveArgs = {
      title: '易混：导数',
      body: 'SECRET_BODY_SHOULD_NOT_APPEAR',
      apiKey: 'sk-live-secret',
      password: 'hunter2',
      scope: 'workspace'
    }

    const receipt = await appendApprovalReceipt({
      rootPath: root,
      decision: 'allow_once',
      tool: 'remember_teaching_memory',
      effect: 'workspace_write',
      traceId: 'run-abc-1',
      args: sensitiveArgs,
      toolCallId: 'call-1',
      operation: 'remember_teaching_memory',
      targetPath: 'memory://易混：导数',
      nowIso: () => '2026-07-21T12:00:00.000Z',
      receiptId: 'receipt-fixed-1'
    })

    expect(receipt).toMatchObject({
      schemaVersion: APPROVAL_RECEIPT_SCHEMA_VERSION,
      kind: APPROVAL_RECEIPT_KIND,
      receiptId: 'receipt-fixed-1',
      decision: 'allow_once',
      tool: 'remember_teaching_memory',
      effect: 'workspace_write',
      trace_id: 'run-abc-1',
      timestamp: '2026-07-21T12:00:00.000Z',
      reusableAuthorization: false,
      oneShot: true
    })
    expect(receipt.argsDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.argsDigest).toBe(buildRedactedArgsDigest(sensitiveArgs))

    const ledgerPath = join(root, APPROVAL_RECEIPT_LEDGER_RELATIVE_PATH)
    const raw = await readFile(ledgerPath, 'utf8')
    expect(raw).not.toContain('SECRET_BODY_SHOULD_NOT_APPEAR')
    expect(raw).not.toContain('sk-live-secret')
    expect(raw).not.toContain('hunter2')
    expect(raw).toContain('"argsDigest"')
    expect(raw).toContain('"trace_id":"run-abc-1"')

    const loaded = await readApprovalReceipts(root)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.receiptId).toBe('receipt-fixed-1')
    expect(loaded[0]?.argsDigest).toBe(receipt.argsDigest)
  })

  it('redacts sensitive keys to type/length digests, never full payloads', () => {
    const redacted = redactArgsForDigest({
      title: 'safe title',
      body: 'full secret body text',
      content: 'file content secret',
      apiKey: 'sk-abc',
      nested: { password: 'pw', note: 'ok' }
    }) as Record<string, unknown>

    expect(JSON.stringify(redacted)).not.toContain('full secret body text')
    expect(JSON.stringify(redacted)).not.toContain('file content secret')
    expect(JSON.stringify(redacted)).not.toContain('sk-abc')
    expect(JSON.stringify(redacted)).not.toContain('"pw"')
    expect(redacted.body).toMatchObject({ redacted: true, t: 'string' })
    expect(redacted.apiKey).toMatchObject({ redacted: true, t: 'string' })
    expect((redacted.nested as Record<string, unknown>).password).toMatchObject({ redacted: true })
    expect((redacted.nested as Record<string, unknown>).note).toMatchObject({ t: 'string', n: 2 })

    const digestA = buildRedactedArgsDigest({ body: 'aaa', title: 't' })
    const digestB = buildRedactedArgsDigest({ body: 'bbb', title: 't' })
    expect(digestA).not.toBe(digestB)
    expect(digestA).toBe(buildRedactedArgsDigest({ body: 'aaa', title: 't' }))
  })

  it('is durable: append-only across multiple decisions', async () => {
    const root = await tempRoot()
    await appendApprovalReceipt({
      rootPath: root,
      decision: 'allow_once',
      tool: 'write_workspace_file',
      traceId: 'trace-1',
      args: { path: 'a.md' },
      receiptId: 'r1'
    })
    await appendApprovalReceipt({
      rootPath: root,
      decision: 'deny',
      tool: 'forget_teaching_memory',
      traceId: 'trace-2',
      args: { memoryId: 'mem_1' },
      receiptId: 'r2'
    })

    const receipts = await readApprovalReceipts(root)
    expect(receipts.map((r) => r.receiptId)).toEqual(['r1', 'r2'])
    expect(receipts.map((r) => r.decision)).toEqual(['allow_once', 'deny'])

    const raw = await readFile(join(root, APPROVAL_RECEIPT_LEDGER_RELATIVE_PATH), 'utf8')
    const lines = raw.split(/\r?\n/).filter((line) => line.trim())
    expect(lines).toHaveLength(2)
    // Prior line bytes remain intact (append-only).
    expect(lines[0]).toContain('"receiptId":"r1"')
    expect(lines[1]).toContain('"receiptId":"r2"')
  })

  it('never treats receipts as reusable authorization tokens', async () => {
    const root = await tempRoot()
    const receipt = await appendApprovalReceipt({
      rootPath: root,
      decision: 'allow_for_run',
      tool: 'remember_teaching_memory',
      traceId: 'trace-auth-1',
      args: { title: 't', body: 'b' }
    })

    expect(receipt.reusableAuthorization).toBe(false)
    expect(receipt.oneShot).toBe(true)
    expect(isApprovalReceiptReusableAuthorization(receipt)).toBe(false)
    expect(isApprovalReceiptReusableAuthorization(null)).toBe(false)
    expect(() => assertApprovalReceiptNotAuthorizationToken(receipt)).not.toThrow()
    expect(() =>
      assertApprovalReceiptNotAuthorizationToken({ receiptId: receipt.receiptId, reusableAuthorization: true })
    ).toThrow(/reusableAuthorization must remain false|never be reusable authorization/)

    // Re-reading prior receipts must not become an allow path.
    const prior = await readApprovalReceipts(root)
    for (const item of prior) {
      expect(isApprovalReceiptReusableAuthorization(item)).toBe(false)
      expect(item.reusableAuthorization).toBe(false)
    }
  })

  it('classifies forced human memory + high-risk tools for receipt policy', () => {
    expect(isForcedHumanMemoryApprovalTool('remember_teaching_memory')).toBe(true)
    expect(isForcedHumanMemoryApprovalTool('forget_teaching_memory')).toBe(true)
    expect(isForcedHumanMemoryApprovalTool('write_workspace_file')).toBe(false)
    expect(isHighRiskApprovalTool('write_workspace_file')).toBe(true)
    expect(isHighRiskApprovalTool('memory_search')).toBe(false)
    expect(shouldRecordForcedHumanApproval(memoryRequest('remember_teaching_memory'))).toBe(true)
    expect(
      shouldRecordForcedHumanApproval({
        id: 'x',
        kind: 'workspace_read',
        toolName: 'memory_search',
        operation: 'search'
      })
    ).toBe(false)
  })

  it('recordForcedHumanApprovalReceipt writes only for high-risk human decisions', async () => {
    const root = await tempRoot()
    const written = await recordForcedHumanApprovalReceipt({
      rootPath: root,
      request: memoryRequest('forget_teaching_memory'),
      decision: { decision: 'deny', reason: 'user denied' },
      args: { memoryId: 'mem_9', secret: 'nope' },
      traceId: 'run-9',
      toolCallId: 'call-9'
    })
    expect(written?.decision).toBe('deny')
    expect(written?.tool).toBe('forget_teaching_memory')
    expect(JSON.stringify(written)).not.toContain('nope')

    const skipped = await recordForcedHumanApprovalReceipt({
      rootPath: root,
      request: {
        id: 'r',
        kind: 'workspace_read',
        toolName: 'memory_search',
        operation: 'search'
      },
      decision: { decision: 'allow_once' },
      traceId: 'run-skip'
    })
    expect(skipped).toBeNull()
    expect(await readApprovalReceipts(root)).toHaveLength(1)
  })

  it('parse rejects reusableAuthorization true and corrupt lines', () => {
    const ok = parseApprovalReceiptLine(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'approval_receipt',
        receiptId: 'r',
        decision: 'allow_once',
        tool: 'write_workspace_file',
        effect: 'workspace_write',
        trace_id: 't1',
        timestamp: '2026-07-21T00:00:00.000Z',
        argsDigest: 'a'.repeat(64),
        reusableAuthorization: false,
        oneShot: true
      })
    )
    expect(ok?.receiptId).toBe('r')

    expect(
      parseApprovalReceiptLine(
        JSON.stringify({
          schemaVersion: 1,
          kind: 'approval_receipt',
          receiptId: 'r',
          decision: 'allow_once',
          tool: 'write_workspace_file',
          effect: 'workspace_write',
          trace_id: 't1',
          timestamp: '2026-07-21T00:00:00.000Z',
          argsDigest: 'a'.repeat(64),
          reusableAuthorization: true,
          oneShot: true
        })
      )
    ).toBeNull()

    expect(parseApprovalReceiptLine('{not json')).toBeNull()
  })

  it('integrates with registry permission gate for synthetic memory tools', async () => {
    const root = await tempRoot()
    const created: TeachingMemoryRecord[] = []
    const store = {
      list: async () => created,
      create: async (payload: {
        content: string
        scope: 'user' | 'workspace' | 'project'
        tags?: string[]
      }) => {
        const next: TeachingMemoryRecord = {
          id: `mem_${created.length + 1}`,
          content: payload.content,
          scope: payload.scope,
          tags: payload.tags ?? [],
          confidence: 0.9,
          createdAt: '2026-07-21T00:00:00.000Z',
          updatedAt: '2026-07-21T00:00:00.000Z'
        }
        created.push(next)
        return next
      },
      delete: async () => undefined
    }

    const registry = new ToolRegistry()
    for (const tool of createMemoryTools({ memoryStore: store })) registry.register(tool)

    let permissionCalls = 0
    const settings = defaultSettings(root)
    settings.tools.approvalMode = 'full_access'
    const ctx = buildToolContext(settings, {
      workspaceRoot: root,
      runId: 'run-integration-1',
      requestToolPermission: async () => {
        permissionCalls += 1
        return { decision: 'allow_once' }
      }
    })

    const handlers = registry.handlerMap(ctx)
    const result = await handlers.remember_teaching_memory(
      {
        title: '易混',
        body: 'SECRET_SHOULD_NOT_LAND_IN_RECEIPT',
        scope: 'workspace'
      },
      { toolCallId: 'call-remember-1', toolName: 'remember_teaching_memory', runId: 'run-integration-1' }
    )
    const parsed = JSON.parse(result) as { ok?: boolean; id?: string }
    expect(parsed.ok).toBe(true)
    expect(permissionCalls).toBe(1)

    const receipts = await readApprovalReceipts(root)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      tool: 'remember_teaching_memory',
      decision: 'allow_once',
      effect: 'workspace_write',
      reusableAuthorization: false,
      oneShot: true
    })
    expect(receipts[0]?.trace_id).toBeTruthy()
    expect(receipts[0]?.argsDigest).toMatch(/^[a-f0-9]{64}$/)

    const raw = await readFile(join(root, APPROVAL_RECEIPT_LEDGER_RELATIVE_PATH), 'utf8')
    expect(raw).not.toContain('SECRET_SHOULD_NOT_LAND_IN_RECEIPT')

    // Prior receipt must not authorize a second call without a fresh human decision.
    const ctxNoChannel = buildToolContext(settings, {
      workspaceRoot: root,
      runId: 'run-integration-2'
      // no requestToolPermission and no prior run grants
    })
    const handlers2 = registry.handlerMap(ctxNoChannel)
    const denied = JSON.parse(
      await handlers2.remember_teaching_memory(
        { title: 'another', body: 'x' },
        { toolCallId: 'call-remember-2', toolName: 'remember_teaching_memory' }
      )
    ) as { permission?: { decision?: string } }
    expect(denied.permission?.decision).toBe('deny')
    // Still only one receipt — no silent reuse from prior file receipt.
    expect(await readApprovalReceipts(root)).toHaveLength(1)
  })
})
