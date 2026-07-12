import assert from 'node:assert/strict'

const {
  classifyProviderError,
  providerErrorReason,
  redactProviderErrorText
} = await import('../src/shared/provider-error.ts')
const { validateProviderRequestUrl } = await import('../src/shared/provider-url-policy.ts')

const insufficientBalance = classifyProviderError(
  'Provider 返回 402 Payment Required：{"error":{"message":"Insufficient Balance","type":"unknown_error","param":null,"code":"invalid_request_error"}}'
)

assert.deepEqual(insufficientBalance?.kind, 'insufficient_balance')
assert.equal(insufficientBalance?.status, 402)
assert.ok(insufficientBalance?.providerMessage?.includes('Insufficient Balance'))
assert.equal(providerErrorReason(insufficientBalance), 'Provider 余额不足')

const auth = classifyProviderError('Provider 返回 401 Unauthorized：{"error":{"message":"Invalid API key"}}')
assert.equal(auth?.kind, 'authentication')

const rateLimit = classifyProviderError('Provider 返回 429 Too Many Requests：rate limit exceeded')
assert.equal(rateLimit?.kind, 'rate_limit')

const redacted = redactProviderErrorText(
  'Authorization: Bearer sk-testsecret123456789 api_key=abc123 https://user:pass@example.test {"apiKey":"secret-value","x-api-key":"secret2"}'
)
assert.doesNotMatch(redacted, /sk-testsecret123456789|api_key=abc123|user:pass|secret-value|secret2/)
assert.match(redacted, /\[redacted\]/)

assert.equal(validateProviderRequestUrl('https://api.example.com/v1').ok, true)
assert.equal(validateProviderRequestUrl('http://localhost:11434/v1').ok, true)
assert.equal(validateProviderRequestUrl('http://127.0.0.1:11434/v1').ok, true)
assert.equal(validateProviderRequestUrl('http://api.example.com/v1').ok, false)
assert.equal(validateProviderRequestUrl('https://user:pass@example.com/v1').ok, false)

console.log('provider error classification and privacy checks ok')
