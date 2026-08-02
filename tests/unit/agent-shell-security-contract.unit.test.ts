/**
 * Stage B security negative matrix for isKnownSafeReadCommand.
 * Fail-closed known-safe contract — auto-allow / read_only eligibility only.
 * ADR-0152 / ADR-0153 Stage B.
 */
import { describe, expect, it } from 'vitest'

import {
  isKnownSafeReadCommand,
  resolveShellArgv
} from '../../src/main/ai/tools/shell-command-safety'

describe('agent-shell known-safe security contract (Stage B)', () => {
  describe('positive allow-list (may tighten later)', () => {
    it('allows pure git status', () => {
      expect(isKnownSafeReadCommand(['git', 'status'])).toBe(true)
      expect(isKnownSafeReadCommand(['git', 'status', '--porcelain'])).toBe(true)
    })

    it('allows other read-only git subcommands', () => {
      expect(isKnownSafeReadCommand(['git', 'log', '-1', '--oneline'])).toBe(true)
      expect(isKnownSafeReadCommand(['git', 'show', 'HEAD'])).toBe(true)
      expect(isKnownSafeReadCommand(['git', 'diff'])).toBe(true)
      expect(isKnownSafeReadCommand(['git', 'rev-parse', 'HEAD'])).toBe(true)
      expect(isKnownSafeReadCommand(['git', 'describe', '--tags'])).toBe(true)
      expect(isKnownSafeReadCommand(['git', 'ls-files'])).toBe(true)
      expect(isKnownSafeReadCommand(['git', 'ls-tree', 'HEAD'])).toBe(true)
      expect(isKnownSafeReadCommand(['git', 'blame', 'README.md'])).toBe(true)
      expect(isKnownSafeReadCommand(['git', 'help', 'status'])).toBe(true)
      expect(isKnownSafeReadCommand(['git', 'version'])).toBe(true)
    })

    it('allows pure status and listing without path escape', () => {
      expect(isKnownSafeReadCommand(['pwd'])).toBe(true)
      expect(isKnownSafeReadCommand(['true'])).toBe(true)
      expect(isKnownSafeReadCommand(['false'])).toBe(true)
      expect(isKnownSafeReadCommand(['uname'])).toBe(true)
      expect(isKnownSafeReadCommand(['whoami'])).toBe(true)
      expect(isKnownSafeReadCommand(['id'])).toBe(true)
      expect(isKnownSafeReadCommand(['echo', 'hi'])).toBe(true)
      expect(isKnownSafeReadCommand(['ls', '-la'])).toBe(true)
      expect(isKnownSafeReadCommand(['ls', 'src'])).toBe(true)
      expect(isKnownSafeReadCommand(['dir'])).toBe(true)
    })
  })

  describe('writable / context-mutating git (S3/S4)', () => {
    it('rejects git config', () => {
      expect(isKnownSafeReadCommand(['git', 'config', 'user.name', 'x'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'config', '--global', 'user.email', 'a@b.c'])).toBe(
        false
      )
    })

    it('rejects git branch / tag / remote and other writers', () => {
      expect(isKnownSafeReadCommand(['git', 'branch', '-D', 'foo'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'branch'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'tag', 'v1'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'remote', '-v'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'checkout', 'main'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'switch', 'main'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'merge', 'main'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'rebase', 'main'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'reset', '--hard'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'clean', '-fd'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'add', '.'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'commit', '-m', 'x'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'push'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'pull'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'fetch'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', 'stash'])).toBe(false)
    })

    it('rejects git context-changing global options even with safe subcommands', () => {
      expect(isKnownSafeReadCommand(['git', '-C', '..', 'status'])).toBe(false)
      expect(
        isKnownSafeReadCommand(['git', '-c', 'diff.external=evil', 'diff'])
      ).toBe(false)
      expect(isKnownSafeReadCommand(['git', '--git-dir', '/tmp/other', 'status'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', '--work-tree', '/tmp/other', 'status'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', '--namespace', 'evil', 'status'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', '--exec-path', '/tmp/bin', 'status'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', '--git-dir=/tmp/other', 'status'])).toBe(false)
      expect(isKnownSafeReadCommand(['git', '--work-tree=/tmp/other', 'status'])).toBe(false)
    })
  })

  describe('path-bearing readers default non-safe (S5)', () => {
    it('rejects absolute and escaping cat/type', () => {
      expect(isKnownSafeReadCommand(['cat', 'C:\\Users\\x\\.ssh\\id_rsa'])).toBe(false)
      expect(isKnownSafeReadCommand(['cat', '/etc/passwd'])).toBe(false)
      expect(isKnownSafeReadCommand(['type', 'C:\\Windows\\System32\\drivers\\etc\\hosts'])).toBe(
        false
      )
      // Even relative path forms stay non-safe for path-bearing readers.
      expect(isKnownSafeReadCommand(['cat', 'README.md'])).toBe(false)
      expect(isKnownSafeReadCommand(['head', '-n', '5', 'README.md'])).toBe(false)
      expect(isKnownSafeReadCommand(['tail', 'log.txt'])).toBe(false)
      expect(isKnownSafeReadCommand(['grep', 'foo', 'src'])).toBe(false)
    })

    it('rejects find with paths / dangerous predicates', () => {
      expect(isKnownSafeReadCommand(['find', '/', '-name', 'x'])).toBe(false)
      expect(isKnownSafeReadCommand(['find', '.', '-name', '*.ts'])).toBe(false)
      expect(isKnownSafeReadCommand(['find', '.', '-delete'])).toBe(false)
      expect(isKnownSafeReadCommand(['find', '.', '-exec', 'rm', '{}', ';'])).toBe(false)
    })

    it('rejects rg including --pre and path forms', () => {
      expect(isKnownSafeReadCommand(['rg', 'foo', 'src'])).toBe(false)
      expect(isKnownSafeReadCommand(['rg', '--pre', 'python', 'foo'])).toBe(false)
      expect(isKnownSafeReadCommand(['rg', '--pre=python', 'foo'])).toBe(false)
      expect(isKnownSafeReadCommand(['rg', '--hostname-bin', 'evil', 'foo'])).toBe(false)
    })

    it('rejects ls/dir with parent traversal or absolute paths', () => {
      expect(isKnownSafeReadCommand(['ls', '..'])).toBe(false)
      expect(isKnownSafeReadCommand(['ls', '../secret'])).toBe(false)
      expect(isKnownSafeReadCommand(['ls', '/etc'])).toBe(false)
      expect(isKnownSafeReadCommand(['ls', 'C:\\Windows'])).toBe(false)
      expect(isKnownSafeReadCommand(['dir', '..\\..'])).toBe(false)
    })
  })

  describe('non-safelist and shell wrappers', () => {
    it('rejects package managers and destructive commands', () => {
      expect(isKnownSafeReadCommand(['npm', 'install'])).toBe(false)
      expect(isKnownSafeReadCommand(['pnpm', 'add', 'x'])).toBe(false)
      expect(isKnownSafeReadCommand(['rm', '-rf', '.'])).toBe(false)
      expect(isKnownSafeReadCommand(['del', '/f', 'x'])).toBe(false)
      expect(isKnownSafeReadCommand(['curl', 'https://example.com'])).toBe(false)
    })

    it('rejects bash -lc / pwsh -Command / cmd /c wrappers from expansions', () => {
      expect(isKnownSafeReadCommand(['bash', '-lc', 'echo hi | wc'])).toBe(false)
      expect(isKnownSafeReadCommand(['bash', '-c', 'rm -rf /'])).toBe(false)
      expect(
        isKnownSafeReadCommand([
          'pwsh',
          '-NoProfile',
          '-Command',
          'echo hi; rm -rf .'
        ])
      ).toBe(false)
      expect(
        isKnownSafeReadCommand([
          'powershell',
          '-NoProfile',
          '-Command',
          'Get-ChildItem'
        ])
      ).toBe(false)
      expect(isKnownSafeReadCommand(['cmd', '/c', 'echo hi'])).toBe(false)
      expect(isKnownSafeReadCommand(['cmd.exe', '/c', 'dir'])).toBe(false)
    })

    it('resolveShellArgv expansions of && / | are never known-safe', () => {
      const piped = resolveShellArgv({ command: 'echo hi | wc' })
      expect('error' in piped).toBe(false)
      if (!('error' in piped)) {
        expect(isKnownSafeReadCommand(piped.argv)).toBe(false)
      }

      const chained = resolveShellArgv({ command: 'echo hi && true' })
      expect('error' in chained).toBe(false)
      if (!('error' in chained)) {
        expect(isKnownSafeReadCommand(chained.argv)).toBe(false)
      }
    })

    it('rejects empty / blank argv', () => {
      expect(isKnownSafeReadCommand([])).toBe(false)
      expect(isKnownSafeReadCommand([''])).toBe(false)
    })
  })
})
