/** Pure advisory policy for workspace writes. Filesystem checks remain caller-owned. */
export type Decision = 'allow' | 'ask' | 'deny'

export type WorkspaceWritePolicyInput = Readonly<{
  path: string
  overwrite?: boolean
  approvalMode?: 'request_approval' | 'based_on_approval' | 'full_access' | string
  denyGlobs?: readonly string[]
  askGlobs?: readonly string[]
}>

export function decideWorkspaceWrite(input: WorkspaceWritePolicyInput): Decision {
  const path = normalizeRelativePath(input.path)
  if (!path) return 'deny'
  if (matchesAny(path, input.denyGlobs)) return 'deny'
  if (matchesAny(path, input.askGlobs)) return 'ask'
  if (input.approvalMode === 'full_access') return 'allow'
  if (input.approvalMode === 'request_approval') return 'ask'
  if (input.overwrite === true) return 'ask'
  return input.approvalMode === 'based_on_approval' || input.approvalMode === undefined ? 'allow' : 'ask'
}

export function normalizeRelativePath(value: string): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim().split(String.fromCharCode(92)).join('/')
  if (!candidate || candidate.startsWith('/') || /^[A-Za-z]:\//.test(candidate)) return null
  const parts: string[] = []
  for (const part of candidate.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length > 0 ? parts.join('/') : null
}

function matchesAny(path: string, globs: readonly string[] | undefined): boolean {
  return Boolean(globs?.some((glob) => globMatches(path, glob)))
}

function globMatches(path: string, glob: string): boolean {
  const pattern = glob.trim().split(String.fromCharCode(92)).join('/')
  if (!pattern) return false
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') { source += '.*'; index += 1 }
      else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else source += /[\^$.*+?()[\]{}|]/.test(char) ? `\${char}` : char
  }
  return new RegExp(`^${source}$`).test(path)
}
