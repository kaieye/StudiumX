import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const STYLE_IDS = [
  'manuscript',
  'chalkboard',
  'editorial',
  'blueprint',
  'poster',
  'classic',
  'nightfall',
  'paper',
  'vivid',
  'mono',
  'terminal'
]

const [
  styles,
  baseStyles,
  sharedAssets,
  workspace,
  settings,
  ipcCommands,
  mainIndex,
  preload,
  app,
  lessonStyleGallery,
  css,
  zh,
  en,
  themeEntries
] = await Promise.all([
  readFile('src/shared/lesson-styles.ts', 'utf8'),
  readFile('src/shared/lesson-style-themes/base.ts', 'utf8'),
  readFile('src/shared/lesson-style-themes/assets.ts', 'utf8'),
  readFile('src/main/teaching-workspace.ts', 'utf8'),
  readFile('src/main/teaching-settings.ts', 'utf8'),
  readFile('src/main/teaching-ipc-commands.ts', 'utf8'),
  readFile('src/main/index.ts', 'utf8'),
  readFile('src/preload/index.ts', 'utf8'),
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/renderer/src/views/resources/LessonStyleGallery.tsx', 'utf8'),
  readFile('src/renderer/src/styles.css', 'utf8'),
  readFile('src/renderer/src/i18n/locales/zh-CN.json', 'utf8'),
  readFile('src/renderer/src/i18n/locales/en-US.json', 'utf8'),
  Promise.all(
    STYLE_IDS.map(async (id) => [
      id,
      await readFile(`src/shared/lesson-style-themes/${id}.ts`, 'utf8')
    ])
  )
])

const themeSources = Object.fromEntries(themeEntries)

// ----- shared theme modules -----

for (const id of STYLE_IDS) {
  const symbol = id.toUpperCase()
  assert.match(
    styles,
    new RegExp(`${symbol}_STYLE`),
    `lesson style registry should include the "${id}" theme module`
  )
  assert.match(
    themeSources[id],
    new RegExp(`id: '${id}'`),
    `lesson style file should define the "${id}" theme`
  )
  assert.match(
    themeSources[id],
    new RegExp(`export const ${symbol}_TOKENS`),
    `lesson style file should export "${symbol}_TOKENS"`
  )
}

for (const selector of ['.lesson-hero', '.mission-card', '.quiz-card', '.compact-list', 'blockquote', 'thead']) {
  assert.ok(
    baseStyles.includes(selector),
    `buildLessonCss should keep styling the shared lesson markup (${selector})`
  )
}

