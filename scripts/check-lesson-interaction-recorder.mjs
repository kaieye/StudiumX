import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const recorder = await readFile(resolve(root, 'src/main/lesson-interaction-recorder.ts'), 'utf8')
const types = await readFile(resolve(root, 'src/shared/teaching-types/lesson-interaction.ts'), 'utf8')

assert.match(recorder, /interface LessonInteractionRecorder\s*\{[\s\S]*record\(event: LessonInteraction\)[\s\S]*list\(sessionId: string\)/)
assert.match(recorder, /ledger\.append\(evidence\.sessionId/)
assert.match(recorder, /payload: \{ lessonInteraction: evidence \}/)
assert.match(recorder, /const duplicate = before\.events\.some/)
assert.match(recorder, /projectLegacyReviewProgressToLessonInteractions/)
assert.doesNotMatch(recorder, /learning-record|learning-outcome-committer|writeFile|appendFile|recordAttempt/)
assert.match(types, /export type EvidenceReceipt/)
assert.match(types, /export type PersistedLessonInteraction/)

console.log('check:lesson-interaction-recorder passed')
