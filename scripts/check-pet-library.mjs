import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('src/renderer/src/views/resources/PetLibrary.tsx', 'utf8')

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

console.log('check:pet-library passed')
