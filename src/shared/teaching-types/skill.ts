import type { SkillOrchestrationEligibility } from './skill-orchestration'

import { z } from 'zod'

export type SkillCategory = 'learning' | 'productivity' | 'development' | 'lifestyle' | 'other'

export const SKILL_PACK_SCHEMA_VERSION = 1 as const
export const SKILL_PACK_CAPABILITIES = ['read-resources', 'read-shared-resources'] as const
export const SKILL_PACK_RESOURCE_KINDS = ['instructions', 'reference', 'template'] as const

export type SkillPackCapability = (typeof SKILL_PACK_CAPABILITIES)[number]
export type SkillPackResourceKind = (typeof SKILL_PACK_RESOURCE_KINDS)[number]

const SAFE_SKILL_PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function isSafeManifestResourcePath(value: string): boolean {
  if (!value || value.includes('\\') || value.includes('\0') || value.startsWith('/')) return false
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.')) return false
  if (value.startsWith('../_shared/')) {
    return parts.length > 2 && parts[0] === '..' && parts[1] === '_shared' && parts.slice(2).every((part) => part !== '..')
  }
  return parts.every((part) => part !== '..')
}

export const skillPackResourceSchema = z.object({
  path: z.string().min(1).max(240).refine(isSafeManifestResourcePath, 'Invalid skill resource path.'),
  kind: z.enum(SKILL_PACK_RESOURCE_KINDS)
}).strict()

export const skillPackManifestSchema = z.object({
  schemaVersion: z.literal(SKILL_PACK_SCHEMA_VERSION),
  id: z.string().min(1).max(80).regex(SAFE_SKILL_PACK_ID),
  version: z.string().min(1).max(80).regex(SEMVER),
  capabilities: z.array(z.enum(SKILL_PACK_CAPABILITIES)).max(SKILL_PACK_CAPABILITIES.length),
  resources: z.array(skillPackResourceSchema).min(1).max(128)
}).strict().superRefine((manifest, context) => {
  const capabilities = new Set(manifest.capabilities)
  if (capabilities.size !== manifest.capabilities.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilities'], message: 'Duplicate skill capability.' })
  }

  const paths = new Set<string>()
  for (const [index, resource] of manifest.resources.entries()) {
    if (paths.has(resource.path)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['resources', index, 'path'], message: 'Duplicate skill resource.' })
    }
    paths.add(resource.path)
  }

  const instructions = manifest.resources.filter((resource) => resource.path === 'SKILL.md')
  if (instructions.length !== 1 || instructions[0]?.kind !== 'instructions') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resources'],
      message: 'A skill pack must declare SKILL.md exactly once as instructions.'
    })
  }

  const hasLocalResources = manifest.resources.some((resource) => resource.path !== 'SKILL.md' && !resource.path.startsWith('../_shared/'))
  const hasSharedResources = manifest.resources.some((resource) => resource.path.startsWith('../_shared/'))
  if (hasLocalResources && !capabilities.has('read-resources')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilities'], message: 'Local resources require read-resources.' })
  }
  if (hasSharedResources && (!capabilities.has('read-resources') || !capabilities.has('read-shared-resources'))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilities'], message: 'Shared resources require both read capabilities.' })
  }
  if (!hasLocalResources && !hasSharedResources && capabilities.has('read-resources')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilities'], message: 'read-resources is unused.' })
  }
  if (!hasSharedResources && capabilities.has('read-shared-resources')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilities'], message: 'read-shared-resources is unused.' })
  }
})

export type SkillPackResource = z.infer<typeof skillPackResourceSchema>
export type SkillPackManifest = z.infer<typeof skillPackManifestSchema>

export type SkillSummary = {
  id: string
  name: string
  description: string
  argumentHint?: string
  category: SkillCategory
  icon: string
  author: string
  command: string
  source: 'builtin' | 'personal'
  installed: boolean
  installedPath?: string
  version?: string
  capabilities?: SkillPackCapability[]
  /** Main-process projection of host admission; never supplied by a manifest. */
  orchestration?: SkillOrchestrationEligibility
}

export type SkillCatalogResult = {
  rootPath: string
  skills: SkillSummary[]
}

export type InstallSkillPayload = {
  skillId: string
}

export type InstalledSkillReference = {
  id: string
  name: string
  source: string
  sharedRoot?: string
  content: string
  manifest?: SkillPackManifest
}
