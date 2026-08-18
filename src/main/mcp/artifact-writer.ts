import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { writeContentAddressedFile } from '../path-access'
import type { McpArtifactReference, McpArtifactWriter } from '../../shared/mcp/result-types'
import type { McpArtifactKind } from '../../shared/mcp/result-types'

const ARTIFACT_ID_PREFIX = 'mcp-artifact:sha256:'
const DIGEST_PREFIX_LENGTH = 16

export type LocalMcpArtifactWriterOptions = Readonly<{
  /** Main-process-controlled local directory. It is never returned in a reference. */
  rootPath: string
}>

/**
 * Content-addressed, local-only MCP artifact writer (ADR-0013).
 *
 * This class intentionally has no lookup/read API: a returned reference is
 * metadata only, not a capability. Future retention/read flows require their
 * own explicitly-reviewed contract.
 */
export class LocalMcpArtifactWriter implements McpArtifactWriter {
  private readonly rootPath: string

  constructor(options: LocalMcpArtifactWriterOptions) {
    if (!options.rootPath.trim()) throw new Error('MCP artifact root must not be empty.')
    this.rootPath = resolve(options.rootPath)
  }

  async writeArtifact(input: Readonly<{
    kind: McpArtifactKind
    bytes: Uint8Array
    mediaType?: string
  }>): Promise<McpArtifactReference> {
    const content = Buffer.from(input.bytes)
    const digest = createHash('sha256').update(content).digest('hex')
    const targetPath = join(this.rootPath, digest.slice(0, 2), `${digest}.bin`)

    await this.ensurePrivateRoot()
    await writeContentAddressedFile({
      rootPath: this.rootPath,
      targetPath,
      content,
      sha256: digest
    })

    const byteLength = content.byteLength
    const mediaType = normalizeMediaType(input.mediaType)
    return {
      id: `${ARTIFACT_ID_PREFIX}${digest}`,
      kind: input.kind,
      byteLength,
      ...(mediaType ? { mediaType } : {}),
      digestPrefix: digest.slice(0, DIGEST_PREFIX_LENGTH),
      summary: artifactSummary(input.kind, byteLength)
    }
  }

  private async ensurePrivateRoot(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 })
    const info = await lstat(this.rootPath)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('MCP artifact root must be a real directory.')
    }
    // Existing app-data directories can be created by an older version with a
    // wider mode. Tighten this controlled root before creating artifact files.
    await chmod(this.rootPath, 0o700)
  }
}

export function createLocalMcpArtifactWriter(
  options: LocalMcpArtifactWriterOptions
): McpArtifactWriter {
  return new LocalMcpArtifactWriter(options)
}

function normalizeMediaType(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  // Deliberately accept only a bare RFC-ish type/subtype. Parameters can carry
  // opaque server-controlled data and are unnecessary for local display.
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/.test(normalized)) {
    return undefined
  }
  return normalized
}

function artifactSummary(kind: McpArtifactKind, byteLength: number): string {
  return `MCP ${kind} artifact (${byteLength.toLocaleString('en-US')} bytes)`
}
