import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Logger } from '../../src/main/logger'

let tempRoot = ''
const systemWarn = console.warn
const systemError = console.error

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-diagnostic-journal-'))
  const oldStudiumLog = join(tempRoot, 'studiumx-old.log')
  const unrelatedLog = join(tempRoot, 'other-old.log')
  const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
  await Promise.all([
    writeFile(oldStudiumLog, 'old StudiumX journal\n'),
    writeFile(unrelatedLog, 'unrelated journal\n')
  ])
  await Promise.all([
    utimes(oldStudiumLog, oldDate, oldDate),
    utimes(unrelatedLog, oldDate, oldDate)
  ])

  const observedConsole: Array<{ level: 'warn' | 'error'; args: unknown[] }> = []
  const warnSink = (...args: unknown[]) => observedConsole.push({ level: 'warn', args })
  const errorSink = (...args: unknown[]) => observedConsole.push({ level: 'error', args })
  console.warn = warnSink
  console.error = errorSink

  const journal = new Logger({ userDataPath: tempRoot, enabled: true, retentionDays: 999 })
  await journal.purgeOldLogs(7)
  await assert.rejects(access(oldStudiumLog), /ENOENT/)
  await access(unrelatedLog)

  journal.captureConsole()
  console.warn('captured warning', { source: 'fixture' })
  console.error(new Error('captured failure'))
  journal.info(`long diagnostic ${'x'.repeat(48)} tail-marker`)

  // Shutdown restores the original console functions and drains entries already queued.
  await journal.shutdown()
  assert.equal(console.warn, warnSink)
  assert.equal(console.error, errorSink)
  assert.deepEqual(
    observedConsole.map(({ level }) => level),
    ['warn', 'error'],
    'capture must preserve normal console output'
  )

  const journalText = await readFile(journal.path, 'utf8')
  assert.match(journalText, /\[warn\] captured warning {"source":"fixture"}/)
  assert.match(journalText, /\[error\] Error: captured failure/)
  assert.match(journalText, /tail-marker/)
  assert.match(await journal.readTail(20), /tail-marker\n$/)

  // Both direct writes and console calls after shutdown stay out of the closed journal.
  journal.error('after-shutdown-direct')
  console.warn('after-shutdown-console')
  await journal.shutdown()
  const closedJournalText = await readFile(journal.path, 'utf8')
  assert.doesNotMatch(closedJournalText, /after-shutdown-(direct|console)/)
  assert.equal(observedConsole.length, 3, 'restored console should still call its prior sink')

  console.log('diagnostic journal ok')
} finally {
  console.warn = systemWarn
  console.error = systemError
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
