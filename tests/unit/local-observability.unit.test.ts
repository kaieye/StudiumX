import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  CRASH_MARKER_FILE_NAME,
  CRASH_MARKER_SCHEMA_VERSION,
  CRASH_MARKER_SUBDIR,
  LOCAL_CRASH_MARKER_BOOTSTRAP_RESIDUAL,
  REDACTED_ABSOLUTE_PATH,
  buildCrashMarker,
  createCrashMarkerStore,
  createTurnContext,
  formatTurnId,
  isToolSpanId,
  isTurnId,
  parseCrashMarker,
  redactExportString,
  redactPath,
  redactSecrets,
  toProcessCrashMarkerFacts,
  collectProcessCrashMarkerFacts
} from '../../src/main/observability'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-local-observability-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('turn context correlation ids', () => {
  it('creates stable turn / tool span id formats', () => {
    const ctx = createTurnContext({
      runId: 'run_demo',
      streamId: 'stream_1',
      entropy: 'abcdef0123456789'
    })

    expect(ctx.runId).toBe('run_demo')
    expect(ctx.streamId).toBe('stream_1')
    expect(ctx.turnId).toBe('turn_abcdef012345')
    expect(isTurnId(ctx.turnId)).toBe(true)

    const span1 = ctx.nextToolSpanId()
    const span2 = ctx.nextToolSpanId()
    expect(span1).toBe('tool_abcdef01_0001')
    expect(span2).toBe('tool_abcdef01_0002')
    expect(isToolSpanId(span1)).toBe(true)
    expect(isToolSpanId(span2)).toBe(true)

    const child = ctx.child('read_workspace_file')
    expect(child.toolSpanId).toBe('tool_abcdef01_0003')
    expect(child.toolName).toBe('read_workspace_file')
    expect(child.turnId).toBe(ctx.turnId)
    expect(child.runId).toBe('run_demo')

    expect(ctx.toCorrelation()).toEqual({
      runId: 'run_demo',
      streamId: 'stream_1',
      turnId: 'turn_abcdef012345'
    })
  })

  it('sanitizes unsafe runId / streamId and formats random turn ids', () => {
    const ctx = createTurnContext({
      runId: 'C:\\Users\\Alice\\secret',
      streamId: '  ',
      entropy: 'not-hex!!!!'
    })
    expect(ctx.runId).not.toMatch(/\\/)
    expect(ctx.streamId).toBeNull()
    expect(isTurnId(ctx.turnId)).toBe(true)
    expect(formatTurnId('deadbeefcafebabe')).toBe('turn_deadbeefcafe')
  })
})

