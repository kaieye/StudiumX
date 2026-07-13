import assert from 'node:assert/strict'

import {
  BOBA_PET,
  PET_CATALOG,
  PET_SPRITE_CELL_HEIGHT,
  PET_SPRITE_CELL_WIDTH,
  PET_SPRITE_FRAME_COUNT,
  PET_SPRITE_ROW_COUNT,
  PET_VISUAL_STATES,
  getPetAnimationFrames,
  getPetDefinition,
  getPetSpriteAtlasStyle,
  getPetSpriteDisplayHeight,
  getPetSpriteFrameIndex,
  getPetSpriteRow,
  getPetSpriteRowCount,
  getPetSpriteSheetUrl
} from '../../src/renderer/src/views/pet/pet-animation-catalog'

assert.deepEqual(
  PET_CATALOG.map((pet) => pet.id),
  ['boba', 'lulu-capybara', 'shinchan', 'usagi'],
  'the catalog should preserve the registered appearance order'
)
assert.equal(BOBA_PET.id, 'boba')
assert.equal(getPetDefinition().id, 'boba')
for (const pet of PET_CATALOG) {
  assert.equal(getPetDefinition(pet.id), pet)
  assert.equal(getPetSpriteSheetUrl(pet.id), pet.spritesheetUrl)
  assert.match(pet.spritesheetUrl, /spritesheet\.webp/, `${pet.id} should retain a bundled spritesheet URL`)
  assert.equal(pet.spriteVersionNumber, 1, `${pet.id} should retain the v1 default when its manifest omits it`)
}

assert.deepEqual(
  PET_VISUAL_STATES,
  ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']
)
for (const [row, state] of PET_VISUAL_STATES.entries()) {
  assert.equal(getPetSpriteRow(state), row, `${state} should retain its atlas row`)
}

assert.equal(PET_SPRITE_CELL_WIDTH, 192)
assert.equal(PET_SPRITE_CELL_HEIGHT, 208)
assert.equal(PET_SPRITE_FRAME_COUNT, 8)
assert.equal(PET_SPRITE_ROW_COUNT, 9)
assert.equal(getPetSpriteRowCount('boba'), 9)
assert.equal(getPetSpriteDisplayHeight(192), 208)
assert.equal(getPetSpriteDisplayHeight(96), 104)
assert.deepEqual(getPetSpriteAtlasStyle('boba', 'idle', 0), {
  backgroundPosition: '0% 0%',
  backgroundSize: '800% 900%'
})
assert.deepEqual(getPetSpriteAtlasStyle('usagi', 'review', 7), {
  backgroundPosition: '100% 100%',
  backgroundSize: '800% 900%'
})

assert.deepEqual(
  getPetAnimationFrames('idle'),
  [
    { columnIndex: 0, frameDurationMs: 1680 },
    { columnIndex: 1, frameDurationMs: 660 },
    { columnIndex: 2, frameDurationMs: 660 },
    { columnIndex: 3, frameDurationMs: 840 },
    { columnIndex: 4, frameDurationMs: 840 },
    { columnIndex: 5, frameDurationMs: 1920 }
  ],
  'idle timings should remain byte-for-byte equivalent'
)
assert.deepEqual(getPetAnimationFrames('running-right'), [
  { columnIndex: 0, frameDurationMs: 120 },
  { columnIndex: 1, frameDurationMs: 120 },
  { columnIndex: 2, frameDurationMs: 120 },
  { columnIndex: 3, frameDurationMs: 120 },
  { columnIndex: 4, frameDurationMs: 120 },
  { columnIndex: 5, frameDurationMs: 120 },
  { columnIndex: 6, frameDurationMs: 120 },
  { columnIndex: 7, frameDurationMs: 220 }
])
assert.equal(getPetSpriteFrameIndex('idle', 0), 0)
assert.equal(getPetSpriteFrameIndex('idle', 1679), 0)
assert.equal(getPetSpriteFrameIndex('idle', 1680), 1)
assert.equal(getPetSpriteFrameIndex('running-right', 839), 6)
assert.equal(getPetSpriteFrameIndex('running-right', 840), 7)
assert.equal(getPetSpriteFrameIndex('running-right', 1060), 0)
assert.equal(getPetSpriteFrameIndex('running-right', -1), 7)
assert.equal(getPetSpriteFrameIndex('review', 999, true), 0)

console.log('pet animation catalog contract ok')
