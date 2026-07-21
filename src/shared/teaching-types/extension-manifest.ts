/**
 * Minimal StudiumX extension / plugin manifest.
 *
 * Local-install first: no marketplace, no remote auto-trust.
 * Contributions are declarative; loaders remain fail-closed until a
 * dedicated design gate enables each contribution kind.
 */

export const EXTENSION_MANIFEST_SCHEMA_VERSION = 1 as const

export type ExtensionManifestSchemaVersion = typeof EXTENSION_MANIFEST_SCHEMA_VERSION

export type ExtensionContributionKind =
  | 'skills'
  | 'commands'
  | 'hooks'
  | 'mcpServers'
  | 'lessonStylePacks'
  | 'resourceGrounders'

export type ExtensionUserConfigFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'file'
  | 'directory'

export type ExtensionUserConfigField = Readonly<{
  key: string
  type: ExtensionUserConfigFieldType
  description?: string
  /** When true, values must not appear in logs, doctor evidence, or support bundles. */
  sensitive?: boolean
  default?: string | number | boolean | null
}>

export type ExtensionContribution = Readonly<{
  kind: ExtensionContributionKind
  /** Relative path inside the extension root, POSIX-style. */
  path: string
}>

export type ExtensionManifest = Readonly<{
  schemaVersion: ExtensionManifestSchemaVersion
  id: string
  name: string
  version: string
  description?: string
  /** Directory that contained plugin.json / .studiumx-plugin when installed. */
  rootPath?: string
  enabled?: boolean
  contributions?: readonly ExtensionContribution[]
  userConfig?: readonly ExtensionUserConfigField[]
}>

export function isExtensionManifest(value: unknown): value is ExtensionManifest {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === EXTENSION_MANIFEST_SCHEMA_VERSION &&
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.name === 'string' &&
    record.name.length > 0 &&
    typeof record.version === 'string' &&
    record.version.length > 0
  )
}
