import assert from 'node:assert/strict'

import {
  EXTERNAL_DESTINATION_PROTOCOLS,
  classifyExternalDestination,
  resolveExternalDestinationLaunchIntent
} from '../../src/shared/external-destination'
import { parsePreviewExternalHref } from '../../src/shared/preview-markdown-bridge'

assert.deepEqual(EXTERNAL_DESTINATION_PROTOCOLS, ['http:', 'https:'])
assert.deepEqual(classifyExternalDestination('https://example.com/docs?q=teach os'), {
  kind: 'browser',
  url: 'https://example.com/docs?q=teach%20os',
  protocol: 'https:'
})
assert.deepEqual(classifyExternalDestination('file:///etc/passwd'), {
  kind: 'blocked',
  message: 'External URL must be a valid http(s) URL.'
})
assert.deepEqual(classifyExternalDestination(42), {
  kind: 'blocked',
  message: 'IPC payload field "url" must be a string.'
})
assert.equal(parsePreviewExternalHref('HTTPS://EXAMPLE.COM/guide?q=teach os'), 'https://example.com/guide?q=teach%20os')
assert.equal(parsePreviewExternalHref('mailto:teacher@example.com'), null)

assert.deepEqual(
  resolveExternalDestinationLaunchIntent('http://example.com/guide', { allowExternalLinks: true }),
  {
    kind: 'launch',
    target: { kind: 'browser', url: 'http://example.com/guide', protocol: 'http:' }
  }
)
assert.deepEqual(
  resolveExternalDestinationLaunchIntent('javascript:alert(1)', { allowExternalLinks: false }),
  { kind: 'blocked', message: 'External links are disabled in privacy settings.' }
)

console.log('external destination policy ok')
