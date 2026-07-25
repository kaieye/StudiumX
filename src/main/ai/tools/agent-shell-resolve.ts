/**
 * Agent shell interpreter resolution (ported from Reasonix internal/sandbox/shell.go).
 * Used when the model passes a command string that needs bash/pwsh wrapping.
 * Does not invent non-Reasonix/Codex behavior.
 */

import { accessSync, constants as fsConstants, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'

export type AgentShellKind = 'bash' | 'powershell'

export type AgentShell = Readonly<{
  kind: AgentShellKind
  path: string
}>

function fileExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return fileExists(path)
  }
}

/** Reasonix isWindowsWSLBash — System32 bash.exe is WSL launcher, not Git bash. */
export function isWindowsWslBash(path: string): boolean {
  if (process.platform !== 'win32' || !path) return false
  const win = process.env.SystemRoot || process.env.windir || ''
  if (!win) return false
  const p = path.replace(/\//g, '\\').toLocaleLowerCase()
  const root = win.replace(/\//g, '\\').toLocaleLowerCase().replace(/\\+$/, '') + '\\'
  return p.startsWith(root)
}

/** Reasonix probeBash — confirm bash works (skip WSL stub hang). */
export function probeBash(path: string): boolean {
  if (process.platform !== 'win32') return true
  try {
    const result = spawnSync(path, ['-c', 'true'], {
      timeout: 3_000,
      windowsHide: true,
      encoding: 'utf8'
    })
    return result.status === 0
  } catch {
    return false
  }
}

/** Reasonix windowsBashCandidates — Git for Windows paths. */
export function windowsBashCandidates(): string[] {
  if (process.platform !== 'win32') return []
  const roots: string[] = []
  for (const env of ['ProgramFiles', 'ProgramFiles(x86)', 'LocalAppData'] as const) {
    const v = process.env[env]
    if (v) roots.push(v)
  }
  // Common defaults
  roots.push('C:\\Program Files', 'C:\\Program Files (x86)')
  const out: string[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    for (const rel of [
      'Git\\bin\\bash.exe',
      'Git\\usr\\bin\\bash.exe',
      'Programs\\Git\\bin\\bash.exe',
      'Programs\\Git\\usr\\bin\\bash.exe'
    ]) {
      const p = join(root, rel)
      const key = p.toLocaleLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
  }
  return out
}

export function windowsPowerShellCandidates(): string[] {
  if (process.platform !== 'win32') return []
  const roots = [process.env.SystemRoot, process.env.windir, 'C:\\Windows'].filter(Boolean) as string[]
  const out: string[] = []
  for (const root of roots) {
    out.push(join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  }
  // pwsh from PATH is resolved via lookPath separately
  return out
}

function lookPath(name: string): string | null {
  const pathEnv = process.env.PATH ?? ''
  const ext =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : ['']
  for (const dir of pathEnv.split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue
    for (const e of ext) {
      const candidate = join(dir, name + (e && !name.toLowerCase().endsWith(e.toLowerCase()) ? e : ''))
      if (isExecutable(candidate) || fileExists(candidate)) return candidate
    }
    // also try bare name
    const bare = join(dir, name)
    if (fileExists(bare)) return bare
  }
  return null
}

/**
 * Reasonix ResolveShell(prefer, path).
 * prefer: auto | bash | powershell | pwsh
 */
export function resolveAgentShell(
  prefer: string = 'auto',
  explicitPath: string = ''
): AgentShell {
  const mode = prefer.trim().toLocaleLowerCase() || 'auto'

  const findBash = (): AgentShell | null => {
    const fromPath = lookPath('bash')
    if (fromPath && !isWindowsWslBash(fromPath) && probeBash(fromPath)) {
      return { kind: 'bash', path: fromPath }
    }
    for (const p of windowsBashCandidates()) {
      if (fileExists(p) && probeBash(p)) return { kind: 'bash', path: p }
    }
    return null
  }

  const findPowerShell = (order: string[]): AgentShell | null => {
    for (const name of order) {
      for (const p of windowsPowerShellCandidates()) {
        const base = basename(p).toLocaleLowerCase()
        if (base === name || base === `${name}.exe`) {
          if (fileExists(p)) return { kind: 'powershell', path: p }
        }
      }
      const fromPath = lookPath(name)
      if (fromPath) return { kind: 'powershell', path: fromPath }
    }
    return null
  }

  const auto = (): AgentShell => {
    const bash = findBash()
    if (bash) return bash
    if (process.platform === 'win32') {
      const ps = findPowerShell(['pwsh', 'powershell'])
      if (ps) return ps
    }
    return { kind: 'bash', path: 'bash' }
  }

  if (mode === 'auto' || mode === '') return auto()

  if (mode === 'bash') {
    if (explicitPath && fileExists(explicitPath) && probeBash(explicitPath)) {
      return { kind: 'bash', path: explicitPath }
    }
    return findBash() ?? auto()
  }

  if (mode === 'powershell' || mode === 'pwsh') {
    if (explicitPath && fileExists(explicitPath)) {
      return { kind: 'powershell', path: explicitPath }
    }
    const order = mode === 'powershell' ? ['powershell', 'pwsh'] : ['pwsh', 'powershell']
    return findPowerShell(order) ?? auto()
  }

  return auto()
}

/** Reasonix Shell.argv(command) — wrap a command string for the interpreter. */
export function shellArgvForCommand(shell: AgentShell, command: string): string[] {
  if (shell.kind === 'powershell') {
    // Reasonix psUTF8Prologue
    const prologue =
      '$OutputEncoding=[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;'
    return [shell.path, '-NoProfile', '-Command', prologue + command]
  }
  return [shell.path, '-lc', command]
}

/**
 * If tool args only provide a free-form command string (not argv), wrap via resolved shell.
 * Already-tokenized argv is returned unchanged.
 */
export function expandCommandStringToArgv(
  command: string,
  preferShell: string = 'auto'
): string[] {
  const shell = resolveAgentShell(preferShell)
  return shellArgvForCommand(shell, command)
}
