import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, spriteSource, settingsSource, mainSettingsSource, workbenchSource] = await Promise.all([
  readFile('src/renderer/src/views/resources/PetLibrary.tsx', 'utf8'),
  readFile('src/renderer/src/views/pet/PetSprite.tsx', 'utf8'),
  readFile('src/shared/teaching-types/settings.ts', 'utf8'),
  readFile('src/main/teaching-settings.ts', 'utf8'),
  readFile('src/renderer/src/views/workbench/OfficeWorkbench.tsx', 'utf8')
])

assert.doesNotMatch(
  source,
  /resources\.pets\.(?:eyebrow|detail|settingsTitle|settingsDetail)/,
  'the pet page should not render the removed introductory or settings copy'
)
assert.match(
  source,
  /onPointerEnter=\{\(\) => setPreviewState\(state\)\}/,
  'preview state controls should react on pointer hover'
)
assert.match(
  source,
  /updateSettings\(\{ pet: \{ appearance(?:\s*:|\s*[,}])/,
  'pet appearance choices should persist through settings'
)
assert.match(
  settingsSource,
  /\['robot', 'cat', 'owl', 'sprout', 'fox', 'penguin'\]/,
  'pet choices should be distinct character identities rather than color variants'
)
for (const character of ['Robot', 'Cat', 'Owl', 'Sprout', 'Fox', 'Penguin']) {
  assert.match(
    spriteSource,
    new RegExp(`function draw${character}`),
    `${character.toLowerCase()} should have an independent sprite drawing path`
  )
  assert.match(
    spriteSource,
    new RegExp(`function draw${character}StateDetails`),
    `${character.toLowerCase()} should define state-specific poses for the full animation atlas`
  )
}
assert.match(
  spriteSource,
  /PET_VISUAL_STATES = \[\s*'idle',\s*'running-right',\s*'running-left',\s*'waving',\s*'jumping',\s*'failed',\s*'waiting',\s*'running',\s*'review'\s*\]/s,
  'the sprite atlas should preserve the nine-state boba-compatible row order'
)
assert.match(
  mainSettingsSource,
  /legacyPetAppearances/,
  'previous color-only appearance settings should migrate to the new character identities'
)
assert.match(
  workbenchSource,
  /useAppStore\(\(state\) => state\.settings\.pet\.appearance\)/,
  'the workbench should subscribe to the selected pet appearance'
)
assert.match(
  workbenchSource,
  /getPetSpriteSheetUrl\(appearance\)/,
  'the workbench should load the sprite sheet for the selected pet appearance'
)
assert.match(
  workbenchSource,
  /loadWorkbenchAssets\(petAppearance\)/,
  'the workbench should pass the selected pet appearance into asset loading'
)
assert.match(
  workbenchSource,
  /\}, \[petAppearance\]\)/,
  'the workbench should reload its pet sprite when the selected appearance changes'
)

console.log('check:pet-library passed')
