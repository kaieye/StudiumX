import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [petSource, styleSource, zhSource, enSource] = await Promise.all([
  readFile('src/renderer/src/views/pet/AppPet.tsx', 'utf8'),
  readFile('src/renderer/src/styles/pet-context-menu.css', 'utf8'),
  readFile('src/renderer/src/i18n/locales/zh-CN.json', 'utf8'),
  readFile('src/renderer/src/i18n/locales/en-US.json', 'utf8')
])

const zh = JSON.parse(zhSource)
const en = JSON.parse(enSource)

assert.match(
  petSource,
  /onContextMenu=\{handleContextMenu\}/,
  'right-clicking the floating pet should open its custom context menu'
)
assert.match(petSource, /role="menu"/, 'the pet context menu should expose an accessible menu role')
assert.match(petSource, /role="menuitem"/, 'the close action should expose an accessible menu item role')
assert.match(petSource, /aria-haspopup="menu"/, 'the pet should announce that it opens a menu')
assert.match(
  petSource,
  /updateSettings\(\{ pet: \{ enabled: false \} \}\)/,
  'the close action should disable the floating pet through persisted settings'
)
assert.match(
  petSource,
  /addEventListener\('keydown', handleKeyDown\)/,
  'the context menu should close when Escape is pressed'
)
assert.match(
  petSource,
  /menuRef\.current\?\.contains\(event\.target as Node\)/,
  'clicking outside the menu should dismiss it without swallowing menu clicks'
)
assert.match(styleSource, /\.app-pet-context-menu\s*\{/, 'the pet context menu should have dedicated styling')
assert.match(styleSource, /position:\s*fixed/, 'the context menu should be positioned relative to the viewport')
assert.match(styleSource, /pointer-events:\s*auto/, 'the context menu should remain interactive')
assert.equal(zh.resources.pets.close, '关闭宠物', 'the Chinese menu item should say 关闭宠物')
assert.equal(en.resources.pets.close, 'Close pet', 'the English menu item should say Close pet')
assert.match(zh.resources.pets.overlayAria, /右键可关闭/, 'the Chinese accessible hint should explain the right-click action')
assert.match(en.resources.pets.overlayAria, /right-click to close/, 'the English accessible hint should explain the right-click action')

console.log('check:pet-context-menu passed')