assert.match(
  baseStyles,
  /\.flashcards \.flashcard \{/,
  'themes should override flashcards.css (loaded after lesson.css) with higher-specificity rules'
)

for (const name of ['LESSON_QUIZ_JS', 'LESSON_FLASHCARD_CSS', 'LESSON_FLASHCARD_JS']) {
  assert.match(
    sharedAssets,
    new RegExp(`export const ${name}`),
    `${name} should live in the shared assets module so main and renderer reuse one copy`
  )
  assert.match(
    styles,
    new RegExp(name),
    `${name} should be re-exported by the public lesson-styles module`
  )
}

// ----- main process wiring -----

assert.match(
  workspace,
  /async applyLessonStyle\(payload: ApplyLessonStylePayload\): Promise<TeachingAppState>/,
  'workspace service should expose applyLessonStyle'
)

assert.match(
  workspace,
  /atomicWriteFile\(join\(workspace\.rootPath, 'assets', 'lesson\.css'\), lessonStyleCss\(styleId\)\)/,
  'applyLessonStyle should overwrite assets/lesson.css with the selected theme'
)

assert.match(
  workspace,
  /'assets\/lesson\.css', lessonStyleCss\(lessonStyleId\)/,
  'workspace scaffolding should honor the configured lesson style'
)

assert.ok(
  !workspace.includes('const LESSON_CSS'),
  'the old inline LESSON_CSS constant should be gone (themes are the single source now)'
)

assert.match(
  settings,
  /lessonStyleId: normalizeLessonStyleId\(workspaceInput\.lessonStyleId\)/,
  'settings normalization should validate workspace.lessonStyleId'
)

assert.match(
  ipcCommands,
  /export function parseApplyLessonStylePayload/,
  'IPC command parsing should validate the apply-lesson-style payload'
)

assert.match(
  mainIndex,
  /ipcMain\.handle\('teach:apply-lesson-style'/,
  'main process should register the teach:apply-lesson-style handler'
)

assert.match(
  preload,
  /applyLessonStyle: \(payload\) => ipcRenderer\.invoke\('teach:apply-lesson-style', payload\)/,
  'preload should expose applyLessonStyle to the renderer'
)

// ----- renderer gallery -----

assert.match(
  lessonStyleGallery,
  /export function LessonStyleGallery\(/,
  'resources page should keep the style gallery implementation in its view module'
)

assert.match(
  app,
  /className="resource-page"[\s\S]{0,900}<LessonStyleGallery\s+currentStyleId=/,
  'the resources page should mount the style gallery when not reading a preview'
)

for (const removedResourceContent of ['PRESET_TUTORIALS', 'tutorial-grid', 'resource-page-secondary']) {
  assert.ok(
    !app.includes(removedResourceContent),
    `resources page should not render the old ${removedResourceContent} content`
  )
}

assert.match(
  lessonStyleGallery,
  /useState<LessonStyleId \| null>\(null\)/,
  'the gallery should track which style is being applied'
)

assert.match(
  lessonStyleGallery,
  /onClick=\{\(\) => onOpenPreview\(\{/,
  'clicking a style card should open the rendered sample preview'
)

assert.match(
  lessonStyleGallery,
  /html: buildLessonStyleSampleHtml\(style\.id\)/,
  'the style card preview should render the sample page for that style'
)

assert.match(
  app,
  /className="icon-button reader-preview-back"[\s\S]*aria-label=\{t\('resources\.styles\.backToStyles'\)\}[\s\S]*onClick=\{closeResourceHtmlPreview\}/,
  'resource style previews should expose a floating back button'
)

assert.match(
  lessonStyleGallery,
  /className="style-card-chip-aa"/,
  'style cards should render the brand-board type specimen (Aa) chip'
)

assert.doesNotMatch(
  lessonStyleGallery,
  /className="style-card-badge"/,
  'the selected style card should not show a top-right in-use badge'
)

assert.match(
  lessonStyleGallery,
  /className=\{`style-card-apply\$\{isCurrent \? ' is-current' : ''\}`\}/,
  'the selected style should use the apply button as its status control'
)

assert.match(
  lessonStyleGallery,
  /disabled=\{isCurrent \|\| isApplying\}/,
  'the selected style apply button should be disabled while showing the current status'
)

assert.match(
  app,
  /applyLessonStyle: async \(styleId\) => \{/,
  'the store should expose an applyLessonStyle action'
)

assert.match(
  app,
  /lessonStyleId: DEFAULT_LESSON_STYLE_ID/,
  'renderer fallback settings should include the default lesson style'
)

assert.match(css, /\.style-gallery \{/, 'styles.css should lay out the gallery')
assert.match(css, /\.style-card\.is-selected/, 'styles.css should highlight the selected style card')
assert.match(css, /\.style-card-chip-aa \{/, 'styles.css should style the type specimen chip')
assert.match(css, /\.style-card-scale \{/, 'styles.css should style the tonal scale strip')
assert.doesNotMatch(css, /\.style-card-badge/, 'styles.css should not keep styling a removed style card badge')
assert.match(css, /\.reader-preview-back \{/, 'styles.css should position the resource preview back button')
assert.match(css, /\.style-card-apply\.is-current/, 'styles.css should style the current style apply button')

// ----- i18n -----

for (const [locale, source] of [['zh-CN', zh], ['en-US', en]]) {
  const parsed = JSON.parse(source)
  const stylesNode = parsed.resources?.styles
  assert.ok(stylesNode, `${locale} should translate resources.styles`)
  for (const key of ['label', 'title', 'detail', 'previewLabel', 'apply', 'applied', 'closePreview', 'backToStyles', 'applyHint', 'applyHintNoWorkspace']) {
    assert.ok(typeof stylesNode[key] === 'string' && stylesNode[key].length > 0, `${locale} resources.styles.${key} should be translated`)
  }
  if (locale === 'zh-CN') {
    assert.equal(stylesNode.apply, '应用', 'Chinese apply copy should be concise')
    assert.equal(stylesNode.applied, '应用中', 'Chinese current-style button should say 应用中')
  } else {
    assert.equal(stylesNode.apply, 'Apply', 'English apply copy should be concise')
    assert.equal(stylesNode.applied, 'Applied', 'English current-style button should say Applied')
  }
  for (const id of STYLE_IDS) {
    assert.ok(stylesNode.items?.[id]?.name, `${locale} should name the "${id}" style`)
    assert.ok(stylesNode.items?.[id]?.detail, `${locale} should describe the "${id}" style`)
  }
}

console.log('check:lesson-styles passed')
