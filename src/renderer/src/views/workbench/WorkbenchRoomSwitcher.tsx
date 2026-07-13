import { DoorOpen, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'

type WorkbenchRoomSwitcherProps = {
  spaceCode: string
  onCreateSpace: () => void
  onJoinSpace: (spaceCode: string) => void
}

export function WorkbenchRoomSwitcher({
  spaceCode,
  onCreateSpace,
  onJoinSpace
}: WorkbenchRoomSwitcherProps) {
  const [joinDraft, setJoinDraft] = useState('')

  const handleJoin = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!joinDraft.trim()) return
    onJoinSpace(joinDraft)
    setJoinDraft('')
  }

  return (
    <section className="workbench-room-switcher" aria-label="自习室房间码">
      <div className="workbench-room-code">
        <span>
          <small>房间码</small>
          <strong>{spaceCode}</strong>
        </span>
        <button className="is-create" type="button" onClick={onCreateSpace}>
          <Plus size={14} /> 创建房间码
        </button>
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
