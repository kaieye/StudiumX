import { describe, expect, it } from 'vitest'

import {
  classifyExternalDestination,
  resolveExternalDestinationLaunchIntent
} from '../../src/shared/external-destination'
import { parsePreviewExternalHref } from '../../src/shared/preview-markdown-bridge'

describe('external destination policy', () => {
  it('classifies and canonicalizes allowlisted browser destinations', () => {
    expect(classifyExternalDestination('https://example.com/docs?q=teach os')).toEqual({
      kind: 'browser',
      url: 'https://example.com/docs?q=teach%20os',
      protocol: 'https:'
    })
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'mailto:teacher@example.com'])(
    'blocks unsupported destination protocol %s',
    (rawUrl) => {
      expect(classifyExternalDestination(rawUrl)).toEqual({
        kind: 'blocked',
        message: 'External URL must be a valid http(s) URL.'
      })
    }
  )

  it('rejects non-string destinations with the preserved IPC validation message', () => {
    expect(classifyExternalDestination({ url: 'https://example.com' })).toEqual({
      kind: 'blocked',
      message: 'IPC payload field "url" must be a string.'
    })
  })

  it('keeps the preview bridge as a browser adapter over the shared classification', () => {
    expect(parsePreviewExternalHref('HTTPS://EXAMPLE.COM/guide?q=teach os')).toBe(
      'https://example.com/guide?q=teach%20os'
    )
    expect(parsePreviewExternalHref('mailto:teacher@example.com')).toBeNull()
  })

  it('creates a browser launch intent only when external links are allowed', () => {
    expect(resolveExternalDestinationLaunchIntent('http://example.com/guide', { allowExternalLinks: true })).toEqual({
      kind: 'launch',
      target: {
        kind: 'browser',
        url: 'http://example.com/guide',
        protocol: 'http:'
      }
    })

    expect(resolveExternalDestinationLaunchIntent('javascript:alert(1)', { allowExternalLinks: false })).toEqual({
      kind: 'blocked',
      message: 'External links are disabled in privacy settings.'
    })
  })
})
