import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, spriteSource, manifestSource, mainSettingsSource, rendererSettingsSource, workbenchSource, appSource] = await Promise.all([
  readFile('src/renderer/src/views/resources/PetLibrary.tsx', 'utf8'),
  readFile('src/renderer/src/views/pet/PetSprite.tsx', 'utf8'),
  readFile('src/renderer/src/assets/pets/boba/pet.json', 'utf8'),
  readFile('src/main/teaching-settings.ts', 'utf8'),
  readFile('src/renderer/src/workflows/settings.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/App.tsx', 'utf8')
])

const manifest = JSON.parse(manifestSource)
assert.equal(manifest.id, 'boba', 'the bundled pet manifest should identify Boba')
assert.equal(manifest.spritesheetPath, 'spritesheet.webp', 'the manifest should point at the bundled spritesheet')

assert.doesNotMatch(
  source,
  /PET_APPEARANCE_IDS|updateSettings\(\{ pet: \{ appearance/,
  'the pet resource page should not expose the previous multi-pet picker'
)
assert.match(source, /data-appearance="boba"/, 'the preview stage should identify the single Boba pet')
assert.match(source, /resources\.pets\.appearances\.boba/, 'the single pet card should be labeled Boba')
assert.equal(
  (source.match(/pet-appearance-option/g) ?? []).length,
  1,
  'the pet resource page should render exactly one appearance option'
)
assert.match(
  source,
  /onPointerEnter=\{\(\) => setPreviewState\(state\)\}/,
  'preview state controls should react on pointer hover'
)

assert.match(
  spriteSource,
  /new URL\('\.\.\/\.\.\/assets\/pets\/boba\/spritesheet\.webp', import\.meta\.url\)\.href/,
  'the renderer should bundle the Boba spritesheet through Vite'
)
assert.match(spriteSource, /const CELL_WIDTH = 192/, 'Boba cells should use the Codex 192px width')
assert.match(spriteSource, /const CELL_HEIGHT = 208/, 'Boba cells should use the Codex 208px height')
assert.match(spriteSource, /const FRAME_COUNT = 8/, 'Boba should use eight atlas columns')
assert.match(spriteSource, /const STANDARD_ROW_COUNT = 9/, 'the v1 Boba atlas should use nine state rows')
assert.match(
  spriteSource,
  /bobaManifest\.spriteVersionNumber \?\? 1/,
  'a manifest without spriteVersionNumber should follow Codex and default to v1'
)
assert.match(
  spriteSource,
  /PET_VISUAL_STATES = \[\s*'idle',\s*'running-right',\s*'running-left',\s*'waving',\s*'jumping',\s*'failed',\s*'waiting',\s*'running',\s*'review'\s*\]/s,
  'the Boba atlas should preserve the nine Codex animation rows'
)
assert.match(spriteSource, /data-appearance="boba"/, 'all pet sprite consumers should render Boba')

assert.match(mainSettingsSource, /displayName: 'Boba'/, 'new main-process settings should default to Boba')
assert.match(rendererSettingsSource, /displayName: 'Boba'/, 'renderer fallback settings should default to Boba')
assert.match(
  mainSettingsSource,
  /legacyPetAppearances/,
  'previous appearance settings should continue to migrate safely even though only Boba is shown'
)
assert.match(
  appSource,
  /resource-installed-icon--pets[\s\S]*?<PetSprite[\s\S]*?state="idle"/,
  'the installed resource shortcut should show the Boba sprite instead of a generic cat icon'
)
assert.match(
  appSource,
  /resource-entry-icon--\$\{entry\.icon\}[\s\S]*?<PetSprite[\s\S]*?state="idle"/,
  'the pet resource card should show the Boba sprite'
)
assert.match(
  workbenchSource,
  /getPetSpriteSheetUrl\(appearance\)/,
  'the workbench should keep loading the shared pet spritesheet API'
)

console.log('check:pet-library passed')
