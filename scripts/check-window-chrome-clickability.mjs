import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

async function readReachableCss(entryPath, seen = new Set()) {
  if (seen.has(entryPath)) return ''
  seen.add(entryPath)
  const content = await readFile(entryPath, 'utf8')
  const imports = [...content.matchAll(/@import\s+(?:"([^"]+)"|'([^']+)');/g)]
    .map((match) => match[1] ?? match[2])
    .filter((target) => target.startsWith('.'))
  const importedCss = await Promise.all(
    imports.map((target) => readReachableCss(join(dirname(entryPath), target), seen))
  )
  return [content, ...importedCss].join('\n')
}

const css = await readReachableCss('src/renderer/src/styles.css')

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  assert.ok(match, `Missing CSS rule for ${selector}`)
  return match[1]
}

assert.match(
  css,
  /\.windows-window-chrome \{[\s\S]*-webkit-app-region: drag;/,
  'Windows frameless chrome should own the draggable titlebar region'
)

assert.match(
  css,
  /\.windows-window-chrome \.window-controls \{[\s\S]*-webkit-app-region: no-drag;/,
  'Windows window control buttons must remain clickable'
)

assert.match(
  css,
  /\.windows-window-chrome__left \{[\s\S]*-webkit-app-region: no-drag;/,
  'Windows sidebar toggle hit area must stay clickable'
)

assert.match(
  css,
  /\.windows-sidebar-toggle \{[\s\S]*-webkit-app-region: no-drag;/,
  'Windows sidebar toggle button must stay outside the drag region'
)

assert.match(
  css,
  /\.topbar \{[\s\S]*-webkit-app-region: drag;/,
  'Main page topbars should stay draggable on frameless Windows windows'
)

assert.doesNotMatch(
  cssRule('.app-shell.platform-win32 .topbar'),
  /-webkit-app-region:\s*no-drag;/,
  'Windows topbar overrides must not disable topbar dragging'
)

assert.match(
  css,
  /\.app-shell\.platform-win32 \.topbar::after \{[\s\S]*width: var\(--window-control-overlay-width\);[\s\S]*-webkit-app-region: no-drag;/,
  'Windows topbars should reserve a no-drag hit region below the window controls'
)

assert.match(
  css,
  /\.app-shell\.platform-win32\.is-sidebar-collapsed \.topbar::before \{[\s\S]*width: var\(--window-chrome-left-width\);[\s\S]*-webkit-app-region: no-drag;/,
  'Collapsed Windows topbars should reserve a no-drag hit region below the sidebar toggle'
)

assert.match(
  css,
  /\.app-shell\.platform-win32 \.sidebar \{[\s\S]*-webkit-app-region: no-drag;/,
  'Windows sidebar content should not drag the whole window'
)
