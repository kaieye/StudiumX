import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

import type { InstalledSkillReference } from '../../../shared/teaching-types'
import { isPathInsideRoot } from '../../path-access'
import type { ToolEntry } from './registry'

const MAX_SKILL_RESOURCE_BYTES = 256 * 1024
const MAX_SKILL_RESOURCE_CHARS = 24_000
const DEFAULT_LINE_LIMIT = 240
const MAX_LINE_LIMIT = 800

type SkillResourceRoot = {
  id: string
  name: string
  root: string
  sharedRoot?: string
}

export function createReadSkillResourceTool(skillReferences: InstalledSkillReference[]): ToolEntry | null {
  const roots = skillReferences
    .map((reference): SkillResourceRoot | null => {
      if (!reference.source || basename(reference.source) !== 'SKILL.md') return null
      return {
        id: reference.id,
        name: reference.name,
        root: dirname(reference.source),
        sharedRoot: reference.sharedRoot
      }
    })
    .filter((root): root is SkillResourceRoot => Boolean(root))

  if (roots.length === 0) return null

  return {
    definition: {
      type: 'function',
      function: {
        name: 'read_skill_resource',
        description:
          'Read a referenced text file from one of the slash-invoked StudiumX skill directories. Use this only after the loaded SKILL.md points to an extra resource that is relevant to the current turn.',
        parameters: {
          type: 'object',
          properties: {
            skillId: {
              type: 'string',
              description: 'The invoked skill id, for example "teach".'
            },
            path: {
              type: 'string',
              description: 'A relative path inside that skill directory, for example "MISSION-FORMAT.md" or "references/scenarios.md".'
            },
            offset: {
              type: 'number',
              description: '0-based starting line, default 0.',
              minimum: 0
            },
            limit: {
              type: 'number',
              description: 'Maximum lines to return, default 240, max 800.',
              minimum: 1,
              maximum: 800
            }
          },
          required: ['skillId', 'path']
        }
      }
    },
    handler: async (args: unknown): Promise<string> => {
      try {
        const input = (args ?? {}) as { skillId?: string; path?: string; offset?: number; limit?: number }
        const skillId = input.skillId?.trim().toLocaleLowerCase()
        if (!skillId) throw new Error('Missing skillId.')
        const root = roots.find((candidate) => candidate.id.toLocaleLowerCase() === skillId)
        if (!root) {
          throw new Error(`Skill "${skillId}" was not invoked for this turn.`)
        }
        const resourcePath = input.path?.trim()
        if (!resourcePath) throw new Error('Missing path.')
        if (isAbsolute(resourcePath)) throw new Error('Use a relative skill resource path.')
        const realRoot = await realpath(root.root)
        const absolutePath = resolve(realRoot, resourcePath)
        const sharedRoot = shouldReadSharedSkillResource(resourcePath, root.sharedRoot)
          ? await resolveSharedSkillRoot(realRoot, root.sharedRoot as string)
          : null
        const containmentRoot = isPathInsideRoot(realRoot, absolutePath)
          ? realRoot
          : sharedRoot && isPathInsideRoot(sharedRoot, absolutePath)
            ? sharedRoot
            : null
        if (!containmentRoot) {
          throw new Error('Skill resource path escapes the invoked skill directory.')
        }
        const realTarget = await realpath(absolutePath)
        if (!isPathInsideRoot(containmentRoot, realTarget)) {
          throw new Error('Skill resource path escapes the invoked skill directory.')
        }
        const info = await stat(realTarget)
        if (!info.isFile()) throw new Error('Skill resource target is not a file.')
        if (info.size > MAX_SKILL_RESOURCE_BYTES) {
          throw new Error(`Skill resource is too large (${info.size} bytes).`)
        }
        const text = await readFile(realTarget, 'utf8')
        const offset = clampInteger(input.offset, 0, Number.MAX_SAFE_INTEGER, 0)
        const limit = clampInteger(input.limit, 1, MAX_LINE_LIMIT, DEFAULT_LINE_LIMIT)
        const window = lineWindow(text, offset, limit)
        const relativePath = containmentRoot === realRoot
          ? toPosixPath(relative(realRoot, realTarget))
          : `../_shared/${toPosixPath(relative(containmentRoot, realTarget))}`
        const content = window.lines.join('\n')
        return JSON.stringify({
          skillId: root.id,
          skillName: root.name,
          path: relativePath,
          totalLines: window.totalLines,
          offset,
          limit,
          nextOffset: window.nextOffset,
          content: content.slice(0, MAX_SKILL_RESOURCE_CHARS),
          contentTruncated: content.length > MAX_SKILL_RESOURCE_CHARS
        }, null, 2)
      } catch (error) {
        return JSON.stringify({
          tool: 'read_skill_resource',
          error: error instanceof Error ? error.message : String(error)
        }, null, 2)
      }
    }
  }
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function lineWindow(text: string, offset: number, limit: number): {
  lines: string[]
  totalLines: number
  nextOffset: number | null
} {
  const all = text.split(/\r?\n/)
  const start = Math.min(Math.max(0, offset), all.length)
  const shown = all.slice(start, start + limit)
  const nextOffset = start + shown.length < all.length ? start + shown.length : null
  const width = String(start + shown.length).length
  return {
    lines: shown.map((line, idx) => `${String(start + idx + 1).padStart(width, ' ')}| ${line}`),
    totalLines: all.length,
    nextOffset
  }
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}

function shouldReadSharedSkillResource(resourcePath: string, sharedRoot: string | undefined): boolean {
  if (!sharedRoot) return false
  const normalized = toPosixPath(resourcePath)
  return normalized === '../_shared' || normalized.startsWith('../_shared/')
}

async function resolveSharedSkillRoot(realSkillRoot: string, configuredSharedRoot: string): Promise<string | null> {
  const realSharedRoot = await realpath(configuredSharedRoot).catch(() => null)
  if (!realSharedRoot) return null
  const relativeToPack = toPosixPath(relative(dirname(realSkillRoot), realSharedRoot))
  return relativeToPack === '_shared' ? realSharedRoot : null
}
