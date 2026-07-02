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
  css,
  /\.workspace-node-row\.is-selected:not\(\.is-course-folder\):not\(\.is-conversation\)/,
  'selected styling should exclude course folders and conversations'
)

assert.match(
  css,
  /\.workspace-node-row\.is-course-folder\.is-selected \{[\s\S]*background: rgba\(255, 255, 255, 0\.48\);/,
  'selected course folders should keep the normal course-folder background'
)

assert.match(
  css,
  /\.workspace-conversation-row\.is-selected \{[\s\S]*background: transparent;/,
  'selected temporary conversations should not keep a highlight background'
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
