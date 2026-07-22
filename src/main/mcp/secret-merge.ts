/**
 * Preserve secret refs / plain env when renderer saves a secret-free public view
 * (ADR-0128 §3 / §8: renderer never holds secret plaintext).
 */

import type { UserMcpServerV1 } from '../../shared/mcp/types'

/**
 * Merge durable secret-bearing fields from the previous on-disk server list
 * into a newly parsed config document, keyed by server id.
 *
 * Rules:
 * - If the new server has empty envSecretRefs / headersSecretRefs / envPlain,
 *   reuse previous values for the same id.
 * - Non-empty maps on the new document win (explicit replace).
 * - Unknown previous ids (removed servers) are dropped.
 */
export function mergeMcpServerSecretsFromPrevious(
  nextServers: readonly UserMcpServerV1[],
  previousServers: readonly UserMcpServerV1[]
): UserMcpServerV1[] {
  const previousById = new Map(previousServers.map((server) => [server.id, server]))
  return nextServers.map((server) => {
    const prev = previousById.get(server.id)
    if (!prev) return server
    return {
      ...server,
      envSecretRefs:
        Object.keys(server.envSecretRefs).length > 0
          ? server.envSecretRefs
          : prev.envSecretRefs,
      headersSecretRefs:
        Object.keys(server.headersSecretRefs).length > 0
          ? server.headersSecretRefs
          : prev.headersSecretRefs,
      envPlain:
        Object.keys(server.envPlain).length > 0 ? server.envPlain : prev.envPlain
    }
  })
}
