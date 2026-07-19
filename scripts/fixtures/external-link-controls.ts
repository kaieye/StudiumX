import assert from 'node:assert/strict'

import { normalizeExternalHttpUrl, openExternalHttpUrl } from '../../src/main/external-links'

const enabledSettings = { privacy: { allowExternalLinks: true } }
const disabledSettings = { privacy: { allowExternalLinks: false } }
const opened: string[] = []

assert.deepEqual(normalizeExternalHttpUrl('https://example.com/docs?q=learning topic'), {
  ok: true,
  url: 'https://example.com/docs?q=learning%20topic'
})
assert.equal(normalizeExternalHttpUrl('file:///etc/passwd').ok, false)
assert.equal(normalizeExternalHttpUrl('javascript:alert(1)').ok, false)

assert.deepEqual(
  await openExternalHttpUrl('https://example.com/docs', enabledSettings, async (url) => {
    opened.push(url)
  }),
  { ok: true }
)
assert.deepEqual(opened, ['https://example.com/docs'])

assert.deepEqual(
  await openExternalHttpUrl('https://example.com/blocked', disabledSettings, async (url) => {
    opened.push(url)
  }),
  { ok: false, message: 'External links are disabled in privacy settings.' }
)
assert.deepEqual(opened, ['https://example.com/docs'])

assert.deepEqual(
  await openExternalHttpUrl('javascript:alert(1)', disabledSettings, async (url) => {
    opened.push(url)
  }),
  { ok: false, message: 'External links are disabled in privacy settings.' }
)
assert.deepEqual(opened, ['https://example.com/docs'])

const openerError = await openExternalHttpUrl('https://example.com/fails', enabledSettings, async () => {
  throw new Error('open failed')
})
assert.equal(openerError.ok, false)
assert.match(openerError.message ?? '', /open failed/)

console.log('external link controls ok')
