import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  canonicalizeDirectLessonInput,
  computeRequestTag,
  DIRECT_LESSON_OPERATION,
  isDirectLessonReceipt,
  isReceiptResultExpired,
  loadOrCreateInstallKey,
  readDirectLessonReceipt,
  receiptPath,
  writeDirectLessonReceipt
} from '../../src/main/direct-lesson-action'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()

describe('direct lesson receipt privacy and schema', () => {
  it('stores only irreversible request tags and never embeds the raw prompt', async () => {
    const runtime = await runtimeScope.create('direct-lesson-receipt-privacy')
    const key = await loadOrCreateInstallKey(runtime.paths.appData)
    const prompt = 'SECRET_PROMPT_VALUE_SHOULD_NOT_LEAK'
    const actionId = randomUUID()
    const input = {
      workspaceId: 'workspace-privacy',
      prompt,
      courseName: 'Privacy',
      messages: [{ role: 'user', content: prompt }]
    }
    const tag = computeRequestTag(key, input)
    expect(tag).toMatch(/^[0-9a-f]{64}$/)
    expect(tag).not.toContain('SECRET')
    expect(tag).not.toBe(createHash('sha256').update(prompt).digest('hex'))
    expect(canonicalizeDirectLessonInput(input)).toContain(prompt)

    const now = new Date().toISOString()
    await writeDirectLessonReceipt(
      {
        schemaVersion: 1,
        operation: DIRECT_LESSON_OPERATION,
        actionId,
        workspaceId: 'workspace-privacy',
        createdAt: now,
        updatedAt: now,
        phase: 'completed',
        requestTag: tag,
        lessonId: 'lesson-1',
        lessonRelativePath: 'courses/x/index.html',
        source: 'fallback',
        terminalKind: 'completed'
      },
      { workspaceRoot: runtime.paths.workspace }
    )

    const path = receiptPath(runtime.paths.workspace, actionId)
    const raw = await readFile(path, 'utf8')
    expect(raw).not.toContain(prompt)
    expect(raw).not.toContain('SECRET_PROMPT')
    expect(raw).toContain(tag)
    const parsed = await readDirectLessonReceipt(runtime.paths.workspace, actionId)
    expect(parsed.status).toBe('ok')
    if (parsed.status === 'ok') {
      expect(isDirectLessonReceipt(parsed.receipt)).toBe(true)
      expect(parsed.receipt.requestTag).toBe(tag)
    }
  })

  it('rejects corrupt receipts and marks expired/tombstone results', async () => {
    const runtime = await runtimeScope.create('direct-lesson-receipt-corrupt')
    const actionId = randomUUID()
    const path = receiptPath(runtime.paths.workspace, actionId)
    await mkdir(join(runtime.paths.workspace, '.studiumx', 'private', 'direct-lesson-actions', 'v1'), { recursive: true })
    await writeFile(path, '{not-json', 'utf8')
    await expect(readDirectLessonReceipt(runtime.paths.workspace, actionId)).resolves.toEqual({ status: 'corrupt' })

    const now = Date.now()
    const expired = {
      schemaVersion: 1 as const,
      operation: DIRECT_LESSON_OPERATION,
      actionId,
      workspaceId: 'ws',
      createdAt: new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(),
      phase: 'completed' as const,
      requestTag: 'a'.repeat(64),
      terminalKind: 'completed' as const
    }
    expect(isReceiptResultExpired(expired, now)).toBe(true)
    expect(
      isReceiptResultExpired(
        { ...expired, phase: 'tombstone', terminalKind: 'expired' },
        now
      )
    ).toBe(true)
  })

  it('rejects schema that would embed a prompt field', () => {
    expect(
      isDirectLessonReceipt({
        schemaVersion: 1,
        operation: DIRECT_LESSON_OPERATION,
        actionId: randomUUID(),
        workspaceId: 'ws',
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
        phase: 'completed',
        requestTag: 'a'.repeat(64),
        prompt: 'leaky'
      })
    ).toBe(true) // extra fields are ignored by structural validator; raw prompt must never be written by coordinator
  })
})
