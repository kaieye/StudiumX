import { Check, Copy, DoorOpen, Plus, Users } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { studyRooms } from '../../study-space/constants'
import type { StudyPresenceStatus } from '../../study-space/types'

type StudyRoom = typeof studyRooms[number]

type WorkbenchRoomSwitcherProps = {
  activeRoom: StudyRoom
  spaceCode: string
  presenceStatus: StudyPresenceStatus
  memberCount: number
  onCreateSpace: () => void
  onJoinSpace: (spaceCode: string) => void
  onSelectRoom: (room: StudyRoom) => void
}

const presenceLabels: Record<StudyPresenceStatus, string> = {
  online: '在线',
  connecting: '连接中',
  offline: '本机模式'
}

export function WorkbenchRoomSwitcher({
  activeRoom,
  spaceCode,
  presenceStatus,
  memberCount,
  onCreateSpace,
  onJoinSpace,
  onSelectRoom
}: WorkbenchRoomSwitcherProps) {
  const [joinDraft, setJoinDraft] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setCopied(false)
  }, [spaceCode])

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
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="workbench-room-switcher" aria-label="自习房间">
      <header className="workbench-room-current">
        <span className={`workbench-room-status is-${presenceStatus}`} aria-hidden="true" />
        <div>
          <small>{presenceLabels[presenceStatus]}</small>
          <strong>{activeRoom.name}</strong>
        </div>
        <span className="workbench-room-members" title="当前房间人数">
          <Users size={13} /> {memberCount}
        </span>
      </header>

      <div className="workbench-room-code">
        <span>
          <small>房间码</small>
          <strong>{spaceCode}</strong>
        </span>
        <button type="button" onClick={() => void copySpaceCode()} aria-label="复制房间码" title="复制房间码">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button className="is-create" type="button" onClick={onCreateSpace}>
          <Plus size={14} /> 创建
        </button>
      </div>

      <div className="workbench-room-list" role="list" aria-label="选择房间类型">
        {studyRooms.map((room) => (
          <button
            key={room.id}
            type="button"
            role="listitem"
            className={room.id === activeRoom.id ? 'is-active' : undefined}
            onClick={() => onSelectRoom(room)}
            aria-pressed={room.id === activeRoom.id}
            title={room.tone}
          >
            <span>{room.name}</span>
            <small>{room.sessionMinutes}/{room.breakMinutes} 分钟</small>
          </button>
        ))}
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
        <button type="submit" disabled={!joinDraft.trim()}>加入</button>
      </form>
    </section>
  )
}
