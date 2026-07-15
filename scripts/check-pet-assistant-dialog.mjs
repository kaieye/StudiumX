import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [pet, dialog, model, styles, entry, enText, zhText, unitTest] = await Promise.all([
  readFile('src/renderer/src/views/pet/AppPet.tsx', 'utf8'),
  readFile('src/renderer/src/views/pet/PetAssistantDialog.tsx', 'utf8'),
  readFile('src/renderer/src/views/pet/pet-assistant-dialog-model.ts', 'utf8'),
  readFile('src/renderer/src/styles/pet-assistant.css', 'utf8'),
  readFile('src/renderer/src/styles.css', 'utf8'),
  readFile('src/renderer/src/i18n/locales/en-US.json', 'utf8'),
  readFile('src/renderer/src/i18n/locales/zh-CN.json', 'utf8'),
  readFile('tests/unit/pet-assistant-dialog.unit.test.tsx', 'utf8')
])

const en = JSON.parse(enText)
const zh = JSON.parse(zhText)
const requiredAssistantPaths = [
  'title', 'emptyTitle', 'status.thinking', 'status.replying',
  'actions.newConversation', 'actions.close', 'actions.stop', 'actions.send',
  'actions.addTodo', 'actions.resetWindow',
  'suggestions.todo', 'suggestions.focus', 'suggestions.breakdown',
  'interruptions.toolPermission', 'interruptions.question',
  'composer.placeholder', 'composer.workspaceRequired', 'composer.ariaLabel',
  'announcements.started', 'announcements.question', 'announcements.permission',
  'announcements.completed', 'announcements.failed', 'announcements.canceled'
]

function valueAt(root, path) {
  return path.split('.').reduce((value, key) => value?.[key], root)
}

for (const [locale, resources] of [['en-US', en], ['zh-CN', zh]]) {
  const assistant = resources?.resources?.pets?.assistant
  for (const path of requiredAssistantPaths) {
    assert.equal(typeof valueAt(assistant, path), 'string', `${locale} is missing resources.pets.assistant.${path}`)
  }
}

assert.match(pet, /<PetAssistantDialog/, 'pet click should render the assistant dialog')
assert.match(pet, /setAssistantOpen\(true\)/, 'clicking the pet should open the assistant dialog')
assert.match(dialog, /useTranslation\(\)/, 'dialog copy should come from the active locale')
assert.doesNotMatch(dialog, /学习搭档|正在思考|新建对话|现在想推进什么|需要确认工具权限|输入消息|停止回复/, 'dialog should not retain product-copy literals')
assert.match(dialog, /agentChat\([^\n]+\{ mode: 'temporary' \}\)/, 'dialog should reuse the temporary agent chat runtime')
assert.match(dialog, /projectPetAssistantConversation/, 'dialog should project one coherent conversation snapshot')
assert.match(model, /source: 'empty' \| 'pending' \| 'saved'/, 'conversation projection should expose explicit domain states')
assert.match(model, /projectPetAssistantAnnouncement/, 'announcement policy should be a pure projection')
assert.match(dialog, /className="pet-assistant-live-region"[\s\S]*role="status"[\s\S]*aria-atomic="true"/, 'assistant should expose one atomic status region')
assert.doesNotMatch(dialog, /pet-assistant-thread" aria-live=/, 'streaming message thread must not be a live region')
assert.match(dialog, /data-announcement-key=\{announcement\?\.key\}/, 'announcement output should expose its stable identity')
assert.match(dialog, /cancelAgentChat/, 'dialog should allow canceling a streaming reply')
assert.match(dialog, /onClose\(\{ restoreFocus: false \}\)/, 'full conversation navigation should not restore mascot focus')
assert.match(dialog, /removeItem\(PET_ASSISTANT_GEOMETRY_STORAGE_KEY\)/, 'keyboard reset should clear persisted geometry')
assert.match(dialog, /releasePointerCapture/, 'unmount should release active pointer capture')
assert.match(dialog, /cancelAnimationFrame/, 'unmount should cancel pending focus frames')
assert.match(dialog, /role="dialog"/, 'assistant surface should expose dialog semantics')
assert.match(dialog, /aria-modal="false"/, 'assistant should remain modeless')
assert.match(styles, /@media \(max-height: 300px\)/, 'tiny viewports should retain compact composer geometry')
assert.match(styles, /\.pet-assistant-live-region/, 'assistant live region should use visually hidden styling')
assert.match(entry, /pet-assistant\.css/, 'assistant styles should be loaded by the renderer')
assert.match(unitTest, /\['en-US', 'What would you like to move forward now\?'/, 'component tests should exercise English copy')
assert.match(unitTest, /without replaying streamed tokens/, 'component tests should guard streaming announcements')
assert.match(unitTest, /keyCode: 229/, 'component tests should preserve IME behavior')
assert.match(unitTest, /innerWidth[\s\S]*180/, 'component tests should cover a 180px-wide viewport')

console.log('pet assistant dialog checks passed')
