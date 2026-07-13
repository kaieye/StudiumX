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

const [app, chrome, main, reachableCss] = await Promise.all([
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/renderer/src/app-frame/window-chrome.tsx', 'utf8'),
  readFile('src/main/index.ts', 'utf8'),
  readReachableCss('src/renderer/src/styles.css')
])
const css = reachableCss.replace(/\r\n/g, '\n')

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
const macVisualOptions = main.match(/if \(process\.platform === 'darwin'\) \{\s*return \{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
assert.ok(macVisualOptions, 'macOS BrowserWindow visual options should be detectable')

assert.match(
  windowsVisualOptions,
  /titleBarStyle: 'hidden'[\s\S]*titleBarOverlay: buildWindowsTitleBarOverlay\(\)[\s\S]*backgroundMaterial: 'acrylic'/,
  'Windows BrowserWindow should use hidden transparent titlebar overlay mode like Zcode'
)

assert.match(
  main,
  /function buildWindowsTitleBarOverlay\(\): Electron\.TitleBarOverlay \{[\s\S]*height: 32/,
  'Windows native titlebar overlay should match the compact app chrome height'
)

assert.doesNotMatch(
  windowsVisualOptions,
  /frame: false/,
  'Windows BrowserWindow should not use raw frame:false because it can break app-region dragging'
)

assert.match(
  macVisualOptions,
  /backgroundColor: '#00000000'[\s\S]*titleBarStyle: 'hidden'[\s\S]*trafficLightPosition: MAC_WINDOW_BUTTON_POSITION[\s\S]*vibrancy: 'under-window'[\s\S]*visualEffectState: 'active'/,
  'macOS BrowserWindow should use native hidden titlebar traffic lights like ZCode'
)

assert.doesNotMatch(
  macVisualOptions,
  /frame: false/,
  'macOS BrowserWindow should not replace native traffic lights with custom frameless chrome'
)

assert.match(
  main,
  /const MAC_WINDOW_BUTTON_POSITION = \{ x: 22, y: 23 \}/,
  'macOS traffic light position should match the ZCode-style native titlebar placement'
)

assert.match(
  main,
  /if \(process\.platform === 'darwin'\) \{\s*mainWindow\.setWindowButtonPosition\(MAC_WINDOW_BUTTON_POSITION\)/,
  'macOS windows should explicitly sync native traffic light position after creation'
)

assert.match(
  css,
  /\.windows-window-chrome \{[\s\S]*app-region: drag;[\s\S]*-webkit-app-region: drag;/,
  'Windows frameless chrome should own the draggable titlebar region'
)

assert.match(
  css,
  /\.app-frame\.platform-win32 \{[\s\S]*--window-chrome-height: 32px;[\s\S]*--window-control-overlay-width: 138px;/,
  'Windows app frame should align chrome metrics with the native titlebar overlay'
)

assert.match(
  cssRule('.app-shell.platform-win32 .topbar'),
  /(?:^|\n)\s*min-height:\s*var\(--window-chrome-height\);/,
  'Windows main topbar should use the compact chrome height instead of forcing 48px'
)

assert.match(
  cssRule('.app-shell.platform-win32 .topbar .ghost-button,\n.app-shell.platform-win32 .topbar .primary-button'),
  /(?:^|\n)\s*height:\s*30px;/,
  'Windows topbar buttons should fit inside the compact 32px chrome'
)

assert.match(
  css,
  /\.windows-window-chrome \{[\s\S]*right: var\(--window-control-overlay-width\);[\s\S]*left: var\(--window-chrome-left-width\);[\s\S]*justify-content: flex-start;/,
  'Windows draggable chrome should leave the native titlebar overlay controls and sidebar toggle uncovered'
)

assertAppRegion('.windows-window-chrome .window-controls', 'no-drag', 'Windows window control buttons must remain clickable')

assert.doesNotMatch(
  chrome.match(/function WindowsWindowChromeAdapter\([\s\S]*?\n\}/)?.[0] ?? '',
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
  chrome,
  /const WINDOWS_WINDOW_CHROME_POLICY:[\s\S]*adapter: 'windows',[\s\S]*titlebar: 'native-overlay',[\s\S]*sidebarTogglePlacement: 'window-chrome',[\s\S]*sidebarDragRegionClass: 'windows-sidebar-drag-region'/,
  'Windows should choose the native-overlay adapter and an explicit sidebar-top drag strip'
)

assert.match(
  chrome,
  /const MACOS_WINDOW_CHROME_POLICY:[\s\S]*adapter: 'macos',[\s\S]*titlebar: 'native-traffic-lights',[\s\S]*sidebarTogglePlacement: 'window-chrome',[\s\S]*sidebarDragRegionClass: 'mac-sidebar-drag-region'/,
  'macOS should choose native traffic lights and an explicit sidebar-top drag strip'
)

assert.match(
  chrome,
  /function WindowsWindowChromeAdapter[\s\S]*<SidebarDragRegion[\s\S]*<SidebarToggleChrome[\s\S]*windows-window-chrome/,
  'Windows sidebar toggle should render as a separate no-drag layer before the draggable chrome'
)

assert.match(
  chrome,
  /function MacWindowChromeAdapter[\s\S]*<SidebarDragRegion[\s\S]*<SidebarToggleChrome/,
  'macOS should render a top-level sidebar toggle beside native traffic lights'
)

assert.doesNotMatch(chrome, /function MacWindowChrome\(|function MacTrafficLights\(|MacTrafficLightButton/, 'macOS should not self-draw traffic light buttons')

assert.match(
  chrome,
  /function SidebarToggleChrome[\s\S]*const handlePointerDown = \(event: ReactPointerEvent<HTMLButtonElement>\): void => \{[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)[\s\S]*onSidebarToggle\(\)[\s\S]*onPointerDown=\{handlePointerDown\}/,
  'Chrome sidebar toggles should switch on pointerdown before draggable chrome can swallow click'
)

assert.match(
  app,
  /const showInlineSidebarToggle = chrome\.sidebarTogglePlacement === 'inline-topbar'/,
  'macOS should not duplicate the sidebar toggle inside page topbars because it has chrome-level placement'
)

assert.match(
  css,
  /\.windows-sidebar-drag-region \{[\s\S]*position: absolute;[\s\S]*left: var\(--window-chrome-left-width\);[\s\S]*width: calc\(var\(--sidebar-width\) - var\(--window-chrome-left-width\)\);[\s\S]*height: var\(--window-chrome-height\);[\s\S]*app-region: drag;[\s\S]*-webkit-app-region: drag;/,
  'Windows sidebar top blank space should be an explicit draggable strip that does not sit under the sidebar toggle'
)

assert.match(
  css,
  /\.windows-sidebar-drag-region\.is-sidebar-collapsed \{[\s\S]*display: none;[\s\S]*width: 0;[\s\S]*height: var\(--window-chrome-height\);/,
  'Collapsed Windows sidebar drag strip should not cover the sidebar toggle'
)

assert.match(
  css,
  /\.mac-sidebar-drag-region \{[\s\S]*left: 136px;[\s\S]*width: calc\(var\(--sidebar-width\) - 136px\);[\s\S]*height: 52px;[\s\S]*app-region: drag;[\s\S]*-webkit-app-region: drag;/,
  'macOS sidebar drag strip should start to the right of native traffic lights and the sidebar toggle'
)

assert.match(
  css,
  /\.mac-sidebar-drag-region\.is-sidebar-collapsed \{[\s\S]*display: none;[\s\S]*width: 0;[\s\S]*height: 52px;/,
  'Collapsed macOS sidebar drag strip should not cover the custom chrome buttons'
)

assert.match(
  css,
  /\.mac-sidebar-toggle-chrome \{[\s\S]*top: 14px;[\s\S]*left: 96px;[\s\S]*app-region: no-drag;[\s\S]*-webkit-app-region: no-drag;/,
  'macOS sidebar toggle should sit to the right of native traffic lights using ZCode-style left padding'
)

assert.match(
  css,
  /\.app-shell\.platform-darwin\.is-sidebar-collapsed \.topbar::before \{[\s\S]*width: 136px;[\s\S]*height: 52px;[\s\S]*app-region: no-drag;[\s\S]*-webkit-app-region: no-drag;/,
  'Collapsed macOS topbars should reserve a no-drag hit region below native traffic lights and sidebar toggle'
)

assert.match(
  css,
  /\.app-shell\.platform-win32 \.sidebar \{[\s\S]*margin-top: var\(--window-chrome-height\);[\s\S]*height: calc\(100% - var\(--window-chrome-height\)\);[\s\S]*padding-top: 0;/,
  'Windows sidebar should start below the explicit sidebar-top drag strip instead of covering it'
)

assertAppRegion('.app-shell.platform-win32 .sidebar', 'no-drag', 'Windows sidebar content should not cover the collapse button as a drag region')

assertAppRegion('.app-shell.platform-darwin .sidebar', 'no-drag', 'macOS sidebar content must not swallow custom chrome button clicks as a drag region')

assertAppRegion('.mac-sidebar-toggle-chrome', 'no-drag', 'macOS sidebar toggle chrome must stay outside every draggable parent')

assertAppRegion('.mac-sidebar-toggle-chrome .mac-sidebar-toggle', 'no-drag', 'macOS sidebar toggle button must stay clickable beside the traffic lights')

assertAppRegion('.nav-list', 'no-drag', 'Windows sidebar navigation buttons must stay clickable')

assertAppRegion('.sidebar-content', 'no-drag', 'Windows sidebar content must stay clickable')

assertAppRegion('.sidebar-footer', 'no-drag', 'Windows sidebar footer controls must stay clickable')
