import {
  formatStudySeatLabel,
  studyMemberFreshnessLabel,
  studyMemberStatusLabel,
  studySignalLabel,
  studySignalShortLabel
} from './domain'
import type { StudyPresencePeer, StudySnapshot } from './types'

export type StudySeatMapAisleItem = {
  kind: 'aisle'
  key: string
  label: string
}

export type StudySeatMapSeatItem = {
  kind: 'seat'
  key: string
  seatIndex: number
  className: string
  title: string
  ariaLabel: string
  disabled: boolean
  avatarLabel: string
  label: string
  meta: string
  seatNumber: string
}

export type StudySeatMapItem = StudySeatMapAisleItem | StudySeatMapSeatItem

type BuildStudySeatMapItemsInput = {
  snapshot: StudySnapshot
  peersBySeat: Map<number, StudyPresencePeer>
  roomCycleNow: number
  seatCount: number
  userSeat: number
}

function aisleLabelForSeatIndex(index: number): string {
  return index === 12 ? '中排学习区' : '后排学习区'
}

function buildOccupiedSeatDescription(
  seatLabel: string,
  nickname: string,
  signalId: StudySnapshot['signalId'],
  statusLabel: string,
  freshnessLabel: string,
  isUser: boolean
): string {
  return `${seatLabel} · ${nickname}${isUser ? '（我）' : ''} · ${studySignalLabel(signalId)} · ${statusLabel} · ${freshnessLabel}`
}

function buildSeatItem(
  index: number,
  snapshot: StudySnapshot,
  peersBySeat: Map<number, StudyPresencePeer>,
  roomCycleNow: number,
  userSeat: number
): StudySeatMapSeatItem {
  const peer = peersBySeat.get(index)
  const isUser = index === userSeat
  const isOccupied = Boolean(peer) || isUser
  const seatLabel = formatStudySeatLabel(index)
  const seatNickname = isUser ? snapshot.nickname : peer?.nickname
  const seatSignal = isUser ? snapshot.signalId : peer?.signalId
  const seatStatus = isUser
    ? studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)
    : peer
      ? studyMemberStatusLabel(peer.status, peer.timerMode)
      : '可入座'
  const seatFreshness = isUser
    ? '本机心跳'
    : peer
      ? studyMemberFreshnessLabel(peer, roomCycleNow)
      : ''
  const emptyDescription = `${seatLabel} · 空座，点击入座`
  const occupiedDescription = isUser
    ? buildOccupiedSeatDescription(seatLabel, snapshot.nickname, snapshot.signalId, seatStatus, seatFreshness, true)
    : peer
      ? buildOccupiedSeatDescription(seatLabel, peer.nickname, peer.signalId, seatStatus, seatFreshness, false)
      : emptyDescription

  return {
    kind: 'seat',
    key: `seat-${index}`,
    seatIndex: index,
    className: `study-seat${isUser ? ' is-user' : ''}${isOccupied ? ' is-occupied' : ' is-empty'}${peer?.status === 'running' ? ' is-focusing' : ''}`,
    title: occupiedDescription,
    ariaLabel: occupiedDescription,
    disabled: Boolean(peer) && !isUser,
    avatarLabel: isUser ? '我' : peer ? studySignalShortLabel(peer.signalId) : '',
    label: seatNickname ?? '空座',
    meta: seatSignal ? `${studySignalShortLabel(seatSignal)} · ${seatStatus}` : seatStatus,
    seatNumber: String(index + 1).padStart(2, '0')
  }
}

export function buildStudySeatMapItems({
  snapshot,
  peersBySeat,
  roomCycleNow,
  seatCount,
  userSeat
}: BuildStudySeatMapItemsInput): StudySeatMapItem[] {
  const items: StudySeatMapItem[] = []
  for (let index = 0; index < seatCount; index += 1) {
    if (index > 0 && index % 12 === 0) {
      items.push({
        kind: 'aisle',
        key: `aisle-${index}`,
        label: aisleLabelForSeatIndex(index)
      })
    }
    items.push(buildSeatItem(index, snapshot, peersBySeat, roomCycleNow, userSeat))
  }
  return items
}
