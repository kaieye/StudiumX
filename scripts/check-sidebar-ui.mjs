import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, css, zh, en] = await Promise.all([
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/renderer/src/styles.css', 'utf8'),
  readFile('src/renderer/src/i18n/locales/zh-CN.json', 'utf8'),
  readFile('src/renderer/src/i18n/locales/en-US.json', 'utf8')
])

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
  app,
  /const \[importDialogOpen, setImportDialogOpen\] = useState\(false\)/,
  'course section should keep local state for the import dialog'
)

assert.match(
  app,
  /setImportDialogOpen\(true\)/,
  'course section plus button should open the import dialog'
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
  /<button[\s\S]*className="workspace-node-button"[\s\S]*aria-expanded=\{isDirectory \? isExpanded : undefined\}[\s\S]*onClick=\{\(\) => void handleOpen\(\)\}[\s\S]*<span className="collapsible-label">[\s\S]*\{isDirectory \? \([\s\S]*<span className="workspace-node-chevron"/,
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
  /\.sidebar \{[\s\S]*padding: 4px 4px 12px 10px;/,
  'sidebar content should sit closer to the draggable divider'
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
  /\{readingResourceHtml \? \([\s\S]*renderSidebarToggle\('icon-button reader-sidebar-toggle'\)[\s\S]*className="icon-button reader-preview-back"[\s\S]*onClick=\{closeResourceHtmlPreview\}/,
  'resource HTML reader views should render floating sidebar and back buttons instead of a topbar'
)

assert.match(
  app,
  /\) : readingCourseHtml \|\| readingMarkdown \? \(\s*renderSidebarToggle\('icon-button reader-sidebar-toggle'\)\s*\) : \(\s*<header className="topbar">/,
  'lesson HTML and Markdown reader views should keep the floating sidebar toggle without a topbar'
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
  /onOpenMarkdownFile=\{\(file\) => void loadWorkspaceMarkdownFile\(file, workspace\.id\)\}/,
  'course sidebar should route Markdown files into the in-app markdown document reader'
)

assert.match(
  app,
  /type MarkdownEditorMode = 'split' \| 'preview' \| 'edit'/,
  'markdown documents should support split, preview, and edit modes'
)

assert.match(
  app,
  /markdownMode: 'split'/,
  'markdown documents should open in split mode by default'
)

assert.match(
  app,
  /className="markdown-document-editor"[\s\S]*<MarkdownEditor[\s\S]*className="markdown-document-preview"[\s\S]*<MarkdownPreview/,
  'markdown document panel should render CodeMirror editor and rendered preview panes together'
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
  /\.workspace-conversation-row\.is-selected \{[\s\S]*background: rgba\(79, 124, 245, 0\.1\);[\s\S]*box-shadow:/,
  'selected temporary conversations should receive the selected-row highlight and shadow'
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
assert.doesNotMatch(zh, /StudiumX/, 'Chinese removal copy should use the current TeachOS product name')
assert.doesNotMatch(en, /StudiumX/, 'English removal copy should use the current TeachOS product name')

console.log('sidebar ui behavior ok')
