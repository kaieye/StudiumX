import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

async function readReachableCss(entryPath, seen = new Set()) {
  if (seen.has(entryPath)) return ''
  seen.add(entryPath)
  const content = await readFile(entryPath, 'utf8')
  const imports = [...content.matchAll(/@import\s+"([^"]+)";/g)]
    .map((match) => match[1])
    .filter((target) => target.startsWith('.'))
  const importedCss = await Promise.all(
    imports.map((target) => readReachableCss(join(dirname(entryPath), target), seen))
  )
  return [content, ...importedCss].join('\n')
}

const [appRoot, navigator, css, zh, en, desktopTopbar] = await Promise.all([
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/renderer/src/app-shell/teaching-workspace-navigator.tsx', 'utf8'),
  readReachableCss('src/renderer/src/styles.css'),
  readFile('src/renderer/src/i18n/locales/zh-CN.json', 'utf8'),
  readFile('src/renderer/src/i18n/locales/en-US.json', 'utf8'),
  readFile('src/renderer/src/ui/DesktopTopbar.tsx', 'utf8')
])
const app = `${appRoot}\n${navigator}`

assert.match(
  app,
  /const importWorkspace = useAppStore\(\(s\) => s\.importWorkspace\)/,
  'course section should use the existing folder import action'
)

assert.match(
  app,
  /className="section-add-button"[\s\S]*aria-label=\{t\('sidebar\.addCourseProject'\)\}/,
  'course section plus button should keep the add project affordance'
)

