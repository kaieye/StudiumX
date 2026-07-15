import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const raceControl = { afterLink: null as (() => Promise<void>) | null }

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    link: async (existingPath: string, newPath: string) => {
      await actual.link(existingPath, newPath)
      await raceControl.afterLink?.()
    }
  }
})

const { readContainedRegularFileBounded } = await import('../../src/main/path-access')

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-bounded-read-unit-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  raceControl.afterLink = null
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

  it('fails closed when the final file is replaced after the bounded snapshot is linked', async () => {
    const root = await workspace()
    const target = join(root, 'courses', 'lesson.html')
    const replacement = join(root, 'courses', 'replacement.html')
    await mkdir(join(root, 'courses'), { recursive: true })
    await writeFile(target, 'trusted', 'utf8')
    await writeFile(replacement, 'attacker', 'utf8')
    raceControl.afterLink = async () => {
      await rename(replacement, target)
    }

    await expect(readContainedRegularFileBounded(root, target, 512 * 1024)).rejects.toThrow('Final file identity changed')
  })

  it('fails closed when a parent path is swapped to a junction after the bounded snapshot is linked', async () => {
    const root = await workspace()
    const courses = join(root, 'courses')
    const target = join(courses, 'lesson.html')
    const movedCourses = join(root, 'courses-original')
    const outside = join(root, 'outside')
    await mkdir(courses, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(target, 'trusted', 'utf8')
    await writeFile(join(outside, 'lesson.html'), 'attacker', 'utf8')
    raceControl.afterLink = async () => {
      await rename(courses, movedCourses)
      await symlink(outside, courses, 'junction')
    }

    await expect(readContainedRegularFileBounded(root, target, 512 * 1024)).rejects.toThrow()
  })
})
