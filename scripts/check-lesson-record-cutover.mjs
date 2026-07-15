import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()

async function source(relativePath) {
  return readFile(join(root, relativePath), 'utf8')
}

const [
  generation,
  artifacts,
  placement,
  renderer,
  settingsType,
  settingsSchema,
  settingsWorkflow,
  settingsView
] = await Promise.all([
  source('src/main/teaching-lesson-generation.ts'),
  source('src/main/teaching-lesson-artifacts.ts'),
  source('src/shared/teaching-placement.ts'),
  source('src/main/ai/lesson-renderer.ts'),
  source('src/shared/teaching-types/settings.ts'),
  source('src/shared/teaching-settings-schema.ts'),
  source('src/renderer/src/workflows/teaching-workspace-configuration.ts'),
  source('src/renderer/src/views/settings/SettingsView.tsx')
])

assert.doesNotMatch(generation, /generateLearningRecord|includeLearningRecord|renderLearningRecordFromPlan/, 'Lesson generation must not opt into Learning-record publication.')
assert.doesNotMatch(artifacts, /renderLearningRecordFromPlan|includeLearningRecord|recordRelativePath|recordAbsolutePath|learning-records\//, 'Lesson artifact publication must not derive, render, or publish a Learning record.')
assert.doesNotMatch(placement, /includeLearningRecord|recordRelativePath/, 'Lesson artifact placement must not reserve Learning-record output paths.')
assert.doesNotMatch(renderer, /renderLearningRecordFromPlan/, 'The Lesson renderer must not expose a generation-time Learning-record renderer.')
for (const [name, text] of [
  ['settings type', settingsType],
  ['settings schema', settingsSchema],
  ['settings workflow', settingsWorkflow],
  ['settings view', settingsView]
]) {
  assert.doesNotMatch(text, /generateLearningRecord/, `${name} must not expose the retired auto-record setting.`)
}

console.log('lesson record cutover gate ok')
