import { Copy, Maximize2, Plus, RefreshCw, Sparkles, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  formatStudyDuration,
  formatStudyEventTime,
  formatStudyHours,
  formatStudySeatLabel,
  normalizeStudySeatIndex,
  studyMemberFreshnessLabel,
  studyMemberStatusLabel,
  studySignalLabel,
  studySignalShortLabel
} from './domain'
import type { useStudySession } from './session/useStudySession'
import type { StudySnapshot } from './types'
import type { StudySpaceViewModel } from './viewModel'

type StudyPresence = ReturnType<typeof useStudySession>['presence']

type StudyRoomStageProps = {
  activeRoom: StudySpaceViewModel['activeRoom']
  snapshot: StudySnapshot
  presence: StudyPresence
  roomCycleNow: number
  roomCycle: StudySpaceViewModel['roomCycle']
  online: number
  remoteOnline: number
  roomMaxFocusSeconds: number
  focusingCount: number
  remoteHeartbeatLabel: string
  liveDeskMembers: StudySpaceViewModel['liveDeskMembers']
  recentLiveEvents: StudySpaceViewModel['recentLiveEvents']
  roomMembers: StudySpaceViewModel['roomMembers']
  stageStatusLabel: string
  contractDisplay: string
  hostActionIcon: ReactNode
  hostActionLabel: string
  hostBrief: string
  hostChecklist: StudySpaceViewModel['hostChecklist']
  followingRoomCycle: boolean
  liveLineCode: StudySpaceViewModel['liveLineCode']
  liveLineText: string
  liveLineMeta: string
  liveLineClass: string
  connectionLabel: string
  copyState: 'idle' | 'copied' | 'failed'
  onRunHostAction: () => void
  onFollowRoomCycle: () => void
  onCopyInvite: () => void
  onOpenFocusTheater: () => void
  onEditName: () => void
}

