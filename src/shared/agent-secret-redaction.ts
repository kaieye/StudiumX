import { redactProviderErrorText } from './provider-error'

const REDACTED = '[redacted]'
const PRIVATE_KEY_PATTERN = /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g
const PROVIDER_TOKEN_PATTERN = /\b(?:AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|hf_[0-9A-Za-z]{20,}|pplx-[0-9A-Za-z]{20,}|r8_[0-9A-Za-z]{20,}|rk_live_[0-9A-Za-z]{20,}|sk-proj-[0-9A-Za-z_-]{20,}|sk_(?:live|test)_[0-9A-Za-z]{20,})\b/g
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
// This admits common compact and Base64 credential alphabets. The entropy
// check below prevents prose, paths, and repeated-character identifiers from
// being treated as unknown credentials merely because they are long. Padding
// is accepted only at the end so ordinary assignment punctuation is not folded
// into the candidate.
const GENERIC_HIGH_ENTROPY_TOKEN_PATTERN = /(?<![A-Za-z0-9._~+/\-])[A-Za-z0-9][A-Za-z0-9._~+/\-]{31,}={0,2}(?![A-Za-z0-9._~+/\-=])/g
const SECRET_KEY = [
  'password',
  'passphrase',
  'client(?:[_\\s-]?secret)',
  'refresh(?:[_\\s-]?token)',
  'session(?:[_\\s-]?token)',
  'access(?:[_\\s-]?token)',
  'private(?:[_\\s-]?token)',
  'personal(?:[_\\s-]?access)?(?:[_\\s-]?token)',
  '(?:[a-z0-9]+[_-])?api(?:[_\\s-]?key)?'
].join('|')
const URL_SECRET_PARAMETER_PATTERN = new RegExp(
  `([?&#](?:${SECRET_KEY}|api(?:[_-]?key)?|secret|token|credential)=)([^&#\\s]*)`,
  'gi'
)
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `(["']?\\b(?:${SECRET_KEY})\\b["']?\\s*[:=]\\s*)("(?:\\\\.|[^"\\\\\\r\\n])*"|'(?:\\\\.|[^'\\\\\\r\\n])*'|[^\\s,;&}\\r\\n]+)`,
  'gi'
)

/**
 * Redacts secrets from agent-owned derived text before it is persisted.
 *
 * This is a durable-text boundary, not a provider-specific convenience. In
 * addition to labelled and provider-shaped credentials it removes JWTs and
 * unknown 32+ character high-entropy credential-like values wherever they
 * occur in mixed prose. That prevents an assistant echo, tool payload, event,
 * transcript, or diagnostic from becoming a persistence bypass.
 */
export function redactAgentSecretText(value: string): string {
  return redactProviderErrorText(value)
    .replace(PRIVATE_KEY_PATTERN, '[redacted private key]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, '$1[redacted]')
    .replace(GITHUB_TOKEN_PATTERN, REDACTED)
    .replace(PROVIDER_TOKEN_PATTERN, REDACTED)
    .replace(JWT_PATTERN, REDACTED)
    .replace(URL_SECRET_PARAMETER_PATTERN, `$1${REDACTED}`)
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, prefix: string, secretValue: string) => {
      const quote = secretValue[0] === '"' || secretValue[0] === "'" ? secretValue[0] : ''
      return `${prefix}${quote}${REDACTED}${quote}`
    })
    .replace(GENERIC_HIGH_ENTROPY_TOKEN_PATTERN, (candidate) => isHighEntropyCredentialLike(candidate) ? REDACTED : candidate)
}

/** A conservative detector for unlabeled credential-shaped values in prose. */
export function isHighEntropyCredentialLike(value: string): boolean {
  if (value.length < 32 || isClearlyStructuredNonSecretValue(value)) return false
  const alphabet = new Set(value).size
  const hasLower = /[a-z]/.test(value)
  const hasUpper = /[A-Z]/.test(value)
  const hasDigit = /\d/.test(value)
  const hasCredentialPunctuation = /[._~+/=-]/.test(value)
  const classes = Number(hasLower) + Number(hasUpper) + Number(hasDigit) + Number(hasCredentialPunctuation)
  if (alphabet < 12 || classes < 2) return false
  let entropy = 0
  for (const character of new Set(value)) {
    const occurrences = [...value].filter((item) => item === character).length
    const probability = occurrences / value.length
    entropy -= probability * Math.log2(probability)
  }
  return entropy >= 3.35
}

function isClearlyStructuredNonSecretValue(value: string): boolean {
  // Archive names are durable metadata rather than credential payloads. Do
  // not turn a legitimate long filename into a redaction marker, which would
  // invalidate its ledger path. Other high-entropy prose tokens still flow
  // through the detector above.
  if (/\.(?:md|markdown|json|jsonl|txt|csv|ts|tsx|js|jsx|mjs|cjs|yaml|yml|log|sqlite|db|pdf|png|jpe?g|webp|zip)$/i.test(value)) return true
  return false
}
