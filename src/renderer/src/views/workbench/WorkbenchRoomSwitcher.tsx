import { Check, Copy, DoorOpen, Shuffle } from 'lucide-react'
import { useState, type FormEvent } from 'react'

type WorkbenchRoomSwitcherProps = {
  spaceCode: string
  onEnterRandomSpace: () => void
  onJoinSpace: (spaceCode: string) => void
}

export function WorkbenchRoomSwitcher({
  spaceCode,
  onEnterRandomSpace,
  onJoinSpace
}: WorkbenchRoomSwitcherProps) {
  const [joinDraft, setJoinDraft] = useState('')
  const [copied, setCopied] = useState(false)

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
          <button className="is-random" type="button" onClick={onEnterRandomSpace}>
            <Shuffle size={14} /> 随机进入自习室
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
