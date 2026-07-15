import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const recorder = await readFile(resolve(root, 'src/main/lesson-interaction-recorder.ts'), 'utf8')
const integration = await readFile(resolve(root, 'tests/integration/lesson-interaction-recorder.integration.test.ts'), 'utf8')

assert.match(recorder, /duplicate = before\.events\.some/)
assert.match(recorder, /eventId === evidence\.eventId/)
assert.match(recorder, /ledger\.append\(evidence\.sessionId/)
assert.match(integration, /replay/)
assert.match(integration, /duplicate: true/)
assert.match(integration, /attempt: 2/)
assert.match(integration, /createLearningSessionLedger\(\{ workspaceRoot \}\)/)

console.log('check:evidence-idempotency passed')
