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

const FULL_CSS_THEME_IDS = ['manuscript', 'chalkboard', 'editorial', 'blueprint', 'poster']

const [
  styles,
  baseStyles,
  lessonMarkupContract,
  lessonRenderer,
  sharedAssets,
  lessonStyleSample,
  workspace,
  workspaceLifecycle,
  settings,
  ipcCommands,
  mainIndex,
  preload,
  app,
  appStore,
  rendererSettings,
  lessonStyleGallery,
  css,
  responsiveCss,
  mainCss,
  zh,
  en,
  themeEntries,
  fullCssThemeEntries
] = await Promise.all([
  readFile('src/shared/lesson-styles.ts', 'utf8'),
  readFile('src/shared/lesson-style-themes/base.ts', 'utf8'),
  readFile('src/shared/lesson-style-themes/contract.ts', 'utf8'),
  readFile('src/main/ai/lesson-renderer.ts', 'utf8'),
  readFile('src/shared/lesson-style-themes/assets.ts', 'utf8'),
  readFile('src/renderer/src/lesson-style-sample.ts', 'utf8'),
  readFile('src/main/teaching-workspace.ts', 'utf8'),
  readFile('src/main/teaching-workspace/lifecycle.ts', 'utf8'),
  readFile('src/main/teaching-settings.ts', 'utf8'),
  readFile('src/main/teaching-ipc-commands.ts', 'utf8'),
  readFile('src/main/index.ts', 'utf8'),
  readFile('src/preload/index.ts', 'utf8'),
  readFile('src/renderer/src/App.tsx', 'utf8'),
  readFile('src/renderer/src/app-shell/appStore.ts', 'utf8'),
  readFile('src/renderer/src/workflows/settings.ts', 'utf8'),
  readFile('src/renderer/src/views/resources/LessonStyleGallery.tsx', 'utf8'),
  readFile('src/renderer/src/styles/resources.css', 'utf8'),
  readFile('src/renderer/src/styles/responsive.css', 'utf8'),
  readFile('src/renderer/src/styles/main.css', 'utf8'),
  readFile('src/renderer/src/i18n/locales/zh-CN.json', 'utf8'),
  readFile('src/renderer/src/i18n/locales/en-US.json', 'utf8'),
  Promise.all(
    STYLE_IDS.map(async (id) => [
      id,
      await readFile(`src/shared/lesson-style-themes/${id}.ts`, 'utf8')
    ])
  ),
  Promise.all(
    FULL_CSS_THEME_IDS.map(async (id) => [
      id,
      id === 'manuscript'
        ? await readFile('src/shared/lesson-style-themes/manuscript.ts', 'utf8')
        : await readFile(`src/shared/lesson-style-themes/css/${id}.ts`, 'utf8')
    ])
  )
])

const themeSources = Object.fromEntries(themeEntries)
const fullCssThemeSources = Object.fromEntries(fullCssThemeEntries)

function extractStringRecord(source, exportName) {
  const match = source.match(new RegExp(`export const ${exportName} = \\{([\\s\\S]*?)\\} as const`))
  assert.ok(match, `${exportName} should be exported as a const object`)

  const record = {}
  for (const [, key, value] of match[1].matchAll(/^\s+(\w+): '([^']+)'/gm)) {
    record[key] = value
  }
  return record
}

const contractClasses = extractStringRecord(lessonMarkupContract, 'LESSON_MARKUP_CLASSES')
const contractDataAttributes = extractStringRecord(lessonMarkupContract, 'LESSON_MARKUP_DATA_ATTRIBUTES')
const contractDatasetKeys = extractStringRecord(lessonMarkupContract, 'LESSON_MARKUP_DATASET_KEYS')

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const requiredClassKeys = [
  'page',
  'hero',
  'heroKicker',
  'missionCard',
  'compactList',
  'tip',
  'practice',
  'generatedQuiz',
  'quizCard',
  'quizChoices',
  'quizFill',
  'quizExplanation',
  'flashcards',
  'flashcard',
  'flashcardFace',
  'flashcardFront',
  'flashcardBack',
  'flashcardSelf',
  'isSelected',
  'isCorrect',
  'isWrong',
  'isFlipped'
]

const requiredDataAttributeKeys = ['quizType', 'quizAnswer', 'quizChoice', 'flashcardRating', 'quizReady']

// ----- shared theme modules -----

for (const key of requiredClassKeys) {
  assert.ok(contractClasses[key], `lesson markup contract should name the "${key}" class`)
}

