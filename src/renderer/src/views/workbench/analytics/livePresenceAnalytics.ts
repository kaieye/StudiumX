/**
 * Live room-presence snapshot for the analytics page's peer percentile card.
 *
 * The teaching server never produces a presence section ("Presence is a live
 * renderer snapshot, not Teaching history"). This module computes that live
 * snapshot from the room roster the workbench already maintains: the merged
 * leaderboard members (server-synced study-room roster + MQTT relay peers,
 * deduplicated per account) plus the local user's same-day focus.
 *
 * Pure functions — no I/O, no React. `null` means no peer comparison is
 * possible (only the local user is in the room), so the card keeps its empty
 * state.
 */

import type { PresenceSnapshotAnalytics } from './types'

export type LivePresenceMember = {
  focusSecondsToday: number
  isSelf?: boolean
}

function nonNegativeFocus(seconds: number): number {
  return Math.max(0, Math.floor(seconds))
}

/**
 * Build a live PresenceSnapshotAnalytics from the room roster.
 *
 * `selfPercentile` is the fraction of peers whose same-day focus is strictly
 * below the local user's, clamped to [0, 1]. Returns null when there are no
 * peers to compare against.
 */
export function buildLivePresenceSnapshot(input: {
  spaceCode: string
  myFocusSecondsToday: number
  members: readonly LivePresenceMember[]
  capturedAt: string
}): PresenceSnapshotAnalytics | null {
  const peers = input.members
    .filter((member) => member.isSelf !== true)
    .map((member) => nonNegativeFocus(member.focusSecondsToday))

  if (peers.length === 0) return null

  const myFocus = nonNegativeFocus(input.myFocusSecondsToday)
  const strictlyBelow = peers.reduce(
    (count, peerFocus) => count + (peerFocus < myFocus ? 1 : 0),
    0
  )
  const selfPercentile = Math.min(1, Math.max(0, strictlyBelow / peers.length))
  const peerFocusSecondsToday = Math.round(
    peers.reduce((sum, focus) => sum + focus, 0) / peers.length
  )

  return {
    capturedAt: input.capturedAt,
    spaceCode: input.spaceCode,
    online: input.members.length,
    roomCapacityPercent: null,
    peerFocusSecondsToday,
    selfPercentile,
    eventCounts: {}
  }
}
