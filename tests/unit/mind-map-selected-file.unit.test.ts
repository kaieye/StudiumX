import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  MIND_MAP_SELECTED_FILE_MAX_BYTES,
  MIND_MAP_NOTES_WORKSPACE_PATH,
  MindMapSelectedFileError,
  normalizeSelectedFileWorkspacePath,
  resolveMindMapNotes,
  resolveSelectedMindMapFile
} from '../../src/main/mindmap/mind-map-selected-file'

const roots: string[] = []

async function workspaceRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `studiumx-selected-file-${label}-`))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('normalizeSelectedFileWorkspacePath', () => {
  it('normalizes separators and harmless dot components', () => {
    expect(normalizeSelectedFileWorkspacePath(' notes\\biology/./cells.md ')).toBe('notes/biology/cells.md')
  })

  it.each([
    '',
    '   ',
    '.',
    '..',
    '../outside.txt',
    'notes/../../outside.txt',
    '/private/outside.txt',
    '\\private\\outside.txt',
    '//server/share/outside.txt',
    'C:\\private\\outside.txt',
    'C:/private/outside.txt',
    'notes/unsafe\u0000.md'
  ])('rejects unsafe path %j', (path) => {
    expect(normalizeSelectedFileWorkspacePath(path)).toBeNull()
  })
})

describe('resolveSelectedMindMapFile', () => {
  it('reads one contained regular file and derives stable metadata without absolute paths', async () => {
    const root = await workspaceRoot('valid')
    await mkdir(join(root, 'notes'), { recursive: true })
    const content = 'Cells are the basic unit of life.\n'
    await writeFile(join(root, 'notes', 'biology.md'), content, 'utf8')

    const first = await resolveSelectedMindMapFile(root, 'notes\\biology.md')
    const second = await resolveSelectedMindMapFile(root, 'notes/biology.md')
    const expectedContentHash = createHash('sha256').update(Buffer.from(content)).digest('hex')

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      sourceRef: {
        id: `selected-file:${createHash('sha256').update('notes/biology.md').digest('hex')}`,
        workspacePath: 'notes/biology.md',
        contentHash: expectedContentHash
      },
      content,
      byteLength: Buffer.byteLength(content)
    })
    expect(JSON.stringify(first.sourceRef)).not.toContain(root)
    expect(JSON.stringify(first)).not.toContain(root)
  })

  it('fails closed for missing files, oversized files, links, and directories', async () => {
    const root = await workspaceRoot('failures')
    await mkdir(join(root, 'notes'), { recursive: true })
    await writeFile(join(root, 'notes', 'large.md'), '12345', 'utf8')
    await writeFile(join(root, 'notes', 'real.md'), 'safe', 'utf8')
    await symlink(join(root, 'notes', 'real.md'), join(root, 'notes', 'link.md'))

    await expect(resolveSelectedMindMapFile(root, 'notes/missing.md')).rejects.toMatchObject({
      name: 'MindMapSelectedFileError',
      code: 'missing_file'
    })
    await expect(resolveSelectedMindMapFile(root, 'notes/large.md', 4)).rejects.toMatchObject({
      name: 'MindMapSelectedFileError',
      code: 'over_limit'
    })
    await expect(resolveSelectedMindMapFile(root, 'notes/link.md')).rejects.toMatchObject({
      name: 'MindMapSelectedFileError',
      code: 'unsafe_path'
    })
    await expect(resolveSelectedMindMapFile(root, 'notes')).rejects.toMatchObject({
      name: 'MindMapSelectedFileError',
      code: 'unsafe_path'
    })
  })

  it('rejects invalid paths before touching the filesystem', async () => {
    const root = await workspaceRoot('invalid')
    const invalidPaths = ['../escape', '/tmp/escape', 'C:\\escape', '\\\\server\\share', 'bad\u0000name']
    for (const path of invalidPaths) {
      await expect(resolveSelectedMindMapFile(root, path)).rejects.toMatchObject({
        name: 'MindMapSelectedFileError',
        code: 'invalid_path'
      })
    }
  })

  it('keeps the default context bounded by the configured byte limit', async () => {
    const root = await workspaceRoot('bounded')
    const content = Buffer.alloc(MIND_MAP_SELECTED_FILE_MAX_BYTES, 0x61)
    await writeFile(join(root, 'bounded.txt'), content)
    const result = await resolveSelectedMindMapFile(root, 'bounded.txt')
    expect(result.byteLength).toBe(MIND_MAP_SELECTED_FILE_MAX_BYTES)
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(MIND_MAP_SELECTED_FILE_MAX_BYTES)
  })

  it('resolves the fixed NOTES.md source without accepting a renderer path', async () => {
    const root = await workspaceRoot('notes')
    const content = '# Notes\nRemember spaced repetition.\n'
    await writeFile(join(root, MIND_MAP_NOTES_WORKSPACE_PATH), content, 'utf8')

    const first = await resolveMindMapNotes(root)
    const second = await resolveMindMapNotes(root)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      sourceRef: {
        id: expect.stringMatching(/^notes:[a-f0-9]{64}$/),
        workspacePath: MIND_MAP_NOTES_WORKSPACE_PATH,
        contentHash: createHash('sha256').update(Buffer.from(content)).digest('hex')
      },
      content,
      byteLength: Buffer.byteLength(content)
    })
    expect(JSON.stringify(first)).not.toContain(root)
  })

  it('exposes only a renderer-safe typed error message', () => {
    const error = new MindMapSelectedFileError('unsafe_path', 'safe message')
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('unsafe_path')
    expect(error.message).toBe('safe message')
  })
})
