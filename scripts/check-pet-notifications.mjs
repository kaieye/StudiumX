import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [
  domainSource,
  appPetSource,
  librarySource,
  settingsTypesSource,
  settingsSchemaSource,
  domainTestSource,
  appPetTestSource,
  libraryTestSource,
  enSource,
  zhSource
] = await Promise.all([
  readFile('src/renderer/src/views/pet/pet-notifications.ts', 'utf8'),
  readFile('src/renderer/src/views/pet/AppPet.tsx', 'utf8'),
  readFile('src/renderer/src/views/resources/PetLibrary.tsx', 'utf8'),
  readFile('src/shared/teaching-types/settings.ts', 'utf8'),
  readFile('src/shared/teaching-settings-schema.ts', 'utf8'),
  readFile('tests/unit/pet-notifications.unit.test.ts', 'utf8'),
  readFile('tests/unit/app-pet.unit.test.tsx', 'utf8'),
  readFile('tests/unit/pet-library.unit.test.tsx', 'utf8'),
  readFile('src/renderer/src/i18n/locales/en-US.json', 'utf8'),
  readFile('src/renderer/src/i18n/locales/zh-CN.json', 'utf8')
])

const en = JSON.parse(enSource)
const zh = JSON.parse(zhSource)
const requiredCopyPaths = [
  'title',
  'detail',
  'actionableOnly.label',
  'actionableOnly.detail',
  'showRunning.label',
  'showRunning.detail',
  'showReview.label',
  'showReview.detail',
  'showWaving.label',
  'showWaving.detail',
  'sources.title',
  'sources.detail',
  'sources.agent',
  'sources.lessonGeneration',
  'sources.lessonReview',
  'sources.onboarding',
  'quiet.title',
  'quiet.detail',
  'quiet.active',
  'quiet.thirtyMinutes',
  'quiet.oneHour',
  'quiet.end',
  'criticalNote'
]

function valueAtPath(value, path) {
  return path.split('.').reduce((current, segment) => current?.[segment], value)
}

for (const [locale, resources] of [['en-US', en], ['zh-CN', zh]]) {
  const copy = resources.resources?.pets?.notificationPreferences
  assert.ok(copy, `${locale} should provide Pet notification preference copy`)
  for (const path of requiredCopyPaths) {
    const value = valueAtPath(copy, path)
    assert.equal(typeof value, 'string', `${locale} should provide ${path}`)
    assert.ok(value.trim(), `${locale} ${path} should not be empty`)
  }
}

assert.match(
  settingsTypesSource,
  /export type PetNotificationPreferences = \{[\s\S]*actionableOnly: boolean[\s\S]*quietUntil: number \| null[\s\S]*\}/,
  'shared settings should own the complete persisted Pet notification preference contract'
)
assert.match(
  settingsTypesSource,
  /sources: \{[\s\S]*agent: boolean[\s\S]*lessonGeneration: boolean[\s\S]*lessonReview: boolean[\s\S]*onboarding: boolean/,
  'the preference contract should cover every real Pet notification source'
)
assert.match(
  settingsSchemaSource,
  /notificationPreferences: \{[\s\S]*actionableOnly: false[\s\S]*showRunning: true[\s\S]*lessonReview: true[\s\S]*quietUntil: null/,
  'settings defaults should preserve the existing visible-notification behavior'
)
assert.match(
  settingsSchemaSource,
  /lessonReview: petNotificationSourcesInput\.lessonReview !== false/,
  'the lesson-review source should be normalized from its input like the other sources'
)
assert.match(
  settingsSchemaSource,
  /notificationPreferences: \{[\s\S]*\.\.\.current\.pet\.notificationPreferences[\s\S]*sources: \{[\s\S]*\.\.\.current\.pet\.notificationPreferences\.sources/,
  'partial settings updates should deep-merge source preferences'
)
assert.match(
  settingsSchemaSource,
  /quietUntil: normalizeOptionalTimestamp\(petNotificationPreferencesInput\.quietUntil\)/,
  'persisted quiet-mode expiry should be normalized as data rather than inferred from UI text'
)

assert.match(
  domainSource,
  /export function projectPetNotificationVisibility\([\s\S]*preferences: PetNotificationPreferences[\s\S]*now: number/,
  'notification visibility should be a pure domain projection'
)
assert.match(
  domainSource,
  /notification\.state === 'waiting' \|\| notification\.state === 'failed'\) return true/,
  'waiting and failed notifications should remain discoverable'
)
assert.match(
  domainSource,
  /if \(quietModeActive \|\| preferences\.actionableOnly\) return false/,
  'quiet and actionable-only modes should suppress only after critical-state handling'
)
assert.match(
  domainSource,
  /notification\.expiresAt !== undefined && notification\.expiresAt <= now\) return false/,
  'expired transient notifications should never replay after quiet mode'
)
assert.doesNotMatch(
  domainSource,
  /advancePetNotificationProjection\([\s\S]{0,180}preferences/,
  'notification preferences must not mutate the real run lifecycle projection'
)

assert.match(
  appPetSource,
  /projectPetNotificationVisibility\([\s\S]*notifications,[\s\S]*settings\.notificationPreferences,[\s\S]*notificationProjection\.now/,
  'AppPet should apply the pure visibility projection to real notifications'
)
assert.match(
  appPetSource,
  /selectPetNotifications\([\s\S]*presentableNotifications/,
  'dismissal and priority selection should consume policy-projected notifications'
)
assert.match(
  appPetSource,
  /quietUntil !== null && quietUntil > now\) expirations\.push\(quietUntil\)/,
  'AppPet should refresh visibility when temporary quiet mode ends'
)
assert.match(
  librarySource,
  /PET_QUIET_MODE_DURATIONS_MS\.thirtyMinutes[\s\S]*PET_QUIET_MODE_DURATIONS_MS\.oneHour/,
  'Pet Library should offer bounded temporary quiet-mode choices'
)
assert.match(
  librarySource,
  /updateNotificationPreferences\(\{[\s\S]*sources: \{ agent: event\.currentTarget\.checked \}/,
  'Pet Library should persist source controls through the settings adapter'
)
assert.match(
  librarySource,
  /sources: \{[\s\S]*lessonReview: event\.currentTarget\.checked/,
  'Pet Library should persist the lesson-review source control through the settings adapter'
)

assert.match(domainTestSource, /keeps waiting and failed discoverable/, 'domain tests should protect critical discoverability')
assert.match(domainTestSource, /does not replay a transient notification/, 'domain tests should protect quiet-mode expiry')
assert.match(appPetTestSource, /without changing a real running lifecycle/, 'component tests should protect lifecycle independence')
assert.match(appPetTestSource, /does not replay a review that expires while quiet mode is active/, 'component tests should protect stale replay')
assert.match(libraryTestSource, /Chinese and English/, 'Pet Library tests should exercise both supported languages')

console.log('check:pet-notifications passed')
