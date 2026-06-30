import assert from 'node:assert/strict'

const { classifyProviderError, providerErrorReason } = await import('../src/shared/provider-error.ts')

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

console.log('provider error classification ok')