export function StudyRoomStage({
  activeRoom,
  snapshot,
  presence,
  roomCycleNow,
  roomCycle,
  online,
  remoteOnline,
  roomMaxFocusSeconds,
  focusingCount,
  remoteHeartbeatLabel,
  liveDeskMembers,
  recentLiveEvents,
  roomMembers,
  stageStatusLabel,
  contractDisplay,
  hostActionIcon,
  hostActionLabel,
  hostBrief,
  hostChecklist,
  followingRoomCycle,
  liveLineCode,
  liveLineText,
  liveLineMeta,
  liveLineClass,
  connectionLabel,
  copyState,
  onRunHostAction,
  onFollowRoomCycle,
  onCopyInvite,
  onOpenFocusTheater,
  onEditName
}: StudyRoomStageProps) {
  return (
    <section className="study-room-stage" aria-label="学习空间">
      <div className="study-cinema" aria-label="沉浸式学习空间">
        <div className="study-cinema-topbar">
          <div>
            <span className="study-kicker"><Users size={14} /> 真实在线</span>
            <h2>{activeRoom.name}</h2>
          </div>
          <div className="study-cinema-status">
            <span className={`study-presence-pill is-${presence.status}`}>
              <span />
              {presence.status === 'online' ? `${online}/${activeRoom.capacity}` : presence.status === 'connecting' ? '连接中' : '离线'}
            </span>
            <button className="study-name-button" type="button" onClick={onEditName}>
              {snapshot.nickname}
            </button>
          </div>
        </div>

        <div className="study-cinema-center">
          <span>{stageStatusLabel}</span>
          <strong>{formatStudyDuration(snapshot.remainingSeconds)}</strong>
          <p>{contractDisplay}</p>
          <div className="study-cinema-actions">
            <button type="button" onClick={onRunHostAction}>
              {hostActionIcon}
              {hostActionLabel}
            </button>
            <button type="button" onClick={onFollowRoomCycle}>
              <RefreshCw size={14} />
              同步节奏
            </button>
            <button type="button" onClick={onCopyInvite}>
              <Copy size={14} />
              {copyState === 'copied' ? '已复制' : '邀请'}
            </button>
            <button type="button" onClick={onOpenFocusTheater}>
              <Maximize2 size={14} />
              全屏
            </button>
          </div>
        </div>

        <div className="study-cinema-peer-strip" aria-label="在线同桌">
          {roomMembers.slice(0, 7).map((member) => (
            <span className={member.isSelf ? 'is-me' : ''} key={member.clientId} title={`${formatStudySeatLabel(member.seatIndex)} · ${member.nickname} · ${studySignalLabel(member.signalId)} · ${studyMemberFreshnessLabel(member, roomCycleNow)}`}>
              {member.isSelf ? '我' : studySignalShortLabel(member.signalId)}
            </span>
          ))}
        </div>

        <div className={`study-cinema-liveline${liveLineClass}`} aria-label="实时动态">
          <span>{liveLineCode}</span>
          <p>{liveLineText}</p>
          <em>{liveLineMeta}</em>
        </div>

        <div className="study-live-desk" aria-label="实时同桌桌面">
          <div className="study-live-desk-head">
            <div>
              <span className="study-kicker"><Users size={14} /> 实时同桌</span>
              <strong>{online} 个席位在线 · {focusingCount} 人专注</strong>
            </div>
            <em>{remoteHeartbeatLabel}</em>
          </div>
          <div className="study-live-desk-grid">
            <div className="study-live-roster" aria-label="实时同桌状态">
              {liveDeskMembers.map((member) => {
                const seatLabel = formatStudySeatLabel(normalizeStudySeatIndex(member.seatIndex, member.roomId, member.clientId))
                const focusShare = Math.max(8, Math.round((member.todayFocusSeconds / roomMaxFocusSeconds) * 100))
                return (
                  <div className={`study-live-peer${member.isSelf ? ' is-me' : ''}${member.status === 'running' ? ' is-running' : ''}`} key={member.clientId}>
                    <span>{member.isSelf ? '我' : studySignalShortLabel(member.signalId)}</span>
                    <div>
                      <strong>{member.nickname}</strong>
                      <small>{seatLabel} · {studySignalLabel(member.signalId)} · {formatStudyHours(member.todayFocusSeconds)}h</small>
                      <i style={{ width: `${focusShare}%` }} />
                    </div>
                    <em>{studyMemberStatusLabel(member.status, member.timerMode)}</em>
                  </div>
                )
              })}
              {remoteOnline === 0 ? (
                <div className="study-live-peer is-empty">
                  <span><Plus size={12} /></span>
                  <div>
                    <strong>{presence.status === 'online' ? '等待远端同桌' : '等待重新同步'}</strong>
                    <small>{presence.status === 'online' ? '邀请进入后这里会出现真实席位' : '连接恢复后才显示远端席位'}</small>
                    <i />
                  </div>
                  <em>{connectionLabel}</em>
                </div>
              ) : null}
            </div>
            <div className="study-live-events" aria-label="最近动态">
              {recentLiveEvents.length > 0 ? recentLiveEvents.map((event) => (
                <div className={`study-live-event is-${event.kind}`} key={event.id}>
                  <span>{event.kind === 'checkin' ? 'IN' : event.kind === 'focus_start' ? 'GO' : event.kind === 'task_done' ? 'OK' : 'UP'}</span>
                  <p>{event.text}</p>
                  <em>{formatStudyEventTime(event.createdAt)}</em>
                </div>
              )) : (
                <div className="study-live-event is-empty">
                  <span>--</span>
                  <p>签到、开始或完成专注后会同步到同空间。</p>
                  <em>{connectionLabel}</em>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="study-host-card" aria-label="学习引导">
        <div className="study-host-copy">
          <span className="study-kicker"><Sparkles size={14} /> 学习引导</span>
          <strong>{hostBrief}</strong>
        </div>
        <div className="study-host-checklist">
          {hostChecklist.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
        <div className="study-host-actions">
          <button type="button" onClick={onRunHostAction}>
            {hostActionIcon}
            {hostActionLabel}
          </button>
          <button type="button" onClick={onOpenFocusTheater}>
            <Maximize2 size={14} />
            沉浸视图
          </button>
        </div>
      </div>
      <div className={`study-cycle-card is-${roomCycle.phase}`} aria-label="同步轮次">
        <div>
          <span>第 {roomCycle.round} 轮</span>
          <strong>{roomCycle.phase === 'focus' ? `${activeRoom.sessionMinutes} 分钟同频专注` : `${activeRoom.breakMinutes} 分钟同步休息`}</strong>
          <small>下一段：{roomCycle.nextLabel}</small>
        </div>
        <div className="study-cycle-countdown">
          <strong>{formatStudyDuration(roomCycle.remainingSeconds)}</strong>
          <span>{followingRoomCycle ? '正在跟随学习节奏' : '与当前轮次同频'}</span>
        </div>
        <button type="button" onClick={onFollowRoomCycle}>
          {followingRoomCycle ? '重新同步' : '跟随节奏'}
        </button>
        <div className="study-cycle-track" aria-hidden="true">
          <span style={{ width: `${roomCycle.progress}%` }} />
        </div>
      </div>
    </section>
  )
}
