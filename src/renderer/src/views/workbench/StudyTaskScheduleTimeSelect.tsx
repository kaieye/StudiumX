import { ChevronDown, Clock3 } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  canUseScheduleTime,
  chooseAllowedMinute,
  getTimeParts,
  parseTimePart,
  validateTimeFields
} from './study-task-schedule-interaction'

type TimePart = 'hour' | 'minute'

export type TimeSelectProps = {
  value: number
  minMinutes: number
  maxMinutes: number
  onChange: (minutes: number) => void
  disabledOption?: (minutes: number) => boolean
  ariaLabel: string
}

const minutePartOptions = Array.from({ length: 60 }, (_, minute) => minute)

export function TimeSelect({ value, minMinutes, maxMinutes, onChange, disabledOption, ariaLabel }: TimeSelectProps) {
  const valueParts = getTimeParts(value)
  const [openPart, setOpenPart] = useState<TimePart | null>(null)
  const [hourDraft, setHourDraft] = useState(() => String(valueParts.hour).padStart(2, '0'))
  const [minuteDraft, setMinuteDraft] = useState(() => String(valueParts.minute).padStart(2, '0'))
  const [invalid, setInvalid] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hourInputRef = useRef<HTMLInputElement | null>(null)
  const minuteInputRef = useRef<HTMLInputElement | null>(null)
  const selectedRef = useRef<HTMLButtonElement | null>(null)
  const listboxBaseId = useId()
  const hourOptions = Array.from({ length: Math.floor(maxMinutes / 60) + 1 }, (_, hour) => hour)
  const parsedDraftHour = parseTimePart(hourDraft, 24)
  const parsedDraftMinute = parseTimePart(minuteDraft, 59)

  const setValidation = (message: string): void => {
    const hasError = message.length > 0
    setInvalid(hasError)
    hourInputRef.current?.setCustomValidity(message)
    minuteInputRef.current?.setCustomValidity(message)
  }

  const timePolicy = { minMinutes, maxMinutes, isDisabled: disabledOption }

  const isAllowedTime = (hour: number, minute: number): boolean => canUseScheduleTime(hour, minute, timePolicy)

  const applyTimeIfValid = (nextHourDraft: string, nextMinuteDraft: string): boolean => {
    const validation = validateTimeFields(nextHourDraft, nextMinuteDraft, timePolicy)
    if (!validation.valid) return false
    setValidation('')
    if (validation.minutes !== value) onChange(validation.minutes)
    return true
  }

  const commitDraft = (): boolean => {
    const validation = validateTimeFields(hourDraft, minuteDraft, timePolicy)
    if (!validation.valid) {
      setValidation(validation.message)
      return false
    }
    const nextParts = getTimeParts(validation.minutes)
    setHourDraft(String(nextParts.hour).padStart(2, '0'))
    setMinuteDraft(String(nextParts.minute).padStart(2, '0'))
    setValidation('')
    if (validation.minutes !== value) onChange(validation.minutes)
    return true
  }

  const resetDraft = (): void => {
    const nextParts = getTimeParts(value)
    setHourDraft(String(nextParts.hour).padStart(2, '0'))
    setMinuteDraft(String(nextParts.minute).padStart(2, '0'))
    setValidation('')
  }

  useEffect(() => {
    const nextParts = getTimeParts(value)
    setHourDraft(String(nextParts.hour).padStart(2, '0'))
    setMinuteDraft(String(nextParts.minute).padStart(2, '0'))
    setInvalid(false)
    hourInputRef.current?.setCustomValidity('')
    minuteInputRef.current?.setCustomValidity('')
  }, [value])

  useEffect(() => {
    if (!openPart) return undefined
    const closeFromOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenPart(null)
    }
    const closeFromKeyboard = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpenPart(null)
      const nextParts = getTimeParts(value)
      setHourDraft(String(nextParts.hour).padStart(2, '0'))
      setMinuteDraft(String(nextParts.minute).padStart(2, '0'))
      setInvalid(false)
      hourInputRef.current?.setCustomValidity('')
      minuteInputRef.current?.setCustomValidity('')
      const input = openPart === 'hour' ? hourInputRef.current : minuteInputRef.current
      input?.focus()
    }
    window.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('keydown', closeFromKeyboard)
    window.requestAnimationFrame(() => selectedRef.current?.scrollIntoView({ block: 'nearest' }))
    return () => {
      window.removeEventListener('pointerdown', closeFromOutside)
      window.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [openPart, value])

  const handlePartChange = (part: TimePart, rawValue: string): void => {
    const nextValue = rawValue.replace(/\D/g, '').slice(0, 2)
    const nextHourDraft = part === 'hour' ? nextValue : hourDraft
    const nextMinuteDraft = part === 'minute' ? nextValue : minuteDraft
    if (part === 'hour') setHourDraft(nextValue)
    else setMinuteDraft(nextValue)
    setValidation('')
    applyTimeIfValid(nextHourDraft, nextMinuteDraft)
    setOpenPart(part)
  }

  const handlePartKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, part: TimePart): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpenPart(part)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (commitDraft()) setOpenPart(null)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      resetDraft()
      setOpenPart(null)
    }
  }

  const selectHour = (hour: number): void => {
    const preferredMinute = parsedDraftMinute ?? valueParts.minute
    const minute = chooseAllowedMinute(hour, preferredMinute, timePolicy)
    if (minute === null) return
    const nextHourDraft = String(hour).padStart(2, '0')
    const nextMinuteDraft = String(minute).padStart(2, '0')
    setHourDraft(nextHourDraft)
    setMinuteDraft(nextMinuteDraft)
    setValidation('')
    applyTimeIfValid(nextHourDraft, nextMinuteDraft)
    setOpenPart(null)
    hourInputRef.current?.focus()
  }

  const selectMinute = (minute: number): void => {
    const hour = parsedDraftHour ?? valueParts.hour
    if (!isAllowedTime(hour, minute)) return
    const nextHourDraft = String(hour).padStart(2, '0')
    const nextMinuteDraft = String(minute).padStart(2, '0')
    setHourDraft(nextHourDraft)
    setMinuteDraft(nextMinuteDraft)
    setValidation('')
    applyTimeIfValid(nextHourDraft, nextMinuteDraft)
    setOpenPart(null)
    minuteInputRef.current?.focus()
  }

  const renderPart = (part: TimePart) => {
    const isHour = part === 'hour'
    const draft = isHour ? hourDraft : minuteDraft
    const inputRef = isHour ? hourInputRef : minuteInputRef
    const partLabel = isHour ? '小时' : '分钟'
    const listboxId = `${listboxBaseId}-${part}`
    const partOpen = openPart === part
    const options = isHour ? hourOptions : minutePartOptions
    const selectedValue = isHour ? parsedDraftHour : parsedDraftMinute
    const activeHour = parsedDraftHour ?? valueParts.hour

    return (
      <div className={`study-schedule-time-part is-${part}${partOpen ? ' is-open' : ''}`}>
        <input
          ref={inputRef}
          type="text"
          className="study-schedule-time-input"
          value={draft}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={2}
          required
          role="combobox"
          aria-label={`${ariaLabel}${partLabel}`}
          aria-haspopup="listbox"
          aria-expanded={partOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-invalid={invalid}
          placeholder={isHour ? '时' : '分'}
          title={`可直接输入${partLabel}，或从菜单中选择`}
          onFocus={(event) => event.currentTarget.select()}
          onClick={() => setOpenPart(part)}
          onChange={(event) => handlePartChange(part, event.currentTarget.value)}
          onInvalid={() => setInvalid(true)}
          onKeyDown={(event) => handlePartKeyDown(event, part)}
          onBlur={(event) => {
            if (rootRef.current?.contains(event.relatedTarget as Node | null)) return
            commitDraft()
            setOpenPart(null)
          }}
        />
        <button
          type="button"
          className="study-schedule-time-toggle"
          aria-label={`${partOpen ? '收起' : '展开'}${ariaLabel}${partLabel}菜单`}
          aria-haspopup="listbox"
          aria-expanded={partOpen}
          aria-controls={listboxId}
          onClick={() => {
            const nextOpen = partOpen ? null : part
            setOpenPart(nextOpen)
            if (nextOpen) window.requestAnimationFrame(() => inputRef.current?.focus())
          }}
        >
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        {partOpen ? (
          <div
            id={listboxId}
            className={`study-schedule-time-part-menu is-${part}`}
            role="listbox"
            aria-label={`${ariaLabel}${partLabel}候选`}
          >
            <span>{partLabel}</span>
            <div>
              {options.map((option) => {
                const disabled = isHour
                  ? !minutePartOptions.some((minute) => isAllowedTime(option, minute))
                  : !isAllowedTime(activeHour, option)
                const selected = option === selectedValue
                return (
                  <button
                    key={option}
                    ref={selected ? selectedRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={disabled}
                    className={selected ? 'is-selected' : ''}
                    onClick={() => isHour ? selectHour(option) : selectMinute(option)}
                  >
                    {String(option).padStart(2, '0')}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div ref={rootRef} className={`study-schedule-time-select${openPart ? ' is-open' : ''}${invalid ? ' is-invalid' : ''}`}>
      <div className="study-schedule-time-control">
        <Clock3 size={14} aria-hidden="true" />
        {renderPart('hour')}
        <span className="study-schedule-time-separator" aria-hidden="true">:</span>
        {renderPart('minute')}
      </div>
    </div>
  )
}
