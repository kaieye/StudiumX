import assert from 'node:assert/strict'
import {
  buildWebRemoteControlConnectUrl,
  calculateWebRemoteControlProof,
  createWebRemoteControlPassHash,
  createWebRemoteControlPassword,
  parseWebRemoteControlAppPayload,
  verifyWebRemoteControlProof
} from '../../src/shared/web-remote-control'
import { getFeature, isFeatureEnabled } from '../../src/shared/features'

const password = createWebRemoteControlPassword()
const passHash = createWebRemoteControlPassHash(password)
const proof = calculateWebRemoteControlProof(passHash, 'n1', 'device', 'sid')
assert.equal(
  verifyWebRemoteControlProof({ passHash, nonce: 'n1', role: 'device', deviceSid: 'sid', proof }),
  true
)

const url = buildWebRemoteControlConnectUrl({
  baseUrl: 'http://192.168.1.10:8080/',
  deviceSid: 'abc',
  passHash: 'def',
  timestamp: 1
})
assert.ok(url.includes('192.168.1.10'))
assert.ok(!url.includes('zcode.z.ai'))

assert.equal(
  parseWebRemoteControlAppPayload({
    zcode_type: 'rpc-frame',
    seq: 1,
    dataBase64: 'YQ==',
    bridgeSessionId: 'b'
  })?.zcode_type,
  'rpc-frame'
)
assert.equal(parseWebRemoteControlAppPayload({ foo: 1 }), null)

const feature = getFeature('web-remote-control')
assert.ok(feature)
assert.equal(feature.stage, 'under_development')
assert.equal(isFeatureEnabled('web-remote-control'), false)
assert.equal(isFeatureEnabled('web-remote-control', { allowUnderDevelopment: true }), true)

console.log('check:web-remote-control ok')
