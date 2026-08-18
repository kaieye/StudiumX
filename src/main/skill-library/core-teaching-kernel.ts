/**
 * App-shipped Teaching Kernel loader (ADR-0014).
 *
 * Loads the reserved core skill id `teach` from verified builtin roots only.
 * Does not require personal install and never reads personal root for kernel body.
 */

import { join } from 'node:path'

import type { InstalledSkillReference } from '../../shared/teaching-types'
import { resolveUniqueSkillPackDirectory } from './skill-pack-resolver'
import { verifySkillPack } from './skill-pack-verifier'

/** Reserved app-shipped Teaching Kernel skill id (not a settlement writer). */
export const CORE_TEACHING_KERNEL_ID = 'teach' as const

export type CoreTeachingKernelLoadOptions = {
  builtInRoots: string[]
}

export class CoreTeachingKernelError extends Error {
  readonly code: 'core_teaching_kernel_missing' | 'core_teaching_kernel_invalid'
  readonly skillId: string
  readonly diagnostics: string[]

  constructor(
    code: CoreTeachingKernelError['code'],
    message: string,
    options?: { diagnostics?: string[]; cause?: unknown }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'CoreTeachingKernelError'
    this.code = code
    this.skillId = CORE_TEACHING_KERNEL_ID
    this.diagnostics = options?.diagnostics ?? [message]
  }
}

/**
 * Resolve and verify the Teaching Kernel pack under app-shipped builtin roots.
 * Personal installs are never consulted.
 */
export async function loadCoreTeachingKernelReference(
  options: CoreTeachingKernelLoadOptions
): Promise<InstalledSkillReference> {
  const skillId = CORE_TEACHING_KERNEL_ID
  const roots = options.builtInRoots.filter(Boolean)

  if (roots.length === 0) {
    const message = 'Teaching Kernel builtin roots are not configured.'
    throw new CoreTeachingKernelError('core_teaching_kernel_missing', message, {
      diagnostics: [message, 'Configure builtInRoots to include app-shipped builtin-skills.']
    })
  }

  const candidate = await resolveUniqueSkillPackDirectory(roots, skillId)
  if (!candidate) {
    const message = `Teaching Kernel pack "${skillId}" was not found under app-shipped builtin roots.`
    throw new CoreTeachingKernelError('core_teaching_kernel_missing', message, {
      diagnostics: [
        message,
        `Searched ${roots.length} builtin root(s).`,
        'Kernel load does not use personal skill installs (ADR-0014).'
      ]
    })
  }

  let pack
  try {
    pack = await verifySkillPack(candidate.directory, {
      containingRoot: candidate.containingRoot,
      expectedId: skillId,
      manifestRequired: true,
      requireCompleteResourceList: true
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new CoreTeachingKernelError(
      'core_teaching_kernel_invalid',
      `Teaching Kernel pack "${skillId}" failed verification: ${detail}`,
      {
        diagnostics: [
          `Teaching Kernel pack at ${candidate.directory} is corrupt or invalid.`,
          detail,
          'Fail-closed: teaching turns must not proceed without a verified kernel (ADR-0014).'
        ],
        cause: error
      }
    )
  }

  if (!pack) {
    throw new CoreTeachingKernelError(
      'core_teaching_kernel_invalid',
      `Teaching Kernel pack "${skillId}" could not be verified.`,
      {
        diagnostics: [
          `Missing or incomplete pack under ${candidate.directory}.`,
          'Fail-closed: empty kernel content is not allowed.'
        ]
      }
    )
  }

  const { source, content, metadata } = pack.instructions
  if (!content.trim()) {
    throw new CoreTeachingKernelError(
      'core_teaching_kernel_invalid',
      `Teaching Kernel pack "${skillId}" has empty SKILL.md content.`,
      {
        diagnostics: ['Kernel instructions are empty after verification.', source]
      }
    )
  }

  return {
    id: skillId,
    name: metadata.name || skillId,
    source,
    ...(pack.manifest.capabilities.includes('read-shared-resources')
      ? { sharedRoot: join(candidate.containingRoot, '_shared') }
      : {}),
    content,
    manifest: pack.manifest
  }
}

export function isCoreTeachingKernelId(skillId: string): boolean {
  return skillId.trim().toLocaleLowerCase() === CORE_TEACHING_KERNEL_ID
}
