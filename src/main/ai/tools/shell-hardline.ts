/**
 * Unconditional hardline denylist for workspace shell (Hermes-inspired floor).
 *
 * Floor below approvalMode=full_access（本课放行）and sandboxMode=full_access:
 * catastrophic host-destroying commands never run via the agent, regardless of
 * auto-allow. Product UI must not call this YOLO; full_access remains「本课放行」.
 *
 * Pure: no I/O. Fail closed on match. Deliberately small — only no-recovery paths.
 * Recoverable-but-costly ops (rm -rf ./build, git reset --hard) stay allowable under
 * 本课放行; that is what full_access is for.
 */

export type HardlineDecision =
  | Readonly<{ blocked: false }>
  | Readonly<{ blocked: true; code: 'hardline_denied'; description: string; reason: string }>

/** Join argv for pattern scan (single-command argv; not a full shell grammar). */
export function joinArgvForHardlineScan(argv: readonly string[]): string {
  return argv
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

function executableKey(raw: string): string {
  const base =
    String(raw ?? '')
      .trim()
      .replace(/\\/g, '/')
      .split('/')
      .pop() ?? ''
  const lower = base.toLocaleLowerCase()
  return lower.endsWith('.exe') ? lower.slice(0, -4) : lower
}

function stripQuotes(token: string): string {
  const t = String(token ?? '').trim()
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * True when a path token is root / home / protected system root (recursive wipe).
 * Intentionally does NOT match workspace-relative paths or /tmp/foo.
 */
function isCatastrophicDeleteTarget(raw: string): boolean {
  const path = stripQuotes(raw).trim()
  if (!path) return false

  // Unix home / env home
  if (path === '~' || path === '~/' || path === '~/*') return true
  if (/^\$\{?HOME\}?(?:\/|\/*)?$/.test(path) || path === '$HOME/*' || path === '${HOME}/*') {
    return true
  }

  // Windows user profile wipe
  if (/^%USERPROFILE%[/\\]?$/i.test(path) || /^%HOMEPATH%[/\\]?$/i.test(path)) return true
  if (/^%SystemDrive%[/\\]?$/i.test(path) || /^%SystemRoot%[/\\]?$/i.test(path)) return true

  // Drive root: C:\ C:/ D:\ etc.
  if (/^[a-zA-Z]:[/\\]?$/.test(path) || /^[a-zA-Z]:[/\\]\*$/.test(path)) return true

  // Unix root collapse spellings: / // /. /./ /.. /* //*
  if (/^\/(?:(?:\.\.?)?\/)*(?:\.\.?)?\**$/.test(path) || path === '/ *') return true

  // Protected system directories (exact root or /* only — not /home/user/x)
  const systemExact =
    /^\/(?:home|root|etc|usr|var|bin|sbin|boot|lib|lib64|System|Windows)(?:\/\*)?$/i
  if (systemExact.test(path)) return true

  // Windows \Windows \Users exact-ish
  if (/^[/\\](?:Windows|Users|Program Files|Program Files \(x86\))(?:[/\\]\*)?$/i.test(path)) {
    return true
  }

  return false
}

function hasRecursiveForceRmFlags(flags: readonly string[]): boolean {
  let recursive = false
  let force = false
  for (const f of flags) {
    const a = f.toLocaleLowerCase()
    if (a === '--recursive' || a === '-r' || a === '-R') recursive = true
    if (a === '--force' || a === '-f') force = true
    // clustered short: -rf -fr -rRf etc.
    if (/^-[a-zA-Z]*r[a-zA-Z]*$/i.test(f) && /r/i.test(f)) recursive = true
    if (/^-[a-zA-Z]*f[a-zA-Z]*$/i.test(f) && /f/i.test(f)) force = true
    if (a === '-rf' || a === '-fr' || a === '-Rf' || a === '-fR') {
      recursive = true
      force = true
    }
  }
  return recursive && force
}

function detectRmHardline(argv: readonly string[]): string | null {
  const cmd = executableKey(argv[0] ?? '')
  if (cmd !== 'rm' && cmd !== 'rmdir' && cmd !== 'del' && cmd !== 'erase') return null

  if (cmd === 'rm') {
    const flags: string[] = []
    const targets: string[] = []
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i]!
      if (a === '--') {
        targets.push(...argv.slice(i + 1))
        break
      }
      if (a.startsWith('-')) flags.push(a)
      else targets.push(a)
    }
    if (!hasRecursiveForceRmFlags(flags)) return null
    for (const t of targets) {
      if (isCatastrophicDeleteTarget(t)) {
        if (t === '~' || t.startsWith('$HOME') || t.startsWith('${HOME}') || t.startsWith('%USERPROFILE%')) {
          return 'recursive delete of home directory'
        }
        if (/^\/(?:home|root|etc|usr|var|bin|sbin|boot|lib)/i.test(stripQuotes(t))) {
          return 'recursive delete of system directory'
        }
        return 'recursive delete of root filesystem'
      }
    }
    return null
  }

  // Windows rmdir /s /q C:\  ·  del /s /q C:\*
  if (cmd === 'rmdir' || cmd === 'del' || cmd === 'erase') {
    const lower = argv.map((a) => a.toLocaleLowerCase())
    const recursive = lower.some((a) => a === '/s' || a === '-s' || a === '/s' || a === '-recurse')
    const force = lower.some((a) => a === '/q' || a === '-q' || a === '/f' || a === '-force')
    if (!recursive) return null
    for (const t of argv.slice(1)) {
      if (t.startsWith('-') || t.startsWith('/')) continue
      if (isCatastrophicDeleteTarget(t)) {
        return force
          ? 'recursive delete of root filesystem'
          : 'recursive delete of root filesystem'
      }
    }
  }
  return null
}

function detectRemoveItemHardline(argv: readonly string[]): string | null {
  // PowerShell Remove-Item -Recurse -Force C:\
  const cmd = executableKey(argv[0] ?? '')
  if (cmd !== 'remove-item' && cmd !== 'ri') return null

  const lower = argv.map((a) => a.toLocaleLowerCase())
  const recursive = lower.some(
    (a) => a === '-recurse' || a === '-r' || a.startsWith('-recurse:') || a === '/r'
  )
  const force = lower.some((a) => a === '-force' || a === '-f' || a.startsWith('-force:'))
  if (!recursive || !force) return null
  for (const t of argv.slice(1)) {
    if (t.startsWith('-') || t.startsWith('/')) continue
    if (isCatastrophicDeleteTarget(t)) return 'recursive delete of root filesystem'
  }
  return null
}

function detectFormatHardline(argv: readonly string[]): string | null {
  const cmd = executableKey(argv[0] ?? '')
  if (cmd === 'mkfs' || cmd.startsWith('mkfs.')) return 'format filesystem (mkfs)'
  if (cmd === 'format') {
    // Windows format C:
    for (const t of argv.slice(1)) {
      if (/^[a-zA-Z]:$/.test(t) || /^[a-zA-Z]:\\?$/.test(t)) return 'format filesystem'
    }
    // format without drive still dangerous enough when used as format.exe
    if (argv.length >= 1) return 'format filesystem'
  }
  return null
}

function detectDdHardline(argv: readonly string[]): string | null {
  const cmd = executableKey(argv[0] ?? '')
  if (cmd !== 'dd') return null
  for (const a of argv) {
    if (/^of=\/dev\/(sd|nvme|hd|mmcblk|vd|xvd)/i.test(a)) {
      return 'dd to raw block device'
    }
    if (/^of=\\\\\.\\PhysicalDrive/i.test(a)) {
      return 'dd to raw block device'
    }
  }
  return null
}

function detectKillAllHardline(argv: readonly string[]): string | null {
  const cmd = executableKey(argv[0] ?? '')
  if (cmd !== 'kill') return null
  // kill -9 -1  /  kill -1  /  kill -s KILL -1
  const tokens = argv.slice(1).map((a) => a.trim())
  if (tokens.some((t) => t === '-1')) return 'kill all processes'
  return null
}

function detectShutdownHardline(argv: readonly string[]): string | null {
  // Strip common wrappers: sudo, env, exec, nohup, setsid, time
  let i = 0
  while (i < argv.length) {
    const k = executableKey(argv[i] ?? '')
    if (k === 'sudo') {
      i += 1
      while (i < argv.length && String(argv[i]).startsWith('-') && argv[i] !== '--') i += 1
      if (argv[i] === '--') i += 1
      continue
    }
    if (k === 'env') {
      i += 1
      while (i < argv.length && /^\w+=/.test(String(argv[i]))) i += 1
      continue
    }
    if (k === 'exec' || k === 'nohup' || k === 'setsid' || k === 'time') {
      i += 1
      continue
    }
    break
  }
  const rest = argv.slice(i)
  const cmd = executableKey(rest[0] ?? '')
  if (cmd === 'shutdown' || cmd === 'reboot' || cmd === 'halt' || cmd === 'poweroff') {
    return 'system shutdown/reboot'
  }
  if (cmd === 'init' || cmd === 'telinit') {
    const arg = String(rest[1] ?? '')
    if (arg === '0' || arg === '6') return 'init 0/6 (shutdown/reboot)'
  }
  if (cmd === 'systemctl') {
    const verb = String(rest[1] ?? '').toLocaleLowerCase()
    if (verb === 'poweroff' || verb === 'reboot' || verb === 'halt' || verb === 'kexec') {
      return 'systemctl poweroff/reboot'
    }
  }
  // Windows
  if (cmd === 'shutdown') return 'system shutdown/reboot'
  return null
}

/** Classic fork bomb as a single string token or joined command text. */
function detectForkBomb(text: string): string | null {
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(text)) return 'fork bomb'
  return null
}

/** Scan free-form command text (bash -lc payload) for hardline patterns. */
function detectHardlineInText(text: string): string | null {
  const s = String(text ?? '')
  if (!s.trim()) return null

  const fork = detectForkBomb(s)
  if (fork) return fork

  // rm -rf / and variants (command-ish; not perfect shell parse)
  const rmRoot =
    /(?:^|[;&|\n`]|\$\()\s*(?:sudo\s+)*rm\s+(?:-[^\s]*\s+)*(?:["']?\/(?:(?:\.\.?)?\/)*(?:\.\.?)?\**["']?|["']?(?:~|\$\{?HOME\}?)(?:\/\*)?["']?|["']?\/(?:home|root|etc|usr|var|bin|sbin|boot)(?:\/\*)?["']?)(?:\s|$|[)`;|&])/i
  if (rmRoot.test(s)) {
    if (/~|\$\{?HOME\}?/i.test(s) && /rm\s+/i.test(s)) return 'recursive delete of home directory'
    if (/\/(?:home|root|etc|usr|var|bin|sbin|boot)/i.test(s)) {
      return 'recursive delete of system directory'
    }
    return 'recursive delete of root filesystem'
  }

  if (/\bmkfs(\.[a-z0-9]+)?\b/i.test(s)) return 'format filesystem (mkfs)'
  if (/\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|hd|mmcblk|vd|xvd)/i.test(s)) {
    return 'dd to raw block device'
  }
  if (/>\s*\/dev\/(sd|nvme|hd|mmcblk|vd|xvd)[a-z0-9]*/i.test(s)) {
    return 'redirect to raw block device'
  }
  if (/\bkill\s+(?:-[^\s]+\s+)*-1\b/i.test(s)) return 'kill all processes'

  // shutdown/reboot at command position
  if (
    /(?:^|[;&|\n`]|\$\()\s*(?:sudo\s+)*(?:env\s+(?:\w+=\S*\s+)*)*(?:(?:exec|nohup|setsid|time)\s+)*(shutdown|reboot|halt|poweroff)\b/i.test(
      s
    )
  ) {
    return 'system shutdown/reboot'
  }
  if (/(?:^|[;&|\n`]|\$\()\s*(?:sudo\s+)*(?:init|telinit)\s+[06]\b/i.test(s)) {
    return 'init 0/6 (shutdown/reboot)'
  }
  if (
    /(?:^|[;&|\n`]|\$\()\s*(?:sudo\s+)*systemctl\s+(poweroff|reboot|halt|kexec)\b/i.test(s)
  ) {
    return 'systemctl poweroff/reboot'
  }

  return null
}

/**
 * Detect catastrophic commands that must never run via workspace shell.
 * Accepts argv (primary) and optional raw command string (bash -lc body).
 */
export function detectHardlineCommand(input: {
  argv?: readonly string[]
  command?: string
}): HardlineDecision {
  const argv = input.argv ? [...input.argv] : []
  const joined = argv.length ? joinArgvForHardlineScan(argv) : ''
  const commandText = String(input.command ?? '').trim()

  const descriptions: Array<string | null> = []

  if (argv.length) {
    descriptions.push(detectRmHardline(argv))
    descriptions.push(detectRemoveItemHardline(argv))
    descriptions.push(detectFormatHardline(argv))
    descriptions.push(detectDdHardline(argv))
    descriptions.push(detectKillAllHardline(argv))
    descriptions.push(detectShutdownHardline(argv))
    descriptions.push(detectForkBomb(joined))
  }

  // Also scan joined argv and optional command payload (shell -c bodies).
  if (joined) descriptions.push(detectHardlineInText(joined))
  if (commandText) descriptions.push(detectHardlineInText(commandText))

  // When argv is a shell wrapper, scan -c/-Command payload tokens.
  if (argv.length >= 3) {
    const cmd = executableKey(argv[0] ?? '')
    for (let i = 1; i < argv.length; i++) {
      const a = String(argv[i] ?? '')
      const lower = a.toLocaleLowerCase()
      if (
        a === '-c' ||
        a === '-lc' ||
        lower === '-command' ||
        lower === '/c' ||
        lower === '-c' ||
        /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)
      ) {
        const payload = argv[i + 1]
        if (payload) descriptions.push(detectHardlineInText(String(payload)))
      }
    }
    if (cmd === 'bash' || cmd === 'sh' || cmd === 'zsh' || cmd === 'pwsh' || cmd === 'powershell' || cmd === 'cmd') {
      // no-op; payload scan above covers
    }
  }

  const hit = descriptions.find((d): d is string => typeof d === 'string' && d.length > 0)
  if (!hit) return { blocked: false }

  return {
    blocked: true,
    code: 'hardline_denied',
    description: hit,
    reason: `BLOCKED (hardline): ${hit}. This command is on the unconditional denylist and cannot run under any approvalMode (including 本课放行 / full_access).`
  }
}

export function assertNotHardline(input: {
  argv?: readonly string[]
  command?: string
}): HardlineDecision {
  return detectHardlineCommand(input)
}
