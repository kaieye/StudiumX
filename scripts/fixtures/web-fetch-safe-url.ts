import assert from 'node:assert/strict'

import { assertSafePublicHttpUrl } from '../../src/main/ai/tools/web_fetch'

await assert.rejects(() => assertSafePublicHttpUrl('file:///etc/passwd'), /http\/https/)
await assert.rejects(() => assertSafePublicHttpUrl('http://localhost/'), /本地地址/)
await assert.rejects(() => assertSafePublicHttpUrl('http://localhost./'), /本地地址/)
await assert.rejects(() => assertSafePublicHttpUrl('http://127.0.0.1/'), /内网\/回环/)
await assert.rejects(() => assertSafePublicHttpUrl('http://0177.0.0.1/'), /内网\/回环/)
await assert.rejects(() => assertSafePublicHttpUrl('http://2130706433/'), /内网\/回环/)
await assert.rejects(() => assertSafePublicHttpUrl('http://10.0.0.1/'), /内网\/回环/)
await assert.rejects(() => assertSafePublicHttpUrl('http://172.16.0.1/'), /内网\/回环/)
await assert.rejects(() => assertSafePublicHttpUrl('http://192.168.1.1/'), /内网\/回环/)
await assert.rejects(() => assertSafePublicHttpUrl('http://169.254.169.254/'), /内网\/回环/)
await assert.rejects(() => assertSafePublicHttpUrl('http://[::1]/'), /内网\/回环/)
await assert.rejects(() => assertSafePublicHttpUrl('http://[fd00::1]/'), /内网\/回环/)
await assert.rejects(() => assertSafePublicHttpUrl('http://[fe80::1]/'), /内网\/回环/)
await assert.rejects(() => assertSafePublicHttpUrl('http://[::ffff:127.0.0.1]/'), /内网\/回环/)
await assert.rejects(() => assertSafePublicHttpUrl('http://[2001:db8::1]/'), /内网\/回环/)

assert.equal(
  await assertSafePublicHttpUrl('https://93.184.216.34/path?q=ok'),
  'https://93.184.216.34/path?q=ok'
)
assert.equal(
  await assertSafePublicHttpUrl('https://[2606:4700:4700::1111]/dns-query'),
  'https://[2606:4700:4700::1111]/dns-query'
)

console.log('web_fetch safe URL checks ok')
