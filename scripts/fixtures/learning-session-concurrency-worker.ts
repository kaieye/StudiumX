import { access, readFile, writeFile } from 'node:fs/promises'

import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'

type WorkerRequest = {
  workspaceRoot: string
  operation: 'append' | 'open' | 'complete' | 'load' | 'scan'
  input: Record<string, unknown>
  readyPath?: string
  releasePath?: string
  holdPoint?: string
  writerLockStaleMs?: number
  writerLockWaitMs?: number
  crashPoint?: string
}

const request = JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64url').toString('utf8')) as WorkerRequest

const ledger = createLearningSessionLedger({
  workspaceRoot: request.workspaceRoot,
  writerLockStaleMs: request.writerLockStaleMs,
  writerLockWaitMs: request.writerLockWaitMs,
  testingFaults: {
    inject: async (point: string) => {
      if (point === request.crashPoint) process.exit(86)
      if (point !== request.holdPoint) return
      if (request.readyPath) await writeFile(request.readyPath, point, 'utf8')
      if (request.releasePath) await waitForFile(request.releasePath)
    }
  }
} as never)

try {
  let result: unknown
  if (request.operation === 'append') {
    result = await ledger.append(String(request.input.sessionId), request.input.event as never)
  } else if (request.operation === 'open') {
    result = await ledger.open(request.input as never)
  } else if (request.operation === 'complete') {
    result = await ledger.complete(String(request.input.sessionId), request.input.outcomeRef as never)
  } else if (request.operation === 'load') {
    result = await ledger.load(String(request.input.sessionId))
  } else {
    result = await (ledger as never as { scan(input?: unknown): Promise<unknown> }).scan(request.input)
  }
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`)
} catch (error) {
  const value = error as Error & { code?: string; writerOwner?: unknown; diagnostic?: unknown }
  process.stdout.write(`${JSON.stringify({
    ok: false,
    error: {
      name: value.name,
      message: value.message,
      code: value.code,
      writerOwner: value.writerOwner,
      diagnostic: value.diagnostic
    }
  })}\n`)
  process.exitCode = 2
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error(`Timed out waiting for release file: ${path}`)
}
