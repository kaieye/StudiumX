import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [pet, dialog, styles, entry] = await Promise.all([
  readFile('src/renderer/src/views/pet/AppPet.tsx', 'utf8'),
  readFile('src/renderer/src/views/pet/PetAssistantDialog.tsx', 'utf8'),
  readFile('src/renderer/src/styles/pet-assistant.css', 'utf8'),
  readFile('src/renderer/src/styles.css', 'utf8')
])

assert.match(pet, /<PetAssistantDialog/, 'pet click should render the assistant dialog')
assert.match(pet, /setAssistantOpen\(true\)/, 'clicking the pet should open the assistant dialog')
assert.match(dialog, /agentChat\(prompt, \{ mode: 'temporary' \}\)/, 'dialog should reuse the temporary agent chat runtime')
assert.match(dialog, /cancelAgentChat/, 'dialog should allow canceling a streaming reply')
assert.match(dialog, /agentTurns\.map/, 'dialog should render shared conversation turns')
assert.match(dialog, /role="dialog"/, 'assistant surface should expose dialog semantics')
assert.match(styles, /\.pet-assistant-dialog/, 'assistant dialog should have dedicated styling')
assert.match(entry, /pet-assistant\.css/, 'assistant styles should be loaded by the renderer')

console.log('pet assistant dialog checks passed')
