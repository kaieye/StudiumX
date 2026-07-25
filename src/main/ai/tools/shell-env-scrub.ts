/**
 * Sanitize environment inherited by workspace-shell child processes.
 * Hermes-inspired secret scrub: keep PATH/HOME/LANG essentials, strip
 * provider keys / tokens / common credential env names.
 * Pure transform — no I/O.
 */

/** Always keep these process/OS essentials when present. */
const ESSENTIAL_ENV_KEYS = new Set([
  'PATH',
  'Path',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'TMP',
  'TEMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'LANGUAGE',
  'TZ',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'WINDIR',
  'ComSpec',
  'COMSPEC',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'PROGRAMDATA',
  'ProgramData',
  'PROGRAMFILES',
  'ProgramFiles',
  'PROGRAMFILES(X86)',
  'ProgramFiles(x86)',
  'LOCALAPPDATA',
  'LocalAppData',
  'APPDATA',
  'AppData',
  'PUBLIC',
  'ALLUSERSPROFILE',
  'COMMONPROGRAMFILES',
  'CommonProgramFiles',
  'PSModulePath',
  'PWD',
  'OLDPWD',
  'SHLVL',
  'COLORTERM',
  'TERM_PROGRAM',
  'DISPLAY',
  'XDG_RUNTIME_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'NODE_ENV',
  'npm_config_user_agent',
  'npm_node_execpath',
  'INIT_CWD',
  'ELECTRON_RUN_AS_NODE'
])

/**
 * Exact keys always stripped (high-value tokens / provider credentials).
 * Subset inspired by Hermes Tier-1 + common LLM/cloud keys.
 */
const ALWAYS_STRIP_EXACT = new Set(
  [
    // GitHub / git hosts
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_PRIVATE_KEY_PATH',
    'GH_ENTERPRISE_TOKEN',
    // Cloud / LLM providers
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'AZURE_OPENAI_API_KEY',
    'AZURE_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GROQ_API_KEY',
    'MISTRAL_API_KEY',
    'TOGETHER_API_KEY',
    'FIREWORKS_API_KEY',
    'DEEPSEEK_API_KEY',
    'XAI_API_KEY',
    'COHERE_API_KEY',
    'PERPLEXITY_API_KEY',
    'HUGGINGFACE_TOKEN',
    'HF_TOKEN',
    'HF_API_TOKEN',
    'REPLICATE_API_TOKEN',
    'OPENROUTER_API_KEY',
    'TOGETHER_AI_API_KEY',
    'CLAUDE_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CODEX_API_KEY',
    'CURSOR_API_KEY',
    // AWS
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_SECURITY_TOKEN',
    // GCP / Azure identity
    'AZURE_CLIENT_SECRET',
    'AZURE_CLIENT_ID',
    'AZURE_TENANT_ID',
    'GCLOUD_KEY_FILE',
    // Generic secrets
    'API_KEY',
    'API_TOKEN',
    'ACCESS_TOKEN',
    'AUTH_TOKEN',
    'SECRET_KEY',
    'SECRET_TOKEN',
    'PRIVATE_KEY',
    'PRIVATE_KEY_PATH',
    'NPM_TOKEN',
    'NODE_AUTH_TOKEN',
    'TWILIO_AUTH_TOKEN',
    'SLACK_BOT_TOKEN',
    'SLACK_TOKEN',
    'DISCORD_TOKEN',
    'DISCORD_BOT_TOKEN',
    'TELEGRAM_BOT_TOKEN',
    'STRIPE_SECRET_KEY',
    'STRIPE_API_KEY',
    'DATABASE_URL',
    'DB_PASSWORD',
    'POSTGRES_PASSWORD',
    'MYSQL_PWD',
    'REDIS_PASSWORD',
    'SSH_AUTH_SOCK',
    // StudiumX / local app secrets if ever present
    'STUDIUMX_API_KEY',
    'STUDIUMX_TOKEN',
    'ELECTRON_APP_SECRET'
  ].map((k) => k.toUpperCase())
)

/** Suffix / substring patterns that strongly indicate secrets. */
const STRIP_KEY_PATTERNS: RegExp[] = [
  /(?:^|_)(API[_-]?KEY|API[_-]?TOKEN|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|SECRET[_-]?KEY|SECRET[_-]?TOKEN|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|PASSWORD|PASSWD|PASSPHRASE)(?:_|$)/i,
  /(?:^|_)(BEARER|CREDENTIALS?|SESSION[_-]?TOKEN)(?:_|$)/i
]

function shouldStripKey(key: string): boolean {
  if (!key) return true
  if (ESSENTIAL_ENV_KEYS.has(key)) return false
  const upper = key.toUpperCase()
  if (ALWAYS_STRIP_EXACT.has(upper)) return true
  for (const re of STRIP_KEY_PATTERNS) {
    if (re.test(key)) return true
  }
  // Common secret suffix families (never strip TERM / TERM_PROGRAM — essentials).
  if (upper === 'TERM' || upper === 'TERMINAL' || upper === 'TERM_PROGRAM') return false
  if (
    upper.endsWith('_API_KEY') ||
    upper.endsWith('_ACCESS_KEY') ||
    upper.endsWith('_SECRET') ||
    upper.endsWith('_TOKEN') ||
    upper.includes('_API_KEY')
  ) {
    return true
  }
  return false
}

/**
 * Build a child-process env from a parent env map.
 * - Strips known secrets / provider credentials
 * - Preserves PATH / HOME / locale / Windows system essentials
 * - Does not invent values for missing keys
 */
export function sanitizeShellChildEnv(
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  extraEnv?: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}

  for (const [key, value] of Object.entries(baseEnv ?? {})) {
    if (value === undefined) continue
    if (shouldStripKey(key)) continue
    out[key] = value
  }

  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === undefined) continue
      if (shouldStripKey(key)) continue
      out[key] = value
    }
  }

  return out
}

/** Test helper: whether a key would be stripped (does not consider essential allow). */
export function isShellEnvKeyStripped(key: string): boolean {
  if (ESSENTIAL_ENV_KEYS.has(key)) return false
  return shouldStripKey(key)
}
