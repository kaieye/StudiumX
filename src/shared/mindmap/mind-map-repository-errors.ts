/**
 * Stable marker for a canonical mind-map document that no longer exists on
 * disk. Electron serializes rejected Error objects by message, so this marker
 * is deliberately part of the message and can be recognized safely by the
 * renderer without exposing an absolute workspace path.
 */
export const MIND_MAP_DOCUMENT_NOT_FOUND_ERROR_MARKER = 'mind_map_document_not_found'

/** Path-safe message used across the repository and IPC boundary. */
export const MIND_MAP_DOCUMENT_NOT_FOUND_ERROR_MESSAGE =
  `${MIND_MAP_DOCUMENT_NOT_FOUND_ERROR_MARKER}: Mind map document not found.`
