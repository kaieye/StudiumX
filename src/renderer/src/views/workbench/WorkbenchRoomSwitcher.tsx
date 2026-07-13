import { Check, Copy, DoorOpen, Plus, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { studyRooms } from '../../study-space/constants'
import type { StudyPresenceStatus, StudyRoomId } from '../../study-space/types'

type WorkbenchRoom = typeof studyRooms[number]

type WorkbenchRoomSwitcherProps = {
  spaceCode: string
  rooms: WorkbenchRoom[]
  activeRoomId: StudyRoomId
  connectionStatus: StudyPresenceStatus
  onlineCount: number
  onSelectRoom: (room: WorkbenchRoom) => void
  onCreateSpace: () => void
  onJoinSpace: (spaceCode: string) => void
}

function roomStatusLabel(status: StudyPresenceStatus, onlineCount: number): string {
  if (status === 'online') return `${onlineCount} 在线`
  if (status === 'connecting') return '连接中'
  return '本机席位'
}

export function WorkbenchRoomSwitcher({
  spaceCode,
  rooms,
  activeRoomId,
  connectionStatus,
  onlineCount,
  onSelectRoom,
  onCreateSpace,
  onJoinSpace
}: WorkbenchRoomSwitcherProps) {
  const [joinDraft, setJoinDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const availableRooms = studyRooms.map((room) => rooms.find((item) => item.id === room.id) ?? room)
  const activeRoom = availableRooms.find((room) => room.id === activeRoomId) ?? availableRooms[0]

  const handleJoin = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!joinDraft.trim()) return
    onJoinSpace(joinDraft)
    setJoinDraft('')
  }

  const copySpaceCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(spaceCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="workbench-room-switcher" aria-label="自习室房间码">
      {activeRoom ? (
        <div className="workbench-room-current">
          <span className={`workbench-room-status is-${connectionStatus}`} aria-hidden="true" />
          <div>
            <small>当前自习室</small>
            <strong>{activeRoom.name}</strong>
            <em>{activeRoom.sessionMinutes} 分钟专注 · {activeRoom.capacity} 座</em>
          </div>
          <span className="workbench-room-members" title={roomStatusLabel(connectionStatus, onlineCount)}>
            <Users size={12} /> {roomStatusLabel(connectionStatus, onlineCount)}
          </span>
        </div>
      ) : null}

      <div className="workbench-room-list" role="tablist" aria-label="切换自习室">
        {availableRooms.map((room) => {
          const isActive = room.id === activeRoomId
          return (
            <button
              key={room.id}
              type="button"
              className={isActive ? 'is-active' : undefined}
              onClick={() => onSelectRoom(room)}
              aria-selected={isActive}
              role="tab"
            >
              <span>{room.name}</span>
              <small>{room.sessionMinutes}/{room.breakMinutes} · {room.capacity} 座</small>
            </button>
          )
        })}
      </div>

      <div className="workbench-room-code">
        <span>
          <small>房间码</small>
          <strong>{spaceCode}</strong>
        </span>
        <div className="workbench-room-actions">
          <button className="is-copy" type="button" onClick={() => void copySpaceCode()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? '已复制' : '复制'}
          </button>
          <button className="is-create" type="button" onClick={onCreateSpace}>
            <Plus size={14} /> 创建房间码
          </button>
        </div>
      </div>

      <form className="workbench-room-join" onSubmit={handleJoin}>
        <DoorOpen size={14} />
        <input
          value={joinDraft}
          onChange={(event) => setJoinDraft(event.target.value.toUpperCase())}
          placeholder="输入房间码"
          aria-label="输入要加入的房间码"
          maxLength={18}
        />
        <button type="submit" disabled={!joinDraft.trim()}>加入房间</button>
      </form>
    </section>
  )
}
