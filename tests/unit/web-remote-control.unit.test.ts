import { describe, expect, it } from 'vitest'
import {
  buildWebRemoteControlConnectUrl,
  calculateWebRemoteControlProof,
  createWebRemoteControlDeviceSid,
  createWebRemoteControlPassHash,
  createWebRemoteControlPassword,
  parseWebRemoteControlAppPayload,
  verifyWebRemoteControlProof
} from '../../src/shared/web-remote-control'

describe('web-remote-control pairing crypto', () => {
  it('creates password, passHash, and verifies HMAC proof (Zcode-compatible shape)', () => {
    const password = createWebRemoteControlPassword()
    expect(password.length).toBeGreaterThan(10)
    const passHash = createWebRemoteControlPassHash(password)
    expect(passHash).toMatch(/^[A-Za-z0-9+/=]+$/)
    const deviceSid = createWebRemoteControlDeviceSid()
    const nonce = 'test-nonce-1'
    const proof = calculateWebRemoteControlProof(passHash, nonce, 'mobile', deviceSid)
    expect(
      verifyWebRemoteControlProof({
        passHash,
        nonce,
        role: 'mobile',
        deviceSid,
        proof
      })
    ).toBe(true)
    expect(
      verifyWebRemoteControlProof({
        passHash,
        nonce,
        role: 'mobile',
        deviceSid,
        proof: proof.slice(0, -1) + (proof.endsWith('a') ? 'b' : 'a')
      })
    ).toBe(false)
  })

  it('builds connect URL without inventing a cloud host', () => {
    const url = buildWebRemoteControlConnectUrl({
      baseUrl: 'http://127.0.0.1:4123/',
      deviceSid: 'sid1',
      passHash: 'hash1',
      timestamp: 1000,
      deviceName: 'StudiumX'
    })
    expect(url.startsWith('http://127.0.0.1:4123/')).toBe(true)
    expect(url).toContain('sid=sid1')
    expect(url).toContain('hash=hash1')
    expect(url).toContain('t=1000')
    expect(url).not.toContain('zcode.z.ai')
  })
})

describe('web-remote-control app payload', () => {
  it('accepts known zcode_type and rejects unknown', () => {
    expect(parseWebRemoteControlAppPayload({ zcode_type: 'bootstrap-request', requestId: 'r1' })).toMatchObject({
      zcode_type: 'bootstrap-request'
    })
    expect(parseWebRemoteControlAppPayload({ zcode_type: 'nope' })).toBeNull()
    expect(parseWebRemoteControlAppPayload(null)).toBeNull()
    expect(parseWebRemoteControlAppPayload('x')).toBeNull()
  })
})