for (const key of requiredDataAttributeKeys) {
  assert.ok(contractDataAttributes[key], `lesson markup contract should name the "${key}" data attribute`)
  assert.ok(contractDatasetKeys[key], `lesson markup contract should name the "${key}" dataset key`)
}

for (const name of [
  'LESSON_MARKUP_CLASSES',
  'LESSON_MARKUP_DATA_ATTRIBUTES',
  'LESSON_MARKUP_DATASET_KEYS',
  'LESSON_MARKUP_SELECTORS',
  'LESSON_INTERACTION_SOURCE'
]) {
  assert.match(
    styles,
    new RegExp(name),
    `${name} should be re-exported by the public lesson-styles module`
  )
}

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

for (const key of [
  'page',
  'hero',
  'heroKicker',
  'missionCard',
  'compactList',
  'tip',
  'practice',
  'generatedQuiz',
  'quizCard',
  'quizChoices',
  'quizFill',
  'quizExplanation',
  'flashcards',
  'flashcard',
  'flashcardFront',
  'flashcardBack',
  'flashcardSelf',
  'isSelected',
  'isCorrect',
  'isWrong'
]) {
  assert.ok(
    baseStyles.includes(`.${contractClasses[key]}`),
    `base lesson CSS should style the contract class "${contractClasses[key]}"`
  )
}

for (const [id, source] of Object.entries(fullCssThemeSources)) {
  for (const key of ['hero', 'missionCard', 'quizCard', 'quizFill', 'quizExplanation', 'flashcard', 'flashcardSelf']) {
    assert.ok(
      source.includes(`.${contractClasses[key]}`),
      `${id} theme CSS should keep styling the contract class "${contractClasses[key]}"`
    )
  }
}

assert.ok(
  fullCssThemeSources.poster.includes(`[${contractDataAttributes.flashcardRating}="again"]`),
  'poster theme CSS should key flashcard rating accents off the contract data-rating attribute'
)

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

for (const key of [
  'practice',
  'generatedQuiz',
  'quizCard',
  'quizFill',
  'quizExplanation',
  'isSelected',
  'isCorrect',
  'isWrong',
  'isFlipped'
]) {
  assert.ok(
    sharedAssets.includes(`LESSON_MARKUP_CLASSES.${key}`),
    `shared lesson assets should consume the contract class "${key}"`
  )
}

for (const key of requiredDataAttributeKeys) {
  assert.ok(
    sharedAssets.includes(`LESSON_MARKUP_DATA_ATTRIBUTES.${key}`) ||
      sharedAssets.includes(`LESSON_MARKUP_DATASET_KEYS.${key}`),
    `shared lesson assets should consume the contract data key "${key}"`
  )
}

for (const key of [
  'page',
  'hero',
  'heroKicker',
  'missionCard',
  'compactList',
  'tip',
  'practice',
  'quizCard',
  'quizChoices',
  'quizFill',
  'quizExplanation',
  'flashcards',
  'flashcard',
  'flashcardFace',
  'flashcardFront',
  'flashcardBack',
  'flashcardSelf'
]) {
  assert.ok(
    lessonStyleSample.includes(`cls.${key}`),
    `lesson style sample should render the contract class "${key}"`
  )
}

for (const key of ['quizType', 'quizAnswer', 'quizChoice', 'flashcardRating']) {
  assert.ok(
    lessonStyleSample.includes(`data.${key}`),
    `lesson style sample should render the contract data attribute "${key}"`
  )
}

// ----- main lesson renderer markup contract -----

assert.match(
  lessonRenderer,
  /LESSON_MARKUP_CLASSES[\s\S]*LESSON_MARKUP_DATA_ATTRIBUTES[\s\S]*from '..\/..\/shared\/lesson-style-themes\/contract'/,
  'lesson renderer should import the shared lesson markup contract'
)

for (const key of [
  'page',
  'hero',
  'heroKicker',
  'missionCard',
  'compactList',
  'practice',
  'quizCard',
  'quizChoices',
  'quizFill',
  'quizExplanation',
  'flashcards',
  'flashcard',
  'flashcardFace',
  'flashcardFront',
  'flashcardBack',
  'flashcardSelf'
]) {
  assert.ok(
    lessonRenderer.includes(`cls.${key}`) || lessonRenderer.includes(`LESSON_MARKUP_CLASSES.${key}`),
    `lesson renderer should render the contract class "${key}"`
  )
}

