import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from 'react'
import { BookOpenCheck, RotateCcw, Eye, LogOut } from 'lucide-react'

import {
  discoverTeachingCommands,
  teachingCommandSlashQuery,
  teachingCommandValue,
  type TeachingCommandContext,
  type TeachingCommandDefinition,
  type TeachingCommandKind
} from '../../../shared/teaching-command'

function iconFor(kind: TeachingCommandKind) {
  switch (kind) {
    case 'continue':
      return <BookOpenCheck size={17} aria-hidden="true" />
    case 'retry':
      return <RotateCcw size={17} aria-hidden="true" />
    case 'show_source':
      return <Eye size={17} aria-hidden="true" />
    case 'end_session':
      return <LogOut size={17} aria-hidden="true" />
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

/**
 * Teaching-mode slash discovery for the closed TeachingCommand union.
 * Does not surface technical/agent control, even when diagnosticMode is set.
 */
export function useTeachingComposerCommands(options: {
  enabled: boolean
  value: string
  onChange: (value: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  context: Omit<TeachingCommandContext, 'isTeachingMode'>
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissedValue, setDismissedValue] = useState<string | null>(null)
  const teachingContext: TeachingCommandContext = {
    isTeachingMode: options.enabled,
    presentationActionKind: options.context.presentationActionKind ?? null,
    hasSources: options.context.hasSources === true,
    diagnosticMode: options.context.diagnosticMode === true
  }
  const query = options.enabled ? teachingCommandSlashQuery(options.value) : null
  const matches = useMemo(
    () => (options.enabled ? discoverTeachingCommands(options.value, teachingContext) : []),
    [
      options.enabled,
      options.value,
      teachingContext.presentationActionKind,
      teachingContext.hasSources,
      teachingContext.diagnosticMode
    ]
  )
  const open = query !== null && dismissedValue !== options.value && options.enabled

  useEffect(() => {
    setActiveIndex(0)
  }, [options.value])

  const pick = (command: TeachingCommandDefinition): void => {
    options.onChange(teachingCommandValue(command))
    setDismissedValue(null)
    window.requestAnimationFrame(() => {
      const input = options.inputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      setDismissedValue(options.value)
      return true
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (matches.length === 0) return true
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => (current + delta + matches.length) % matches.length)
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const selected = matches[activeIndex]
      if (selected) pick(selected)
      return true
    }
    return false
  }

  return {
    menu: open ? (
      <TeachingComposerCommandMenu
        commands={matches}
        activeIndex={activeIndex}
        context={teachingContext}
        onHover={setActiveIndex}
        onPick={pick}
      />
    ) : null,
    handleKeyDown,
    open
  }
}

function TeachingComposerCommandMenu({
  commands,
  activeIndex,
  context,
  onHover,
  onPick
}: {
  commands: TeachingCommandDefinition[]
  activeIndex: number
  context: TeachingCommandContext
  onHover: (index: number) => void
  onPick: (command: TeachingCommandDefinition) => void
}) {
  return (
    <div className="skill-slash-menu teaching-composer-command-menu" role="listbox" aria-label="教学命令">
      <div className="skill-slash-menu__head">
        <span>教学命令</span>
        <kbd>/</kbd>
      </div>
      {commands.length > 0 ? commands.map((command, index) => {
        // Availability is informational in the menu; policy is enforced on submit.
        const availabilityNote =
          command.execution === 'presentation_action'
            ? '需当前学习流程允许'
            : command.kind === 'show_source'
              ? (context.hasSources ? '本地界面' : '暂无来源')
              : '本地会话控制'
        return (
          <button
            key={command.kind}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={`skill-slash-menu__item${index === activeIndex ? ' is-active' : ''}`}
            onMouseDown={(event) => {
              event.preventDefault()
              onPick(command)
            }}
            onMouseMove={() => onHover(index)}
          >
            <span className="skill-slash-menu__icon">{iconFor(command.kind)}</span>
            <span className="skill-slash-menu__copy">
              <strong>{command.slash}</strong>
              <span>{command.description}</span>
            </span>
            <small>{availabilityNote}</small>
          </button>
        )
      }) : (
        <div className="skill-slash-menu__empty">没有匹配的教学命令</div>
      )}
    </div>
  )
}
