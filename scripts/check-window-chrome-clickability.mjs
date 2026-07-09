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

const [app, main, css] = await Promise.all([
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/main/index.ts', 'utf8'),
  readReachableCss('src/renderer/src/styles.css')
])

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|[}\\n])\\s*(?:/\\*[\\s\\S]*?\\*/\\s*)?${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  assert.ok(match, `Missing CSS rule for ${selector}`)
  return match[1]
}

function assertAppRegion(selector, value, message) {
  const rule = cssRule(selector)
  assert.match(rule, new RegExp(`(^|\\n)\\s*app-region:\\s*${value};`), `${message} (modern app-region)`)
  assert.match(rule, new RegExp(`(^|\\n)\\s*-webkit-app-region:\\s*${value};`), `${message} (-webkit fallback)`)
}

const windowsVisualOptions = main.match(/if \(process\.platform === 'win32'\) \{\s*return \{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
assert.ok(windowsVisualOptions, 'Windows BrowserWindow visual options should be detectable')

assert.match(
  windowsVisualOptions,
  /titleBarStyle: 'hidden'[\s\S]*titleBarOverlay: buildWindowsTitleBarOverlay\(\)[\s\S]*backgroundMaterial: 'acrylic'/,
  'Windows BrowserWindow should use hidden transparent titlebar overlay mode like Zcode'
)

assert.doesNotMatch(
  windowsVisualOptions,
  /frame: false/,
  'Windows BrowserWindow should not use raw frame:false because it can break app-region dragging'
)

assert.match(
  css,
  /\.windows-window-chrome \{[\s\S]*app-region: drag;[\s\S]*-webkit-app-region: drag;/,
  'Windows frameless chrome should own the draggable titlebar region'
)

assert.match(
  css,
  /\.app-frame\.platform-win32 \{[\s\S]*--window-chrome-height: 48px;[\s\S]*--window-control-overlay-width: 138px;/,
  'Windows app frame should align chrome metrics with the native titlebar overlay'
)

assert.match(
  css,
  /\.windows-window-chrome \{[\s\S]*right: var\(--window-control-overlay-width\);[\s\S]*left: var\(--window-chrome-left-width\);[\s\S]*justify-content: flex-start;/,
  'Windows draggable chrome should leave the native titlebar overlay controls and sidebar toggle uncovered'
)

assertAppRegion('.windows-window-chrome .window-controls', 'no-drag', 'Windows window control buttons must remain clickable')

assert.doesNotMatch(
  app.match(/function WindowsWindowChrome\(\) \{[\s\S]*?\n\}/)?.[0] ?? '',
  /<WindowControlButtons \/>/,
  'Windows chrome should not render custom window control buttons over the native titlebar overlay'
)

assertAppRegion('.windows-sidebar-toggle-chrome', 'no-drag', 'Windows sidebar toggle chrome must stay outside every draggable parent')

assert.doesNotMatch(
  cssRule('.windows-sidebar-toggle-chrome'),
  /(?:^|\n)\s*(?:-webkit-)?app-region:\s*drag;/,
  'Windows sidebar toggle chrome must not be a drag region'
)

assertAppRegion('.windows-sidebar-toggle-chrome .windows-sidebar-toggle', 'no-drag', 'Windows sidebar toggle button must stay outside the drag region')

assert.match(
  css,
  /\.windows-sidebar-toggle-chrome \.windows-sidebar-toggle \* \{[\s\S]*pointer-events: none;[\s\S]*app-region: no-drag;[\s\S]*-webkit-app-region: no-drag;/,
  'Windows sidebar toggle icon must not intercept clicks inside the draggable chrome'
)

assertAppRegion('.topbar', 'drag', 'Main page topbars should stay draggable on frameless Windows windows')

assert.doesNotMatch(
  cssRule('.app-shell.platform-win32 .topbar'),
  /(?:^|\n)\s*(?:-webkit-)?app-region:\s*no-drag;/,
  'Windows topbar overrides must not disable topbar dragging'
)

assert.match(
  css,
  /\.app-shell\.platform-win32 \.topbar::after \{[\s\S]*width: var\(--window-control-overlay-width\);[\s\S]*app-region: no-drag;[\s\S]*-webkit-app-region: no-drag;/,
  'Windows topbars should reserve a no-drag hit region below the window controls'
)

assert.match(
  css,
  /\.app-shell\.platform-win32\.is-sidebar-collapsed \.topbar::before \{[\s\S]*width: var\(--window-chrome-left-width\);[\s\S]*app-region: no-drag;[\s\S]*-webkit-app-region: no-drag;/,
  'Collapsed Windows topbars should reserve a no-drag hit region below the sidebar toggle'
)

assert.match(
  app,
  /className=\{`windows-sidebar-drag-region\$\{sidebarCollapsed \? ' is-sidebar-collapsed' : ''\}`\}/,
  'Windows should render an explicit sidebar-top drag strip that tracks collapsed state'
)

assert.match(
  app,
  /\{isWindows && <WindowsSidebarToggleChrome \/>\}[\s\S]*\{isWindows && <WindowsWindowChrome \/>\}/,
  'Windows sidebar toggle should render as a separate no-drag layer before the draggable chrome'
)

assert.match(
  app,
  /function WindowsSidebarToggleChrome\(\) \{[\s\S]*const handlePointerDown = \(event: ReactPointerEvent<HTMLButtonElement>\): void => \{[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)[\s\S]*toggleSidebar\(\)[\s\S]*onPointerDown=\{handlePointerDown\}/,
  'Windows sidebar toggle should switch on pointerdown before draggable chrome can swallow click'
)

assert.match(
  css,
  /\.windows-sidebar-drag-region \{[\s\S]*position: absolute;[\s\S]*left: var\(--window-chrome-left-width\);[\s\S]*width: calc\(var\(--sidebar-width\) - var\(--window-chrome-left-width\)\);[\s\S]*height: calc\(var\(--window-chrome-height\) \+ 8px\);[\s\S]*app-region: drag;[\s\S]*-webkit-app-region: drag;/,
  'Windows sidebar top blank space should be an explicit draggable strip that does not sit under the sidebar toggle'
)

assert.match(
  css,
  /\.windows-sidebar-drag-region\.is-sidebar-collapsed \{[\s\S]*display: none;[\s\S]*width: 0;[\s\S]*height: var\(--window-chrome-height\);/,
  'Collapsed Windows sidebar drag strip should not cover the sidebar toggle'
)

assert.match(
  css,
  /\.app-shell\.platform-win32 \.sidebar \{[\s\S]*padding-top: calc\(var\(--window-chrome-height\) \+ 8px\);/,
  'Windows sidebar content should sit below the extended draggable sidebar top strip'
)

assertAppRegion('.app-shell.platform-win32 .sidebar', 'no-drag', 'Windows sidebar itself must not sit under the toggle as a drag region')

assertAppRegion('.nav-list', 'no-drag', 'Windows sidebar navigation buttons must stay clickable')

assertAppRegion('.sidebar-content', 'no-drag', 'Windows sidebar content must stay clickable')

assertAppRegion('.sidebar-footer', 'no-drag', 'Windows sidebar footer controls must stay clickable')
