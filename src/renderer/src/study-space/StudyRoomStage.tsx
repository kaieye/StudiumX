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
import type { StudySeatMapItem } from './seatMapPresenter'
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
  localSeatLabel: string
  signalMixSummary: string
  remoteHeartbeatLabel: string
  liveDeskMembers: StudySpaceViewModel['liveDeskMembers']
  recentLiveEvents: StudySpaceViewModel['recentLiveEvents']
  roomMembers: StudySpaceViewModel['roomMembers']
  roomSummaries: StudySpaceViewModel['roomSummaries']
  roomRules: string[]
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
  seatMapItems: StudySeatMapItem[]
  onRunHostAction: () => void
  onFollowRoomCycle: () => void
  onCopyInvite: () => void
  onOpenFocusTheater: () => void
  onEditName: () => void
  onChooseSeat: (seatIndex: number) => void
  onSelectRoom: (room: StudySpaceViewModel['activeRoom']) => void
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
  localSeatLabel,
  signalMixSummary,
  remoteHeartbeatLabel,
  liveDeskMembers,
  recentLiveEvents,
  roomMembers,
  roomSummaries,
  roomRules,
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
  seatMapItems,
  onRunHostAction,
  onFollowRoomCycle,
  onCopyInvite,
  onOpenFocusTheater,
  onEditName,
  onChooseSeat,
  onSelectRoom
}: StudyRoomStageProps) {
  return (
    <section className="study-room-stage" aria-label="在线自习室">
      <div className="study-cinema" aria-label="沉浸式在线自习室">
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
              同步房间
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

        <div className={`study-cinema-liveline${liveLineClass}`} aria-label="房间实时动态">
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
            <div className="study-live-events" aria-label="最近房间动态">
              {recentLiveEvents.length > 0 ? recentLiveEvents.map((event) => (
                <div className={`study-live-event is-${event.kind}`} key={event.id}>
                  <span>{event.kind === 'checkin' ? 'IN' : event.kind === 'focus_start' ? 'GO' : event.kind === 'task_done' ? 'OK' : 'UP'}</span>
                  <p>{event.text}</p>
                  <em>{formatStudyEventTime(event.createdAt)}</em>
                </div>
              )) : (
                <div className="study-live-event is-empty">
                  <span>--</span>
                  <p>签到、开始或完成专注后会同步到同房间。</p>
                  <em>{connectionLabel}</em>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="study-cinema-seat-deck">
          <div className="study-cinema-seat-head">
            <div>
              <span>{localSeatLabel}</span>
              <strong>{focusingCount} 人专注中 · {signalMixSummary}</strong>
            </div>
            <em>{presence.status === 'online' ? `${remoteOnline} 远端` : presence.status === 'connecting' ? '连接中' : '离线'}</em>
          </div>
          <div className="study-seat-room" aria-label="真实在线座位图">
            <div className="study-seat-front" aria-hidden="true">
              <span>FOCUS BOARD</span>
              <strong>{activeRoom.sessionMinutes}/{activeRoom.breakMinutes}</strong>
            </div>
            <div className="study-seat-map">
              {seatMapItems.map((item) => item.kind === 'aisle' ? (
                <div className="study-seat-aisle" aria-hidden="true" key={item.key}><span>{item.label}</span></div>
              ) : (
                <button
                  type="button"
                  className={item.className}
                  title={item.title}
                  aria-label={item.ariaLabel}
                  disabled={item.disabled}
                  onClick={() => onChooseSeat(item.seatIndex)}
                  key={item.key}
                >
                  <span className="study-seat-avatar" aria-hidden="true">
                    {item.avatarLabel}
                  </span>
                  <span className="study-seat-label">{item.label}</span>
                  <span className="study-seat-meta">{item.meta}</span>
                  <small>{item.seatNumber}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="study-host-card" aria-label="房间主持">
        <div className="study-host-copy">
          <span className="study-kicker"><Sparkles size={14} /> 房间引导</span>
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
      <div className={`study-cycle-card is-${roomCycle.phase}`} aria-label="房间同步轮次">
        <div>
          <span>第 {roomCycle.round} 轮</span>
          <strong>{roomCycle.phase === 'focus' ? `${activeRoom.sessionMinutes} 分钟同频专注` : `${activeRoom.breakMinutes} 分钟同步休息`}</strong>
          <small>下一段：{roomCycle.nextLabel}</small>
        </div>
        <div className="study-cycle-countdown">
          <strong>{formatStudyDuration(roomCycle.remainingSeconds)}</strong>
          <span>{followingRoomCycle ? '正在跟随房间节奏' : '与房间轮次同频'}</span>
        </div>
        <button type="button" onClick={onFollowRoomCycle}>
          {followingRoomCycle ? '重新同步' : '跟随节奏'}
        </button>
        <div className="study-cycle-track" aria-hidden="true">
          <span style={{ width: `${roomCycle.progress}%` }} />
        </div>
      </div>
      <div className="study-room-strip" aria-label="在线房间目录">
        {roomSummaries.map(({ room, cycle, online: roomOnline, focusing: roomFocusing, latestText, latestMeta, hasRemote, isActive }) => {
          const roomFill = Math.min(100, Math.round((roomOnline / room.capacity) * 100))
          return (
            <button
              key={room.id}
              type="button"
              className={`study-room-tab${isActive ? ' is-active' : ''}${hasRemote ? ' has-remote' : ''}`}
              onClick={() => onSelectRoom(room)}
            >
              <span className="study-room-tab-head">
                <strong>{room.name}</strong>
                <em>{cycle.phase === 'focus' ? '专注' : '休息'}</em>
              </span>
              <span className="study-room-tab-meta">
                <em>{roomOnline}/{room.capacity}</em>
                <em>{roomFocusing} 专注</em>
              </span>
              <span className="study-room-tab-cycle">
                {formatStudyDuration(cycle.remainingSeconds)} 后{cycle.nextLabel}
              </span>
              <span className="study-room-tab-activity">
                <b>{latestText}</b>
                <small>{latestMeta}</small>
              </span>
              <span className="study-room-tab-meter" aria-hidden="true">
                <i style={{ width: `${roomFill}%` }} />
              </span>
            </button>
          )
        })}
      </div>
      <div className="study-room-tags">
        {activeRoom.tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <div className="study-room-rules" aria-label="房间规则">
        {roomRules.map((rule, index) => (
          <span key={index}>{rule}</span>
        ))}
      </div>
    </section>
  )
}