assert.match(
  app,
  /function ImportWorkspaceDialog\(/,
  'add project should render an import dialog instead of only opening the restricted native folder picker'
)

assert.match(
  navigator,
  /useReducer\(teachingWorkspaceNavigatorReducer, initialTeachingWorkspaceNavigatorState\)/,
  'teaching workspace navigator should own its transient import-dialog state behind its reducer seam'
)

assert.match(
  navigator,
  /state\.importDialogOpen/,
  'course section should render the import dialog from navigator-owned state'
)

assert.match(
  navigator,
  /dispatch\(\{ type: 'open-import-dialog' \}\)/,
  'course section plus button should open the navigator import dialog'
)

assert.match(
  app,
  /const openImportLocation = useAppStore\(\(s\) => s\.openImportLocation\)/,
  'import dialog should expose a system file manager action for managing folders'
)

assert.match(
  app,
  /<span className="collapsible-label">\{t\('sidebar\.courses'\)\}<\/span>\s*<span className="section-folder-chevron"/,
  'course section chevron should render to the right of the text'
)

assert.match(
  app,
  /<span className="collapsible-label">\{t\('sidebar\.conversations'\)\}<\/span>\s*<span className="section-folder-chevron"/,
  'conversation section chevron should render to the right of the text'
)

assert.match(
  app,
  /className="workspace-node-chevron"/,
  'workspace tree folder chevron should render inside the row button'
)

assert.doesNotMatch(
  app,
  /className="workspace-node-toggle"/,
  'workspace tree should not render a persistent left-side folder chevron button'
)

assert.doesNotMatch(
  app,
  /className="workspace-node-chevron-button"/,
  'workspace tree should not render folder chevrons as a separate small button'
)

assert.match(
  app,
  /<button className="workspace-node-button"[\s\S]*aria-expanded=\{isDirectory \? isExpanded : undefined\}[\s\S]*onClick=\{\(\) => void handleOpen\(\)\}[\s\S]*<span className="collapsible-label">[\s\S]*\{isDirectory \? <span className="workspace-node-chevron"/,
  'workspace tree folder rows should use one full row button for the label and chevron'
)

assert.doesNotMatch(
  app,
  /if \(itemKind === 'directory'\)/,
  'folder removal should use the full delete dialog with both list and disk actions'
)

assert.match(
  app,
  /itemKind === 'directory'\s*\?\s*t\('sidebar\.removeDialog\.kindFolder'\)/,
  'folder removal dialog should label directory targets as folders'
)

assert.doesNotMatch(
  app,
  /if \(!isExpanded\) onToggle\(workspace\.id, node\.relativePath\)/,
  'clicking a workspace or course folder row should toggle both expand and collapse'
)

assert.match(
  css,
  /\.sidebar \{[\s\S]*flex-direction: row;[\s\S]*gap: 0;[\s\S]*padding: 0;[\s\S]*background: var\(--app-shell-chrome-bg\);/,
  'sidebar should retain the same chrome material as the title strip around the session panel'
)

assert.match(
  css,
  /:root\[data-resolved-theme="dark"\] \.sidebar \{\s*background: var\(--app-shell-chrome-bg\);\s*\}/,
  'dark sidebar surroundings should retain the shared title-strip chrome material'
)

assert.match(
  css,
  /\.sidebar \{[\s\S]*user-select: none;[\s\S]*-webkit-user-select: none;/,
  'sidebar chrome should not allow accidental text selection'
)

assert.match(
  css,
  /\.sidebar input,[\s\S]*\.sidebar textarea \{[\s\S]*user-select: text;[\s\S]*-webkit-user-select: text;/,
  'sidebar form fields should still allow text selection'
)

assert.match(
  appRoot,
  /<nav className="sidebar-icon-rail" aria-label=\{t\('sidebar\.aria'\)\}>[\s\S]*className=\{`sidebar-rail-item \${view === item\.id \? 'is-active' : ''}\`\}[\s\S]*<Icon size=\{22\} aria-hidden="true" \/>/,
  'new chat, resources, study room, and mind map navigation should move to the larger icon rail'
)

assert.match(
  css,
  /\.sidebar-icon-rail \{[\s\S]*flex: 0 0 var\(--sidebar-rail-width, 60px\);[\s\S]*flex-direction: column;[\s\S]*align-items: center;[\s\S]*width: var\(--sidebar-rail-width, 60px\);[\s\S]*min-width: var\(--sidebar-rail-width, 60px\);[\s\S]*background: var\(--app-shell-sidebar-bg\);[\s\S]*app-region: no-drag;/,
  'the left navigation rail should remain vertical, clickable, and fixed while the session pane resizes'
)

assert.match(
  css,
  /\.sidebar-rail-item \{[\s\S]*width: 44px;[\s\S]*height: 44px;[\s\S]*border-radius: 14px;/,
  'rail navigation icons should be larger touch targets'
)

assert.match(
  css,
  /\.sidebar-panel \{[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
  'the outer session panel must stay a transparent clipping surface so its radii never clamp while collapsing'
)

assert.match(
  css,
  /\.sidebar-panel-motion-content \{[\s\S]*border-radius: var\(--app-shell-main-radius\) 0 0 var\(--app-shell-main-radius\);[\s\S]*background: var\(--app-shell-main-bg\);/,
  'the fixed-width inner content should carry the white surface and its rounded rail-facing corners'
)

assert.match(
  css,
  /\.app-shell\.is-sidebar-collapsed \{[\s\S]*grid-template-columns: var\(--sidebar-rail-width, 60px\) 0 minmax\(0, 1fr\);/,
  'collapsing the session panel should retain the fixed icon-rail grid column'
)

assert.match(
  appRoot,
  /<div className="sidebar-panel">\s*<div className="sidebar-panel-motion-content">/,
  'the session panel should retain a separately sized inner surface for clipping during collapse'
)

assert.match(
  css,
  /\.app-shell \{[\s\S]*--session-panel-motion-duration: 280ms;[\s\S]*--session-panel-motion-easing: cubic-bezier\(0\.38, 0, 0\.24, 1\);[\s\S]*--sidebar-divider-hide-duration: 80ms;[\s\S]*--sidebar-divider-show-delay: 175ms;[\s\S]*--sidebar-divider-show-duration: 100ms;[\s\S]*--sidebar-panel-expanded-width: calc\(var\(--sidebar-width\) - var\(--sidebar-rail-width, 60px\)\);[\s\S]*transition: grid-template-columns var\(--session-panel-motion-duration\) var\(--session-panel-motion-easing\);/,
  'the shell should retain the panel motion timing and directional divider safety window'
)

assert.match(
  css,
  /\.sidebar\.is-collapsed \.sidebar-panel \{[\s\S]*pointer-events: none;/,
  'collapsing the sidebar should disable the clipped session content without removing it from layout'
)

assert.doesNotMatch(
  css,
  /\.sidebar\.is-collapsed \.sidebar-panel \{[^}]*display:\s*none/,
  'the session panel must remain mounted while its width contracts with the shell grid'
)

assert.match(
  css,
  /\.sidebar-panel \{[\s\S]*flex: 1 1 0;[\s\S]*padding: 0;[\s\S]*overflow: hidden;/,
  'the outer session panel should be a zero-padding clipping surface driven by the shell grid'
)

assert.match(
  css,
  /\.sidebar-panel-motion-content \{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*width: var\(--sidebar-panel-expanded-width\);[\s\S]*min-width: var\(--sidebar-panel-expanded-width\);[\s\S]*height: 100%;[\s\S]*padding: 10px 12px 12px;/,
  'the inner session content should preserve its expanded width and be cropped instead of reflowing'
)

assert.doesNotMatch(
  css,
  /\.sidebar\.is-collapsed \.sidebar-panel \{[^}]*opacity:/,
  'the session panel should not fade out while it contracts horizontally'
)

assert.doesNotMatch(
  css,
  /\.sidebar-panel \{[^}]*transition:[^}]*opacity/,
  'the session panel should not animate opacity during width collapse'
)

assert.doesNotMatch(
  css,
  /\.sidebar\.is-collapsed \.sidebar-panel \{[^}]*transform:/,
  'the session panel itself must not translate over the fixed icon rail during collapse'
)

assert.match(
  css,
  /\.app-shell\.is-sidebar-collapsed \.sidebar-resizer \{[^}]*pointer-events: none;/,
  'the movable divider should stop intercepting pointer events while collapsed'
)

assert.match(
  css,
  /\.app-shell\.is-sidebar-collapsed \.sidebar-resizer::before \{[^}]*opacity: 0;[^}]*transform: scaleY\(0\.4\);[^}]*transition:\s*opacity var\(--sidebar-divider-hide-duration\) ease-out,\s*transform var\(--sidebar-divider-hide-duration\) ease-out;/,
  'the seam should retract toward its midpoint while fading, so no square endpoint reaches the rounded rail seam'
)

assert.match(
  css,
  /\.sidebar-resizer::before \{[^}]*transition:[^}]*opacity var\(--sidebar-divider-show-duration\) ease-out var\(--sidebar-divider-show-delay\),\s*transform var\(--sidebar-divider-show-duration\) ease-out var\(--sidebar-divider-show-delay\);/,
  'the seam should wait for expansion to clear the rounded rail seam before growing back from its midpoint'
)

assert.match(
  css,
  /\.sidebar-resizer::before \{[^}]*top: 0;[^}]*bottom: 0;[^}]*border-radius: 999px;/,
  'the visible divider seam should span the full divider height; the retract-and-fade motion keeps it clear of the rounded endcaps'
)

assert.doesNotMatch(
  css,
  /--sidebar-divider-(?:safe-delay|fade-duration)/,
  'the divider must not rely on a timing-only workaround to avoid the rounded seam'
)

assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.sidebar-panel,\s*\.sidebar-resizer,\s*\.sidebar-resizer::before,\s*\.app-shell\.is-sidebar-collapsed \.sidebar-resizer::before \{[\s\S]*transition-duration: 1ms;[\s\S]*transition-delay: 0ms;/,
  'reduced motion should remove divider animation delay together with the animation duration'
)

assert.doesNotMatch(
  css,
  /\.app-shell\.is-sidebar-collapsed \.sidebar-resizer \{[^}]*display:\s*none/,
  'the divider must remain mounted long enough to animate with the collapsing panel'
)

assert.doesNotMatch(
  css,
  /\.sidebar\.is-collapsed \{[^}]*(?:width:\s*0|pointer-events:\s*none|visibility:\s*hidden)/,
  'the collapsed state must not hide or disable the permanent icon rail'
)

assert.match(
  appRoot,
  /<Sidebar \/>\s*<SidebarResizeHandle policy=\{sidebarResizePolicy\} onResize=\{setSidebarWidth\} width=\{sidebarWidth\} \/>\s*<MainArea \/>/,
  'the adjustable divider should live between the complete session pane and the conversation area'
)

assert.doesNotMatch(
  appRoot,
  /sidebarRailWidth|onRailResize|defaultSidebarRailWidth/,
  'the icon rail should not be resized by the session/conversation divider'
)

assert.match(
  css,
  /\.sidebar-resizer \{[\s\S]*grid-column: 2;[\s\S]*width: 8px;[\s\S]*min-width: 8px;[\s\S]*height: 100%;[\s\S]*background: transparent;[\s\S]*transform: translateX\(-4px\);[\s\S]*cursor: col-resize;[\s\S]*app-region: no-drag;/,
  'the outer session/conversation divider should overlay the seam as a keyboard-accessible 8px drag target'
)

assert.match(
  css,
  /\.sidebar-resizer::before \{[\s\S]*top: 0;[\s\S]*bottom: 0;[\s\S]*left: calc\(50% - 0\.25px\);[\s\S]*width: 0\.5px;[\s\S]*background: var\(--app-shell-divider\);[\s\S]*opacity: 1;/,
  'the adjustable seam should draw one visible vertical separator'
)

assert.match(
  css,
  /\.app-shell \{[\s\S]*grid-template-columns: var\(--sidebar-width\) 0 minmax\(0, 1fr\);/,
  'the shell should keep the adjustable divider on a zero-width track so no grey gutter appears'
)

assert.match(
  css,
  /\.main-area \{[\s\S]*grid-column: 3;[\s\S]*border: 0;[\s\S]*border-radius: 0;/,
  'the conversation canvas should keep a square edge beside the session panel'
)

assert.match(
  css,
  /\.app-shell\.is-sidebar-collapsed \.main-area \{[\s\S]*border-radius: var\(--app-shell-main-radius\) 0 0 var\(--app-shell-main-radius\);/,
  'the collapsed conversation surface should inherit the icon-rail-facing rounded contour'
)

assert.match(
  css,
  /\.topbar \{[\s\S]*border-bottom-left-radius: 0;[\s\S]*background: var\(--app-shell-chrome-bg\);/,
  'the title-area surface should not curve into the conversation seam'
)

assert.doesNotMatch(
  css,
  /\.app-shell\.is-sidebar-collapsed \.topbar \{[\s\S]*border-bottom-left-radius:/,
  'the collapsed title strip must stay square so it does not leave a rounded notch above the conversation'
)

assert.match(
  desktopTopbar,
  /<span className="topbar-surface-corner" aria-hidden="true" \/>/,
  'the desktop title strip should provide a dedicated collapsed-surface corner element'
)

assert.match(
  css,
  /\.topbar-surface-corner \{[\s\S]*position: absolute;[\s\S]*top: 100%;[\s\S]*left: 0;[\s\S]*width: var\(--app-shell-main-radius\);[\s\S]*height: var\(--app-shell-main-radius\);[\s\S]*background: radial-gradient\([\s\S]*circle at 100% 100%,[\s\S]*transparent var\(--app-shell-main-radius\),[\s\S]*var\(--app-shell-chrome-bg\) var\(--app-shell-main-radius\)[\s\S]*\);[\s\S]*opacity: 0;[\s\S]*transition: opacity var\(--sidebar-divider-hide-duration\) ease-out;[\s\S]*\}\.app-shell\.is-sidebar-collapsed \.topbar-surface-corner \{[\s\S]*opacity: 1;[\s\S]*transition: opacity var\(--sidebar-divider-show-duration\) ease-out var\(--sidebar-divider-show-delay\);/,
  'the collapsed title strip should reveal the conversation surface through a left-top rounded corner'
)

assert.match(
  css,
  /\.sidebar-rail-item\.is-active \{[\s\S]*background: rgba\(20, 47, 95, 0\.09\);/,
  'the active icon rail item should retain the existing selected color'
)

assert.match(
  css,
  /\.app-shell\.platform-win32 \.sidebar \{[\s\S]*margin-top: var\(--window-chrome-height\);[\s\S]*padding-top: 0;/,
  'Windows session panel should start below the titlebar to create the rounded chrome-to-panel transition'
)

assert.match(
  css,
  /\.app-shell\.platform-darwin \.sidebar \{[\s\S]*height: calc\(100% - 52px\);[\s\S]*margin-top: 52px;[\s\S]*padding-top: 0;/,
  'macOS session panel should start below the traffic-light strip to create the rounded chrome-to-panel transition'
)

assert.match(
  css,
  /\.app-shell\.platform-darwin \.sidebar-resizer \{[\s\S]*margin-top: 52px;[\s\S]*height: calc\(100% - 52px\);/,
  'macOS should begin the adjustable divider below the titlebar rather than splitting the continuous top chrome'
)

assert.match(
  css,
  /\.section-folder-chevron \{[\s\S]*opacity: 0;/,
  'section chevrons should be hidden by default'
)

assert.match(
  css,
  /\.section-folder-button:hover \.section-folder-chevron,[\s\S]*opacity: 1;/,
  'section chevrons should appear on hover or focus'
)

assert.match(
  css,
  /\.section-folder-button:hover \{[\s\S]*background: transparent;/,
  'course and conversation section headers should not highlight on hover'
)

assert.match(
  app,
  /selectedLessonPath=\{view === 'lessons' && \(lessonReaderOpen \|\| selectedMarkdownDocument\) \? selectedLessonPath : null\}/,
  'sidebar file selection should only be active while the lesson HTML reader or markdown reader is visible'
)

assert.doesNotMatch(
  app,
  /\{!readingHtml && <header className="topbar">/,
  'HTML reader views should keep the sidebar collapse button visible'
)

assert.match(
  app,
  /\{readingResourceHtml \? \(\s*<>\s*\{showInlineSidebarToggle && renderSidebarToggle\('icon-button reader-sidebar-toggle'\)\}[\s\S]*className=\{`icon-button reader-preview-back\$\{isWindows \? ' reader-preview-back--alone' : ''\}`\}[\s\S]*onClick=\{closeResourceHtmlPreview\}/,
  'resource HTML reader views should render the inline floating sidebar button only on platforms without chrome-level placement'
)

assert.match(
  app,
  /\) : readingCourseHtml \|\| readingMarkdown \? \(\s*showInlineSidebarToggle \? renderSidebarToggle\('icon-button reader-sidebar-toggle'\) : null\s*\) : \(\s*<header className="topbar">/,
  'lesson HTML and Markdown reader views should keep the inline floating sidebar toggle only on platforms without chrome-level placement'
)

assert.match(
  css,
  /\.main-area\[data-reading-html='true'\] \{[\s\S]*position: relative;/,
  'HTML reader views should establish a positioning context for the floating sidebar toggle'
)

assert.match(
  css,
  /\.reader-sidebar-toggle \{[\s\S]*position: absolute;[\s\S]*z-index: 35;[\s\S]*-webkit-app-region: no-drag;/,
  'HTML reader sidebar toggle should float above the lesson or resource iframe'
)

assert.match(
  css,
  /\.reader-preview-back \{[\s\S]*position: absolute;[\s\S]*left: 58px;[\s\S]*z-index: 35;[\s\S]*-webkit-app-region: no-drag;/,
  'resource preview back button should float next to the sidebar toggle'
)

assert.match(
  app,
  /const isHtmlFile = !isDirectory && node\.name\.toLowerCase\(\)\.endsWith\('\.html'\)/,
  'workspace tree should identify HTML files as selectable session rows'
)

assert.match(
  app,
  /const isMarkdownFile = !isDirectory && node\.name\.toLowerCase\(\)\.endsWith\('\.md'\)/,
  'workspace tree should identify Markdown files as selectable document rows'
)

assert.match(
  app,
  /onOpenMarkdownFile=\{\(file\) => onLoadWorkspaceMarkdownFile\(file, workspace\.id\)\}/,
  'course sidebar should route Markdown files into the in-app markdown document reader'
)

assert.doesNotMatch(
  app,
  /MarkdownEditorMode|markdownMode|setMarkdownMode|onModeChange/,
  'markdown documents should not expose mode state or a mode switch'
)

assert.doesNotMatch(
  app,
  /markdown-document-toolbar|markdown-pane-label|data-mode=\{/,
  'markdown document panel should not render top chrome or pane labels'
)

assert.doesNotMatch(
  css,
  /markdown-document-toolbar|markdown-pane-label|data-mode=/,
  'markdown document styles should not keep toolbar, labels, or mode-specific layouts'
)

assert.match(
  app,
  /className="markdown-document-editor"[\s\S]*<MarkdownEditor[\s\S]*className="markdown-document-preview"[\s\S]*<MarkdownPreview/,
  'markdown document panel should always render CodeMirror editor and rendered preview panes together'
)

assert.match(
  app,
  /import \{ MarkdownEditor \} from '\.\/markdown-editor'/,
  'markdown document panel should use the dedicated CodeMirror editor component'
)

assert.match(
  app,
  /import \{ MarkdownPreview \} from '\.\/markdown-preview'/,
  'markdown document panel should use the dedicated markdown-it preview component'
)

assert.match(
  await readFile('src/renderer/src/markdown-editor.tsx', 'utf8'),
  /markdown\(\)[\s\S]*EditorView\.lineWrapping[\s\S]*updateListener/,
  'markdown editor should enable CodeMirror markdown editing with live updates'
)

assert.match(
  await readFile('src/renderer/src/markdown-preview.tsx', 'utf8'),
  /new MarkdownIt\([\s\S]*html: false[\s\S]*linkify: true[\s\S]*markdownItTaskLists[\s\S]*markdownItMark/,
  'markdown preview should render through a markdown-it pipeline with GFM-like basics'
)

assert.match(
  css,
  /\.markdown-document-body \{[\s\S]*grid-template-columns: minmax\(300px, 0\.9fr\) minmax\(0, 1\.1fr\);/,
  'markdown split view should use a side-by-side editor/preview layout on desktop'
)

assert.match(
  css,
  /\.workspace-node-row\.is-selected\.is-html-file,[\s\S]*\.workspace-node-row\.is-selected\.is-markdown-file,[\s\S]*\.workspace-node-row\.is-selected\.is-conversation \{[\s\S]*box-shadow:/,
  'selected HTML files, Markdown documents, and course conversations should receive selected-row shadow styling'
)

assert.doesNotMatch(
  app,
  /isWorkspaceFolder && workspace\.id === activeWorkspaceId/,
  'workspace folders should not participate in selected-row highlighting'
)

assert.match(
  css,
  /\.workspace-node-row\.is-workspace-folder,[\s\S]*\.workspace-node-row\.is-course-folder \{[\s\S]*box-shadow: none;/,
  'workspace and course folders should not have sidebar row shadows'
)

assert.match(
  css,
  /\.workspace-conversation-row\.is-selected \{[\s\S]*background: rgb\(241, 243, 245\);[\s\S]*box-shadow: none;/,
  'selected temporary conversations should use the current neutral selected-row treatment'
)

assert.match(
  css,
  /\.workspace-node-row\.is-directory \.workspace-node-button \{[\s\S]*flex: 1 1 auto;/,
  'workspace tree folder row button should stretch across the available row area'
)

assert.match(
  css,
  /\.workspace-node-row\.is-directory \.workspace-node-button > \.collapsible-label \{[\s\S]*flex: 0 1 auto;/,
  'workspace tree folder labels should not push the chevron away from the folder name'
)

assert.match(
  css,
  /\.workspace-node-row:hover \.workspace-node-chevron,[\s\S]*opacity: 1;/,
  'workspace tree folder chevron should appear when hovering anywhere on the row'
)

assert.match(zh, /"addCourseProject": "添加项目"/, 'Chinese locale should label the add project button')
assert.match(en, /"addCourseProject": "Add project"/, 'English locale should label the add project button')
assert.match(zh, /StudiumX/, 'Chinese locale should use the current StudiumX product name')
assert.match(en, /StudiumX/, 'English locale should use the current StudiumX product name')

console.log('sidebar ui behavior ok')