for (const key of ['quizType', 'quizAnswer', 'quizChoice', 'flashcardRating']) {
  assert.ok(
    lessonRenderer.includes(`data.${key}`) || lessonRenderer.includes(`LESSON_MARKUP_DATA_ATTRIBUTES.${key}`),
    `lesson renderer should render the contract data attribute "${key}"`
  )
}

for (const value of Object.values(contractClasses)) {
  assert.doesNotMatch(
    lessonRenderer,
    new RegExp(`class="(?:[^"]*\\s)?${escapeRegExp(value)}(?:\\s[^"]*)?"`),
    `lesson renderer should not hard-code the contract class "${value}"`
  )
}

for (const value of Object.values(contractDataAttributes)) {
  assert.doesNotMatch(
    lessonRenderer,
    new RegExp(`\\s${escapeRegExp(value)}=`),
    `lesson renderer should not hard-code the contract data attribute "${value}"`
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
  workspaceLifecycle,
  /writeWorkspaceScaffoldFileIfMissing\(workspace\.rootPath, effectivePathMeta, 'assets\/lesson\.css', lessonStyleCss\(lessonStyleId\)\)/,
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
  /ipcMain\.handle\(teachingInvokeChannels\.applyLessonStyle/,
  'main process should register the teach:apply-lesson-style handler'
)

assert.match(
  preload,
  /applyLessonStyle: \(payload\) => ipcRenderer\.invoke\(teachingInvokeChannels\.applyLessonStyle, payload\)/,
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
  /resourcePageSection === 'styles'[\s\S]{0,500}<ResourceStyleLibrary/,
  'the resources page should route style-library resources through a dedicated section'
)

assert.match(
  app,
  /function ResourceHome\(/,
  'the resources page should keep the organized resource home'
)

assert.match(
  app,
  /function ResourceHome\([\s\S]*useAppStore\(\(s\) => s\.settings\.workspace\.lessonStyleId\)[\s\S]*normalizeLessonStyleId/,
  'the resource home should read and normalize the current style like the main resource design'
)

assert.match(
  app,
  /role="tab" aria-selected="true" className="is-active"[\s\S]*role="tab" aria-selected="false" disabled/,
  'the resource home tabs should preserve the main tab semantics'
)

assert.match(
  app,
  /<Settings size=\{15\} \/>[\s\S]*<Palette size=\{22\} \/>[\s\S]*<SlidersHorizontal size=\{15\} \/>/,
  'the resource home should preserve the main resource icon hierarchy'
)

assert.match(
  app,
  /function ResourceStyleLibrary\([\s\S]*<LessonStyleGallery\s+currentStyleId=/,
  'the resource style section should mount the extracted style gallery'
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
  appStore,
  /applyLessonStyle: async \(styleId\) => \{/,
  'the store should expose an applyLessonStyle action'
)

assert.match(
  rendererSettings,
  /lessonStyleId: DEFAULT_LESSON_STYLE_ID/,
  'renderer fallback settings should include the default lesson style'
)

assert.match(css, /\.style-gallery \{/, 'styles.css should lay out the gallery')
assert.match(css, /\.style-card\.is-selected/, 'styles.css should highlight the selected style card')
assert.match(css, /\.style-card-chip-aa \{/, 'styles.css should style the type specimen chip')
assert.match(css, /\.style-card-scale \{/, 'styles.css should style the tonal scale strip')
assert.doesNotMatch(css, /\.style-card-badge/, 'styles.css should not keep styling a removed style card badge')
assert.match(mainCss, /\.reader-preview-back \{/, 'main.css should position the resource preview back button')
assert.match(css, /\.style-card-apply\.is-current/, 'styles.css should style the current style apply button')
assert.match(css, /\.resource-home \{\s*max-width: 728px;/, 'resources.css should preserve the main centered resource home width')
assert.match(
  css,
  /\.resource-installed-icon--styles,[\s\S]*linear-gradient\(135deg, #2bb3d9/,
  'resources.css should preserve the main installed style icon treatment'
)
assert.match(
  css,
  /\.resource-entry-grid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  'resources.css should preserve the main two-column resource directory'
)
assert.match(
  responsiveCss,
  /\.resource-page \{\s*padding-inline: 18px;[\s\S]*\.resource-entry-grid \{\s*grid-template-columns: 1fr;/,
  'responsive.css should preserve the main medium-width resource directory collapse'
)
assert.match(
  responsiveCss,
  /\.resource-page \{\s*padding: 16px 12px 36px;[\s\S]*\.resource-home-head h1,/,
  'responsive.css should preserve the main mobile resource page spacing and title scale'
)

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
