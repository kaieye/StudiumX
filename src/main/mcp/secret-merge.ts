/**
 * Materialize renderer secret markers into durable main-process refs.
 * Plaintext is accepted only through the one-way `secretChanges` payload.
 */

import {
  MCP_SECRET_REF_KEEP,
  MCP_SECRET_REF_PENDING,
  type McpSecretInputChanges,
  type UserMcpServerV1
} from '../../shared/mcp/types'
import type { McpSecretEnvResolver } from './secret-env'

export type MaterializedMcpServerSecrets = Readonly<{
  servers: readonly UserMcpServerV1[]
  /** Newly allocated refs to clean up when the config write fails. */
  createdRefs: readonly string[]
  /** Old refs no longer referenced after a successful config write. */
  refsToForget: readonly string[]
}>

/**
 * Resolve transient keep/pending markers key-by-key.
 *
 * - missing key means delete it;
 * - `keep` reuses only the same server/key's prior ref;
 * - `pending` allocates a fresh encrypted ref from the one-way plaintext payload;
 * - arbitrary renderer-provided ref ids are rejected to prevent cross-server ref reuse.
 */
export function materializeMcpServerSecrets(input: {
  nextServers: readonly UserMcpServerV1[]
  previousServers: readonly UserMcpServerV1[]
  secretChanges?: McpSecretInputChanges
  secrets: McpSecretEnvResolver
}): MaterializedMcpServerSecrets {
  const previousById = new Map(input.previousServers.map((server) => [server.id, server]))
  const createdRefs: string[] = []
  let servers: UserMcpServerV1[]
  try {
    servers = input.nextServers.map((server) => {
      const previous = previousById.get(server.id)
      const changes = input.secretChanges?.[server.id]
      return {
        ...server,
        envSecretRefs: materializeSecretMap({
          serverId: server.id,
          kind: 'env',
          next: server.envSecretRefs,
          previous: previous?.envSecretRefs ?? {},
          plaintext: changes?.env ?? {},
          secrets: input.secrets,
          createdRefs
        }),
        headersSecretRefs: materializeSecretMap({
          serverId: server.id,
          kind: 'headers',
          next: server.headersSecretRefs,
          previous: previous?.headersSecretRefs ?? {},
          plaintext: changes?.headers ?? {},
          secrets: input.secrets,
          createdRefs
        })
      }
    })
  } catch (error) {
    for (const refId of createdRefs) input.secrets.forget(refId)
    throw error
  }

  const nextRefs = new Set(
    servers.flatMap((server) => [
      ...Object.values(server.envSecretRefs),
      ...Object.values(server.headersSecretRefs)
    ])
  )
  const refsToForget = input.previousServers
    .flatMap((server) => [
      ...Object.values(server.envSecretRefs),
      ...Object.values(server.headersSecretRefs)
    ])
    .filter((refId) => !nextRefs.has(refId))

  return { servers, createdRefs, refsToForget }
}

function materializeSecretMap(input: {
  serverId: string
  kind: 'env' | 'headers'
  next: Readonly<Record<string, string>>
  previous: Readonly<Record<string, string>>
  plaintext: Readonly<Record<string, string>>
  secrets: McpSecretEnvResolver
  createdRefs: string[]
}): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [key, marker] of Object.entries(input.next)) {
    if (marker === MCP_SECRET_REF_KEEP) {
      const previousRef = input.previous[key]
      if (!previousRef) {
        throw new Error(`${input.serverId}.${input.kind}.${key} has no configured secret to keep`)
      }
      output[key] = previousRef
      continue
    }
    if (marker === MCP_SECRET_REF_PENDING) {
      if (!Object.prototype.hasOwnProperty.call(input.plaintext, key)) {
        throw new Error(`${input.serverId}.${input.kind}.${key} is missing secret input`)
      }
      const refId = input.secrets.store(null, input.plaintext[key] ?? '')
      input.createdRefs.push(refId)
      output[key] = refId
      continue
    }
    throw new Error(`${input.serverId}.${input.kind}.${key} contains an invalid secret marker`)
  }
  return output
}
