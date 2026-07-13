import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const petAssets = [
  { folder: 'boba', id: 'boba' },
  { folder: 'lulu', id: 'lulu-capybara' },
  { folder: 'Shinchan', id: 'shinchan' },
  { folder: 'usagi', id: 'usagi' }
]

const [
  source,
  spriteSource,
  sharedSettingsSource,
  mainSettingsSource,
  rendererSettingsSource,
  workbenchSource,
  appSource,
  ...manifestSources
] = await Promise.all([
  readFile('src/renderer/src/views/resources/PetLibrary.tsx', 'utf8'),
  readFile('src/renderer/src/views/pet/PetSprite.tsx', 'utf8'),
  readFile('src/shared/teaching-types/settings.ts', 'utf8'),
  readFile('src/main/teaching-settings.ts', 'utf8'),
  readFile('src/renderer/src/workflows/settings.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8'),
  readFile('src/renderer/src/App.tsx', 'utf8'),
  ...petAssets.map(({ folder }) => readFile(`src/renderer/src/assets/pets/${folder}/pet.json`, 'utf8'))
])

for (const [index, manifestSource] of manifestSources.entries()) {
  const expected = petAssets[index]
  const manifest = JSON.parse(manifestSource)
  assert.equal(manifest.id, expected.id, `${expected.folder} manifest should use the registered appearance id`)
  assert.equal(manifest.spritesheetPath, 'spritesheet.webp', `${expected.id} should point at its bundled spritesheet`)
  assert.ok(manifest.displayName, `${expected.id} should have a display name`)
}

assert.match(source, /PET_CATALOG\.map\(\(pet\) =>/, 'the pet resource page should render the bundled pet catalog')
assert.match(
  source,
  /updateSettings\(\{ pet: \{ appearance: pet\.id \} \}\)/,
  'selecting a pet should persist its appearance id'
)
assert.match(
  source,
  /appearance=\{settings\.appearance\}/,
  'the main preview should render the selected appearance'
)
assert.doesNotMatch(source, /pet-implementation-note|implementationTitle/, 'the implementation card should not be rendered')
assert.match(
  source,
  /onPointerEnter=\{\(\) => setPreviewState\(state\)\}/,
  'preview state controls should react on pointer hover'
)

for (const { folder } of petAssets) {
  assert.match(
    spriteSource,
    new RegExp(`new URL\\('\\.\\.\\/\\.\\.\\/assets\\/pets\\/${folder}\\/spritesheet\\.webp', import\\.meta\\.url\\)\\.href`),
    `${folder} spritesheet should be bundled through Vite`
  )
}
assert.match(spriteSource, /const CELL_WIDTH = 192/, 'pet cells should use the Codex 192px width')
assert.match(spriteSource, /const CELL_HEIGHT = 208/, 'pet cells should use the Codex 208px height')
assert.match(spriteSource, /const FRAME_COUNT = 8/, 'pets should use eight atlas columns')
assert.match(spriteSource, /const STANDARD_ROW_COUNT = 9/, 'v1 pets should use nine state rows')
assert.match(
  spriteSource,
  /manifest\.spriteVersionNumber \?\? 1/,
  'a manifest without spriteVersionNumber should default to v1'
)
assert.match(
  spriteSource,
  /PET_VISUAL_STATES = \[\s*'idle',\s*'running-right',\s*'running-left',\s*'waving',\s*'jumping',\s*'failed',\s*'waiting',\s*'running',\s*'review'\s*\]/s,
  'the pet atlases should preserve the nine Codex animation rows'
)
assert.match(spriteSource, /data-appearance=\{pet\.id\}/, 'sprite consumers should expose their selected appearance')

assert.match(
  sharedSettingsSource,
  /PET_APPEARANCE_IDS = \['boba', 'lulu-capybara', 'shinchan', 'usagi'\]/,
  'settings should accept every bundled pet id'
)
assert.match(sharedSettingsSource, /normalizePetAppearanceId/, 'legacy appearance ids should have a shared migration path')
assert.match(mainSettingsSource, /appearance: DEFAULT_PET_APPEARANCE_ID/, 'new main-process settings should default to Boba')
assert.match(rendererSettingsSource, /appearance: DEFAULT_PET_APPEARANCE_ID/, 'renderer fallback settings should default to Boba')
assert.match(
  rendererSettingsSource,
  /appearance: normalizePetAppearanceId\(settings\.pet\?\.appearance, emptySettings\.pet\.appearance\)/,
  'renderer settings should normalize stale appearance ids'
)
assert.match(
  appSource,
  /resource-installed-icon--pets[\s\S]*?<PetSprite appearance=\{petAppearance\}[\s\S]*?state="idle"/,
  'the installed resource shortcut should show the selected pet'
)
assert.match(
  appSource,
  /resource-entry-icon--\$\{entry\.icon\}[\s\S]*?<PetSprite appearance=\{petAppearance\}[\s\S]*?state="idle"/,
  'the pet resource card should show the selected pet'
)
assert.match(
  workbenchSource,
  /getPetSpriteSheetUrl\(appearance\)/,
  'the workbench should load the selected pet spritesheet through the shared API'
)

console.log('check:pet-library passed')
