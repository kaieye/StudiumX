/**
 * Host-owned read-oriented command safelist (strict known-safe contract).
 * Used only for based_on_approval auto-allow and read_only eligibility — not a sandbox.
 * Fail-closed: may tighten, must not loosen. ADR-0152 / Stage B.
 */

function executableLookupKey(raw: string): string {
  const base =
    String(raw ?? '')
      .trim()
      .replace(/\\/g, '/')
      .split('/')
      .pop() ?? ''
  const lower = base.toLocaleLowerCase()
  return lower.endsWith('.exe') ? lower.slice(0, -4) : lower
}

/** Pure status / no-path commands eligible when args stay non-escaping. */
const SAFE_STATUS = new Set(['pwd', 'true', 'false', 'uname', 'whoami', 'id', 'echo'])

/** Listing commands: safe flags only; path args must be relative without `..`. */
const SAFE_LIST = new Set(['ls', 'dir'])

/**
 * Read-only git subcommands. Writable / context-mutating subcommands are intentionally
 * absent (config, branch, tag, remote, checkout, switch, merge, rebase, reset, clean,
 * add, commit, push, pull, fetch, stash, …).
 */
const SAFE_GIT_SUBCOMMANDS = new Set([
  'status',
  'log',
  'show',
  'diff',
  'rev-parse',
  'describe',
  'ls-files',
  'ls-tree',
  'blame',
  'help',
  'version'
])

/** Git globals that change execution context or inject config — any occurrence ⇒ non-safe. */
const UNSAFE_GIT_CONTEXT_GLOBALS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
  '--super-prefix',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs'
])

/**
 * Tokenize a simple command string for safety checks only.
 * Does not implement a full shell grammar — fail closed on metacharacters
 * that imply redirection / chaining beyond a single argv vector.
 */
