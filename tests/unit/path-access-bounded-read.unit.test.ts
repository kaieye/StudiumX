import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { readContainedRegularFileBounded } from '../../src/main/path-access'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-bounded-read-unit-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('readContainedRegularFileBounded', () => {
  it('returns over_limit for a 512 KiB + 1 regular file without returning its content', async () => {
    const root = await workspace()
    const target = join(root, 'courses', 'lesson.html')
    const maxBytes = 512 * 1024
    await mkdir(join(root, 'courses'), { recursive: true })
    await writeFile(target, Buffer.alloc(maxBytes + 1, 120))

    await expect(readContainedRegularFileBounded(root, target, maxBytes)).resolves.toEqual({ status: 'over_limit' })
  })

  it('returns over_limit for a clearly larger regular file without returning its content', async () => {
    const root = await workspace()
    const target = join(root, 'courses', 'lesson.html')
    const maxBytes = 512 * 1024
    await mkdir(join(root, 'courses'), { recursive: true })
    await writeFile(target, Buffer.alloc(4 * 1024 * 1024, 120))

    await expect(readContainedRegularFileBounded(root, target, maxBytes)).resolves.toEqual({ status: 'over_limit' })
  })
})
