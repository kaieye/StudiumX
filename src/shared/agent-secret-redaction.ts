import { redactProviderErrorText } from './provider-error'

const REDACTED = '[redacted]'
const PRIVATE_KEY_PATTERN = /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g
const SECRET_KEY = [
  'password',
  'passphrase',
  'client(?:[_\\s-]?secret)',
  'refresh(?:[_\\s-]?token)',
  'session(?:[_\\s-]?token)',
  'access(?:[_\\s-]?token)',
  'private(?:[_\\s-]?token)',
  'personal(?:[_\\s-]?access)?(?:[_\\s-]?token)'
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
 * Conversation turn content remains an authoritative user record and is not
 * passed through this function by the persistence layer. Derived previews,
 * tool payloads, transcripts, and staging evidence must use this boundary.
 */
export function redactAgentSecretText(value: string): string {
  return redactProviderErrorText(value)
    .replace(PRIVATE_KEY_PATTERN, '[redacted private key]')
    .replace(GITHUB_TOKEN_PATTERN, REDACTED)
    .replace(URL_SECRET_PARAMETER_PATTERN, `$1${REDACTED}`)
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, prefix: string, secretValue: string) => {
      const quote = secretValue[0] === '"' || secretValue[0] === "'" ? secretValue[0] : ''
      return `${prefix}${quote}${REDACTED}${quote}`
    })
}
