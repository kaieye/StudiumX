/**
 * User-previewable, consent-gated support bundle (P2-8).
 *
 * Preview is redacted by default: no raw prompts, no secrets, no full absolute
 * home paths, and no learner answers. Export requires explicit consent and only
 * includes sections the user allowed after preview.
 */

export const SUPPORT_BUNDLE_SCHEMA_VERSION = 1 as const

export type SupportBundleSchemaVersion = typeof SUPPORT_BUNDLE_SCHEMA_VERSION

/** Stable section IDs for preview + export allowlisting. */
export type SupportBundleSectionId =
  | 'doctor'
  | 'inspector'
  | 'config_fingerprint'
  | 'capability'
  | 'audit_correlation'
  | 'environment'

/**
 * Documented redaction policy carried on every export so support recipients
 * know what was stripped by default.
 */
export type RedactionPolicy = {
  /** Raw model / user prompts are never included. */
  noRawPrompts: true
  /** Provider API keys and secret-shaped tokens are redacted. */
  noApiKeys: true
  /** Absolute host / home paths are rewritten to workspace-relative or a stub. */
  noAbsoluteHomePaths: true
  /** Full learner answers and assessment free-text are never included. */
  noLearnerAnswers: true
  description: string
}

export const DEFAULT_SUPPORT_BUNDLE_REDACTION_POLICY: RedactionPolicy = {
  noRawPrompts: true,
  noApiKeys: true,
  noAbsoluteHomePaths: true,
  noLearnerAnswers: true,
  description:
    'Support bundle is redacted by default: no raw prompts, no API keys/secrets, no absolute home paths, no learner answers.'
}

/** JSON-safe payload tree after redaction (no functions, no bigint, no circular refs). */
export type SupportBundleJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly SupportBundleJsonValue[]
  | { readonly [key: string]: SupportBundleJsonValue }

export type SupportBundleSectionPreview = {
  id: SupportBundleSectionId
  title: string
  /** Redacted, JSON-safe payload safe for user preview. */
  payload: SupportBundleJsonValue
  warnings: readonly string[]
}

export type SupportBundlePreview = {
  schemaVersion: SupportBundleSchemaVersion
  generatedAt: string
  sections: readonly SupportBundleSectionPreview[]
  warnings: readonly string[]
  redactionPolicy: RedactionPolicy
}

/**
 * Explicit user consent required before export.
 * `accepted` is a literal `true` so partial/omitted consent cannot pass.
 */
export type SupportBundleConsent = {
  accepted: true
  acceptedAt: string
  sectionsAllowed: readonly SupportBundleSectionId[]
}

export type SupportBundleSectionExport = {
  id: SupportBundleSectionId
  title: string
  payload: SupportBundleJsonValue
  warnings: readonly string[]
}

export type SupportBundleExport = {
  schemaVersion: SupportBundleSchemaVersion
  exportedAt: string
  consent: SupportBundleConsent
  sections: readonly SupportBundleSectionExport[]
  redactionPolicy: RedactionPolicy
}

export type SupportBundleExportFailureCode = 'consent_required' | 'section_not_previewed'

export type SupportBundleExportFailure = {
  ok: false
  code: SupportBundleExportFailureCode
  message: string
}

export type SupportBundleExportResult = SupportBundleExport | SupportBundleExportFailure