export function tokenizeCommandLine(command: string): string[] | null {
  const raw = String(command ?? '').trim()
  if (!raw) return null
  // Reject shell metacharacters that enable write/side-effect chaining.
  if (/[|><&;`$(){}]/.test(raw) || raw.includes('\n') || raw.includes('\r')) {
    return null
  }
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (quote) return null
  if (current) tokens.push(current)
  return tokens.length ? tokens : null
}

function hasRedirectionToken(argv: readonly string[]): boolean {
  return argv.some((a) => a === '>' || a === '>>' || a === '<' || a.includes('>'))
}

/** Absolute / home / parent-traversal path args cannot be proven in-workspace. */
function isUnsafePathArg(arg: string): boolean {
  if (!arg) return true
  if (arg.startsWith('-')) return false
  if (arg.startsWith('~')) return true
  // Unix absolute or UNC
  if (arg.startsWith('/') || arg.startsWith('\\\\') || arg.startsWith('//')) return true
  // Windows drive absolute (C:\… or C:/…)
  if (/^[a-zA-Z]:[\\/]/.test(arg)) return true
  // Parent traversal in any segment
  const segments = arg.split(/[/\\]/)
  if (segments.some((seg) => seg === '..')) return true
  return false
}

/**
 * Shell interpreters used by expandCommandStringToArgv must never be known-safe
 * (bash -lc / pwsh -Command wrappers hide arbitrary scripts).
 */
function isShellInterpreterWrapper(argv: readonly string[]): boolean {
  const cmd = executableLookupKey(argv[0] ?? '')
  if (!cmd) return false
  if (cmd === 'bash' || cmd === 'sh' || cmd === 'zsh' || cmd === 'dash' || cmd === 'ksh') {
    return argv.some((arg, index) => {
      if (index === 0) return false
      if (arg === '-c' || arg === '-lc') return true
      // Clustered short options that include -c (e.g. -lc, -c, -ec)
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg)) return true
      return false
    })
  }
  if (cmd === 'pwsh' || cmd === 'powershell') {
    return argv.some((arg, index) => {
      if (index === 0) return false
      const lower = arg.toLocaleLowerCase()
      return (
        lower === '-command' ||
        lower === '-c' ||
        lower === '/command' ||
        lower === '/c' ||
        lower.startsWith('-command:') ||
        lower.startsWith('-c:')
      )
    })
  }
  if (cmd === 'cmd') {
    return argv.some((arg, index) => {
      if (index === 0) return false
      const lower = arg.toLocaleLowerCase()
      return lower === '/c' || lower === '/k' || lower === '-c'
    })
  }
  return false
}

function isSafeStatus(argv: readonly string[]): boolean {
  const cmd = executableLookupKey(argv[0] ?? '')
  if (cmd === 'echo') {
    return !hasRedirectionToken(argv)
  }
  // Pure status: flags only; reject path-looking operands.
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('-')) continue
    if (arg.includes('/') || arg.includes('\\') || arg.includes('..') || arg.startsWith('~')) {
      return false
    }
  }
  return !hasRedirectionToken(argv)
}

function isSafeList(argv: readonly string[]): boolean {
  if (hasRedirectionToken(argv)) return false
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('-')) {
      // Reject long options that could invoke external helpers (none expected on ls/dir).
      // Keep common short/long listing flags; fail closed on `--*` that embed `=` executables.
      if (arg.startsWith('--') && arg.includes('=')) return false
      continue
    }
    if (isUnsafePathArg(arg)) return false
  }
  return true
}

function isUnsafeGitGlobal(arg: string): boolean {
  if (UNSAFE_GIT_CONTEXT_GLOBALS.has(arg)) return true
  // Equals-form context changers: --git-dir=…, --work-tree=…, etc.
  if (
    arg.startsWith('--git-dir=') ||
    arg.startsWith('--work-tree=') ||
    arg.startsWith('--namespace=') ||
    arg.startsWith('--exec-path=') ||
    arg.startsWith('--config-env=') ||
    arg.startsWith('--super-prefix=')
  ) {
    return true
  }
  // -ckey=value compact form is not standard, but -c always takes a separate arg.
  return false
}

function isSafeGit(argv: readonly string[]): boolean {
  // git [global opts] <subcommand> ...
  let i = 1
  while (i < argv.length) {
    const arg = argv[i]!
    if (isUnsafeGitGlobal(arg)) return false
    if (arg.startsWith('-')) {
      // Non-context global flag (e.g. --no-pager, -p). Single-token only.
      i += 1
      continue
    }
    return SAFE_GIT_SUBCOMMANDS.has(arg.toLocaleLowerCase())
  }
  return false
}

/**
 * Codex-style "known safe" / read-oriented commands eligible for
 * based_on_approval auto-allow and read_only. Never grants network installers,
 * writers, path-escaping readers, or shell-wrapper expansions.
 */
export function isKnownSafeReadCommand(argv: readonly string[]): boolean {
  if (!argv.length) return false
  const cmd = executableLookupKey(argv[0]!)
  if (!cmd) return false

  // Expanded free-form scripts (bash -lc / pwsh -Command / cmd /c) are never known-safe.
  if (isShellInterpreterWrapper(argv)) return false

  if (cmd === 'git') return isSafeGit(argv)

  // Path-bearing readers: default NOT known-safe (Windows policy-only cannot prove in-workspace).
  // find / rg / cat / type / grep / head / tail stay false even without -exec/--pre.
  if (
    cmd === 'find' ||
    cmd === 'rg' ||
    cmd === 'cat' ||
    cmd === 'type' ||
    cmd === 'grep' ||
    cmd === 'head' ||
    cmd === 'tail' ||
    cmd === 'less' ||
    cmd === 'more' ||
    cmd === 'sed' ||
    cmd === 'awk'
  ) {
    return false
  }

  if (SAFE_STATUS.has(cmd)) return isSafeStatus(argv)
  if (SAFE_LIST.has(cmd)) return isSafeList(argv)

  return false
}

import { expandCommandStringToArgv } from './agent-shell-resolve'

/**
 * Parse tool args into argv for safety + execution.
 * Prefer explicit `argv` array; fall back to tokenizing `command` string.
 * When `command` contains shell metacharacters, wrap via Reasonix-style shell
 * resolution (bash -lc / pwsh -Command) — same path coding agents use for scripts.
 */
export function resolveShellArgv(args: unknown): {
  argv: string[]
  cwdRelative: string
  timeoutMs: number
} | { error: string } {
  const record =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : null
  if (!record) return { error: 'Arguments must be an object.' }

  let argv: string[] | null = null
  if (Array.isArray(record.argv)) {
    const tokens = record.argv.map((part) => String(part ?? '').trim()).filter(Boolean)
    argv = tokens.length ? tokens : null
  } else if (typeof record.command === 'string') {
    const raw = record.command.trim()
    if (!raw) {
      argv = null
    } else {
      const simple = tokenizeCommandLine(raw)
      if (simple) {
        argv = simple
      } else {
        // Reasonix Shell.argv: free-form scripts with | && ; etc.
        const prefer =
          typeof record.shell === 'string' && record.shell.trim()
            ? record.shell.trim()
            : 'auto'
        argv = expandCommandStringToArgv(raw, prefer)
      }
    }
  }

  if (!argv?.length) {
    return {
      error: 'Provide non-empty argv[] or a non-empty command string.'
    }
  }

  if (argv.length > 64) {
    return { error: 'argv length exceeds 64 tokens.' }
  }
  if (argv.some((part) => part.length > 4_096)) {
    return { error: 'argv token exceeds 4096 characters.' }
  }

  const cwdRelative =
    typeof record.cwd === 'string' && record.cwd.trim() ? record.cwd.trim() : '.'
  if (cwdRelative.includes('\0')) {
    return { error: 'cwd must not contain NUL.' }
  }

  const rawTimeout = record.timeoutMs
  let timeoutMs = 30_000
  if (typeof rawTimeout === 'number' && Number.isFinite(rawTimeout)) {
    timeoutMs = Math.min(120_000, Math.max(1_000, Math.round(rawTimeout)))
  } else if (typeof rawTimeout === 'string' && rawTimeout.trim()) {
    const parsed = Number(rawTimeout)
    if (Number.isFinite(parsed)) {
      timeoutMs = Math.min(120_000, Math.max(1_000, Math.round(parsed)))
    }
  }

  return { argv, cwdRelative, timeoutMs }
}
