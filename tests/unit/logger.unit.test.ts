import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

import { Logger, parseLoggerLine } from '../../src/main/logger'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()
const loggers: Logger[] = []

afterEach(async () => {
  await Promise.all(loggers.splice(0).map((logger) => logger.shutdown()))
})

async function createLogger(label: string): Promise<Logger> {
  const runtime = await runtimeScope.create(label)
  const logger = new Logger({ userDataPath: runtime.paths.userData, enabled: true, retentionDays: 7 })
  loggers.push(logger)
  return logger
}

describe('Logger', () => {
  it('keeps legacy text lines readable and emits deterministic safe tagged context', async () => {
    const logger = await createLogger('logger-format')
    const traceId = '123e4567-e89b-42d3-a456-426614174000'

    logger.info('legacy archive message')
    logger.child({ component: 'main', tag: 'agent-archive', traceId }).info('archive persisted')
    logger.child({ component: 'main', tag: 'memory-catalog', traceId }).info('Memory updated.')
    logger.child({ component: 'main', tag: 'learning-session-ledger', traceId }).info('Learning Session event persisted.')

    const lines = (await logger.readTail()).trim().split('\n')
    expect(lines).toHaveLength(4)
    expect(parseLoggerLine(lines[0]!)).toMatchObject({ level: 'info', message: 'legacy archive message' })
    expect(parseLoggerLine(lines[1]!)).toEqual(expect.objectContaining({
      level: 'info',
      component: 'main',
      tag: 'agent-archive',
      traceId,
      message: 'archive persisted'
    }))
    expect(parseLoggerLine(lines[2]!)).toEqual(expect.objectContaining({
      level: 'info',
      component: 'main',
      tag: 'memory-catalog',
      traceId,
      message: 'Memory updated.'
    }))
    expect(parseLoggerLine(lines[3]!)).toEqual(expect.objectContaining({
      level: 'info',
      component: 'main',
      tag: 'learning-session-ledger',
      traceId,
      message: 'Learning Session event persisted.'
    }))
    expect(parseLoggerLine('2026-07-18T00:00:00.000Z [info] [main] [agent-archive] [trace=not-a-uuid] body'))
      .toMatchObject({ message: '[trace=not-a-uuid] body', component: 'main', tag: 'agent-archive' })
  })

  it('redacts and bounds text while omitting arbitrary console objects', async () => {
    const logger = await createLogger('logger-safety')
    const providerToken = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345'
    const genericToken = 'C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e'
    const longPrompt = `prompt-${'x'.repeat(3_000)}`
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    logger.info(`Authorization: Bearer ${providerToken}; credential ${genericToken}; ${longPrompt}`)
    logger.captureConsole()
    console.warn(`Authorization: Bearer ${providerToken}`, { providerPayload: providerToken, prompt: longPrompt })

    const content = await logger.readTail(20_000)
    expect(content).not.toContain(providerToken)
    expect(content).not.toContain(genericToken)
    expect(content).not.toContain(longPrompt)
    expect(content).toContain('[redacted]')
    expect(content).toContain('[console value omitted]')
    expect(content).not.toContain('providerPayload')
    expect(content.split('\n').filter(Boolean).every((line) => line.length <= 2_100)).toBe(true)

    // captureConsole's original sink is a real leak boundary too: it receives
    // one bounded, redacted text value rather than the raw argument array.
    expect(warn).toHaveBeenCalledTimes(1)
    const replayedArgs = warn.mock.calls[0]!
    expect(replayedArgs).toHaveLength(1)
    expect(replayedArgs[0]).toEqual(expect.any(String))
    expect(replayedArgs[0]).not.toContain(providerToken)
    expect(replayedArgs[0]).not.toContain(genericToken)
    expect(replayedArgs[0]).not.toContain(longPrompt)
    expect(replayedArgs[0]).not.toContain('providerPayload')
    warn.mockRestore()
  })
})
