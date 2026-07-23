import { mkdtemp, readFile, readdir, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { LocalMcpArtifactWriter } from '../../src/main/mcp/artifact-writer'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-mcp-artifact-'))
  directories.push(root)
  return root
}

describe('LocalMcpArtifactWriter (ADR-0134)', () => {
  it('writes contained 0600 content-addressed artifacts and returns no filesystem path', async () => {
    const root = await temporaryRoot()
    const writer = new LocalMcpArtifactWriter({ rootPath: root })
    const first = await writer.writeArtifact({
      kind: 'image',
      bytes: Buffer.from('immutable artifact bytes'),
      mediaType: 'image/PNG',
      summary: 'server supplied image'
    })
    const second = await writer.writeArtifact({
      kind: 'image',
      bytes: Buffer.from('immutable artifact bytes'),
      mediaType: 'image/png'
    })

    expect(first.id).toBe(second.id)
    expect(first).toMatchObject({
      id: expect.stringMatching(/^mcp-artifact:sha256:[a-f0-9]{64}$/),
      digestPrefix: expect.stringMatching(/^[a-f0-9]{16}$/),
      byteLength: 24,
      mediaType: 'image/png'
    })
    expect(JSON.stringify(first)).not.toContain(root)
    expect(Object.keys(first)).not.toContain('path')

    const prefixDirectory = join(root, first.id.slice(-64, -62))
    const files = await readdir(prefixDirectory)
    expect(files).toEqual([`${first.id.slice(-64)}.bin`])
    const storedPath = join(prefixDirectory, files[0]!)
    expect(await readFile(storedPath, 'utf8')).toBe('immutable artifact bytes')
    expect((await stat(storedPath)).mode & 0o777).toBe(0o600)
  })

  it('rejects a symbolic-link root instead of following it', async () => {
    const parent = await temporaryRoot()
    const target = await temporaryRoot()
    const linkedRoot = join(parent, 'linked-root')
    await symlink(target, linkedRoot)
    const writer = new LocalMcpArtifactWriter({ rootPath: linkedRoot })

    await expect(writer.writeArtifact({ kind: 'binary', bytes: Buffer.from('x') })).rejects.toThrow(
      'real directory'
    )
  })

  it('generates local summary metadata and rejects untrusted media parameters', async () => {
    const root = await temporaryRoot()
    const writer = new LocalMcpArtifactWriter({ rootPath: root })
    const artifact = await writer.writeArtifact({
      kind: 'audio',
      bytes: Buffer.from([1, 2, 3]),
      mediaType: 'audio/mpeg; token=secret'
    })

    expect(artifact.mediaType).toBeUndefined()
    expect(artifact.summary).toBe('MCP audio artifact (3 bytes)')
    expect(JSON.stringify(artifact)).not.toContain('secret')
  })
})
