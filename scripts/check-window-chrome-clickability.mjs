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
  /\.app-shell\.platform-win32 \.topbar \{[\s\S]*-webkit-app-region: no-drag;/,
  'Main page topbars must not register a drag region under the Windows window controls'
)