describe('crash marker store', () => {
  it('writes, reads, and clears a marker under injectable appData', async () => {
    const appDataRoot = await tempRoot()
    const store = createCrashMarkerStore({ appDataRoot })

    expect(await store.read()).toBeNull()
    expect(await store.isPresent()).toBe(false)

    const written = await store.write({
      reasonCode: 'uncaught_exception',
      runId: 'run_xyz',
      now: () => '2026-07-21T01:02:03.000Z'
    })

    expect(written).toEqual({
      schemaVersion: CRASH_MARKER_SCHEMA_VERSION,
      writtenAt: '2026-07-21T01:02:03.000Z',
      reasonCode: 'uncaught_exception',
      runId: 'run_xyz'
    })

    const expectedPath = join(appDataRoot, CRASH_MARKER_SUBDIR, CRASH_MARKER_FILE_NAME)
    expect(store.markerPath).toBe(expectedPath)
    const raw = await readFile(expectedPath, 'utf8')
    expect(raw).not.toMatch(/api[_-]?key|secret|password|C:\\|\/Users\//i)

    const read = await store.read()
    expect(read).toEqual(written)
    expect(await store.isPresent()).toBe(true)

    await store.clear()
    expect(await store.read()).toBeNull()
    expect(await store.isPresent()).toBe(false)
  })

  it('fail-closed parses: rejects unknown fields, paths, and bad reason codes map to unknown', () => {
    expect(
      parseCrashMarker(
        JSON.stringify({
          schemaVersion: 1,
          writtenAt: '2026-07-21T00:00:00.000Z',
          reasonCode: 'manual_test'
        })
      )
    ).toMatchObject({ reasonCode: 'manual_test' })

    expect(
      parseCrashMarker(
        JSON.stringify({
          schemaVersion: 1,
          writtenAt: '2026-07-21T00:00:00.000Z',
          reasonCode: 'not_a_real_code'
        })
      )?.reasonCode
    ).toBe('unknown')

    expect(
      parseCrashMarker(
        JSON.stringify({
          schemaVersion: 1,
          writtenAt: '2026-07-21T00:00:00.000Z',
          reasonCode: 'uncaught_exception',
          absolutePath: 'C:\\Users\\Alice'
        })
      )
    ).toBeNull()

    expect(
      parseCrashMarker(
        JSON.stringify({
          schemaVersion: 1,
          writtenAt: 'C:\\Users\\Alice\\log',
          reasonCode: 'uncaught_exception'
        })
      )
    ).toBeNull()

    expect(buildCrashMarker({ reasonCode: 'unhandled_rejection' }).reasonCode).toBe(
      'unhandled_rejection'
    )
  })

  it('documents main-process hook as wired', () => {
    expect(LOCAL_CRASH_MARKER_BOOTSTRAP_RESIDUAL).toBe('main-process-hook-wired+product-ipc')
  })

  it('maps crash markers to TeachingDoctor processCrashMarker facts without paths/secrets', () => {
    expect(toProcessCrashMarkerFacts(null)).toEqual({ present: false })
    expect(toProcessCrashMarkerFacts(undefined)).toEqual({ present: false })

    const facts = toProcessCrashMarkerFacts({
      schemaVersion: CRASH_MARKER_SCHEMA_VERSION,
      writtenAt: '2026-07-20T07:55:00.000Z',
      reasonCode: 'uncaught_exception',
      runId: 'run_abc'
    })
    expect(facts).toEqual({
      present: true,
      writtenAt: '2026-07-20T07:55:00.000Z',
      reasonCode: 'uncaught_exception',
      runId: 'run_abc'
    })
    expect(JSON.stringify(facts)).not.toMatch(/C:\\|\/Users\/|api[_-]?key|secret/i)
  })

  it('collectProcessCrashMarkerFacts reads the store and maps fail-closed', async () => {
    const appDataRoot = await tempRoot()
    const store = createCrashMarkerStore({ appDataRoot })
    expect(await collectProcessCrashMarkerFacts(store)).toEqual({ present: false })

    await store.write({
      reasonCode: 'unhandled_rejection',
      runId: 'run_col',
      now: () => '2026-07-21T03:04:05.000Z'
    })
    expect(await collectProcessCrashMarkerFacts(store)).toEqual({
      present: true,
      writtenAt: '2026-07-21T03:04:05.000Z',
      reasonCode: 'unhandled_rejection',
      runId: 'run_col'
    })

    // store.read throws → absent
    const broken = {
      async read() {
        throw new Error('disk offline')
      }
    }
    expect(await collectProcessCrashMarkerFacts(broken)).toEqual({ present: false })
  })
})

describe('export redaction helpers (fail-closed)', () => {
  it('strips drive letters, home paths, and obvious secrets', () => {
    expect(redactPath('C:\\Users\\Alice\\Documents\\lesson.md')).toBe(REDACTED_ABSOLUTE_PATH)
    expect(redactPath('/Users/alice/project/lesson.md')).toBe(REDACTED_ABSOLUTE_PATH)
    expect(redactPath('/home/alice/.config/x')).toBe(REDACTED_ABSOLUTE_PATH)

    const workspace = 'C:\\Users\\Alice\\ws'
    expect(redactPath('C:\\Users\\Alice\\ws\\lessons\\a.md', workspace)).toBe('lessons/a.md')
    expect(redactPath('lessons/a.md', workspace)).toBe('lessons/a.md')

    const secretText = 'OPENAI_API_KEY=sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 Bearer tokensecretvalue12'
    const redacted = redactSecrets(secretText)
    expect(redacted).not.toMatch(/sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890/)
    expect(redacted).toMatch(/\[redacted\]/i)

    const mixed = redactExportString(
      'crash at C:\\Users\\Alice\\AppData\\Roaming\\StudiumX\\studiumx.log apiKey=super-secret-value-here-xyz',
      null
    )
    expect(mixed).toContain(REDACTED_ABSOLUTE_PATH)
    expect(mixed).not.toMatch(/super-secret-value-here-xyz/)
    expect(mixed).not.toMatch(/C:\\Users\\Alice/)
  })

  it('fail-closed on non-string / empty inputs', () => {
    expect(redactSecrets(null)).toBe('')
    expect(redactSecrets(42)).toBe('[redacted]')
    expect(redactPath(undefined)).toBe('')
    expect(redactPath({ path: '/Users/x' })).toBe(REDACTED_ABSOLUTE_PATH)
    expect(redactExportString(null)).toBe('')
  })
})
