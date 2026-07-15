import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const types = await readFile(resolve(root, 'src/shared/teaching-types/lesson-interaction.ts'), 'utf8')
const bridge = await readFile(resolve(root, 'src/shared/preview-markdown-bridge.ts'), 'utf8')
const renderer = await readFile(resolve(root, 'src/renderer/src/markdown-preview.tsx'), 'utf8')

for (const kind of [
  'lesson_opened', 'lesson_completed', 'retrieval_response_submitted', 'quiz_answered',
  'flashcard_rated', 'learner_response_recorded', 'conversation_evidence_recorded'
]) {
  assert.match(types, new RegExp(`kind: '${kind}'`), `missing discriminated interaction ${kind}`)
}
for (const field of ['eventId', 'workspaceId', 'courseId', 'sessionId', 'lessonId', 'itemId', 'attempt', 'observedAt', 'artifactDigest']) {
  assert.match(types, new RegExp(`\\b${field}:`), `missing evidence identity/provenance ${field}`)
}
assert.match(types, /type ConversationTurnProvenance[\s\S]*conversationId[\s\S]*turnId[\s\S]*author[\s\S]*turnCreatedAt/)
assert.doesNotMatch(types, /chainOfThought|rawChain|assistantReasoning/)
assert.match(bridge, /PREVIEW_LESSON_INTERACTION_MESSAGE/)
assert.match(bridge, /hasExactKeys\(value, \['source', 'type', 'interaction'\]\)/)
assert.match(bridge, /parseMarkdownLessonInteractionHref/)
assert.match(renderer, /parseMarkdownLessonInteractionHref\(href\)/)
assert.doesNotMatch(bridge, /workspaceId.*interaction|sessionId.*interaction|absolutePath/)

console.log('check:teaching-evidence-events passed')
