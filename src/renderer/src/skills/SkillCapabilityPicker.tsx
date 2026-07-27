import { Layers, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  listSkillOrchestrationPresets,
  type SkillOrchestrationPresetId
} from '../../../shared/skill-orchestration-presets'
import type {
  SkillOrchestrationDecision,
  SkillOrchestrationDecisionStatus,
  SkillOrchestrationPreviewResult
} from '../../../shared/teaching-types/skill-orchestration'
import type { SkillSummary } from '../../../shared/teaching-types'
import { useSkillCatalog } from './skillCatalog'

/** Mirrors the IPC payload ceiling so the UI blocks before the parser truncates. */
const MAX_SELECTED_SKILLS = 8
const PREVIEW_DEBOUNCE_MS = 280

/** Kernel is host-injected in teaching mode and never a selectable slot (ADR-0151 §2.1). */
const KERNEL_SKILL_ID = 'teach'

const STATUS_ORDER: SkillOrchestrationDecisionStatus[] = [
  'active_now',
  'scheduled_later',
  'advisory_only',
  'blocked',
  'excluded'
]

const STATUS_LABEL: Record<SkillOrchestrationDecisionStatus, string> = {
  active_now: '现在',
  scheduled_later: '稍后',
  advisory_only: '参考',
  blocked: '已阻止',
  excluded: '未启用'
}

function skillLabel(skillId: string, catalog: readonly SkillSummary[]): string {
  return catalog.find((skill) => skill.id === skillId)?.name || skillId
}

/**
 * Merge chip selection with leading-slash inference for submit.
 * Chips first (stable order), then slash ids not already present — mirrors the
 * main-process `mergeSelectedSkillIds` so preview and execution agree.
 */
export function mergeComposerSkillIds(selected: string[], slashInferred: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of [...selected, ...slashInferred]) {
    const normalized = String(id ?? '').trim().toLocaleLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= MAX_SELECTED_SKILLS) break
  }
  return out
}

export function useSkillCapabilityPicker(options: {
  isTeachingMode: boolean
  userInput: string
  conversationId?: string
  workspaceId?: string
}): {
  chips: ReactNode | null
  panel: ReactNode | null
  toggle: ReactNode
  selectedSkillIds: string[]
  clear: () => void
} {
  const { catalog } = useSkillCatalog()
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [presetId, setPresetId] = useState<SkillOrchestrationPresetId | null>(null)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<SkillOrchestrationPreviewResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const panelTitleId = useId()

  // Catalog capabilities are selectable; the host-injected kernel is excluded.
  const selectable = useMemo(
    () => catalog.skills.filter((skill) => skill.id !== KERNEL_SKILL_ID),
    [catalog.skills]
  )

  const clear = useCallback(() => {
    setSelectedSkillIds([])
    setPresetId(null)
    setPreview(null)
    setNotice(null)
  }, [])

  // Capability selection is a per-conversation intent: switching conversations
  // must not silently carry another conversation's capabilities into this turn.
  const conversationId = options.conversationId
  useEffect(() => {
    clear()
    setOpen(false)
  }, [conversationId, clear])

  const toggleSkill = useCallback((skillId: string) => {
    setNotice(null)
    setSelectedSkillIds((current) => {
      if (current.includes(skillId)) return current.filter((id) => id !== skillId)
      if (current.length >= MAX_SELECTED_SKILLS) {
        setNotice(`一次最多选择 ${MAX_SELECTED_SKILLS} 个能力`)
        return current
      }
      return [...current, skillId]
    })
    setPresetId(null)
  }, [])

  const applyPreset = useCallback((id: SkillOrchestrationPresetId) => {
    const preset = listSkillOrchestrationPresets().find((entry) => entry.id === id)
    if (!preset) return
    setNotice(null)
    // Toggle only a currently applied preset. A manual selection that happens
    // to match a preset must remain selected when the user chooses that preset;
    // otherwise preview would expand the preset while execution sent no ids.
    const nextPresetId = presetId === id ? null : id
    setPresetId(nextPresetId)
    setSelectedSkillIds(nextPresetId ? preset.skillIds.slice(0, MAX_SELECTED_SKILLS) : [])
  }, [presetId])

  const closePanel = useCallback(() => {
    // Return focus before the dialog unmounts so keyboard users retain their
    // place in the composer toolbar.
    triggerRef.current?.focus()
    setOpen(false)
  }, [])

  useEffect(() => {
    if (open) closeButtonRef.current?.focus()
  }, [open])

  // Read-only preview. Never advances orchestration state (ADR-0163 §2.2).
  //
  // `userInput` is deliberately held in a ref rather than an effect dependency:
  // the authority bridge scans the ledger on every call, so re-previewing on
  // each keystroke would be needlessly expensive. Typing does not change which
  // capabilities are active — selection, preset and panel state do.
  const userInputRef = useRef(options.userInput)
  userInputRef.current = options.userInput

  useEffect(() => {
    if (!open && selectedSkillIds.length === 0) {
      setPreview(null)
      return
    }
    const api = window.teachingSystem
    if (!api?.previewSkillOrchestration) return
    const seq = ++requestSeq.current
    const timer = window.setTimeout(() => {
      void api
        .previewSkillOrchestration({
          selectedSkillIds,
          userInput: userInputRef.current,
          isTeachingConversation: options.isTeachingMode,
          ...(presetId ? { presetId } : {}),
          ...(options.conversationId ? { conversationId: options.conversationId } : {}),
          ...(options.workspaceId ? { workspaceId: options.workspaceId } : {})
        })
        .then((result) => {
          // Drop stale responses so the panel never shows an older plan.
          if (seq === requestSeq.current) setPreview(result)
        })
        .catch(() => {
          if (seq === requestSeq.current) setPreview(null)
        })
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      // Invalidate an in-flight response as well as the debounce timer.
      requestSeq.current += 1
      window.clearTimeout(timer)
    }
  }, [
    open,
    selectedSkillIds,
    presetId,
    options.isTeachingMode,
    options.conversationId,
    options.workspaceId
  ])

  const chips =
    options.isTeachingMode || selectedSkillIds.length > 0 ? (
      <div className="skill-capability-chips" aria-label="已选教学能力">
        {options.isTeachingMode ? (
          <span className="skill-capability-chip is-kernel" title="教学内核由应用提供，始终启用">
            教学内核已启用
          </span>
        ) : null}
        {selectedSkillIds.map((skillId) => (
          <span key={skillId} className="skill-capability-chip">
            {skillLabel(skillId, catalog.skills)}
            <button
              type="button"
              aria-label={`移除能力 ${skillLabel(skillId, catalog.skills)}`}
              onClick={() => toggleSkill(skillId)}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
    ) : null

  const toggle = (
    <button
      type="button"
      ref={triggerRef}
      className={`skill-capability-toggle${open ? ' is-open' : ''}`}
      aria-expanded={open}
      aria-controls={panelId}
      aria-haspopup="dialog"
      aria-label="选择教学能力"
      title="选择本次任务可以使用的能力"
      onClick={() => (open ? closePanel() : setOpen(true))}
    >
      <Layers size={15} />
      {selectedSkillIds.length > 0 ? <span>{selectedSkillIds.length}</span> : null}
    </button>
  )

  const panel = open ? (
    <div
      id={panelId}
      className="skill-capability-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={panelTitleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          closePanel()
        }
      }}
    >
      <div className="skill-capability-panel__head">
        <span id={panelTitleId}>选择本次可以使用的能力</span>
        <button ref={closeButtonRef} type="button" aria-label="关闭能力选择" onClick={closePanel}>
          <X size={14} />
        </button>
      </div>

      <div className="skill-capability-panel__section">
        <h4>常用意图</h4>
        <div className="skill-capability-presets">
          {listSkillOrchestrationPresets().map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`skill-capability-preset${presetId === preset.id ? ' is-active' : ''}`}
              aria-pressed={presetId === preset.id}
              aria-label={`${preset.label}：${preset.description}`}
              title={preset.description}
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="skill-capability-panel__section">
        <h4>全部能力</h4>
        <div className="skill-capability-list" role="group" aria-label="可选教学能力">
          {selectable.length === 0 ? (
            <p className="skill-capability-empty">暂无可用能力。</p>
          ) : (
            selectable.map((skill) => {
              const checked = selectedSkillIds.includes(skill.id)
              return (
                <label key={skill.id} className="skill-capability-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSkill(skill.id)}
                  />
                  <span className="skill-capability-option__copy">
                    <strong>{skill.name}</strong>
                    <span>{skill.description}</span>
                  </span>
                  {!skill.installed ? <small>未安装</small> : null}
                </label>
              )
            })
          )}
        </div>
      </div>

      {notice ? (
        <p className="skill-capability-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <div aria-live="polite">
        <SkillOrchestrationPlanPreview preview={preview} catalog={catalog.skills} />
      </div>
    </div>
  ) : null

  return { chips, panel, toggle, selectedSkillIds, clear }
}

/**
 * Renders every planner decision with its reason. A user selection is never
 * silently ignored (solution §7.1) — each capability lands in exactly one
 * bucket, and auto-filled dependencies are labelled as such, not disguised
 * as the user's own choice.
 */
function SkillOrchestrationPlanPreview({
  preview,
  catalog
}: {
  preview: SkillOrchestrationPreviewResult | null
  catalog: readonly SkillSummary[]
}) {
  if (!preview) return null
  if (!preview.ok || !preview.plan) {
    return (
      <p className="skill-capability-notice" role="status" aria-live="polite">
        暂时无法生成计划预览；本轮仍会正常执行。
      </p>
    )
  }

  const plan = preview.plan
  const autoAdded = new Set(preview.autoAddedSkillIds)
  const grouped = new Map<SkillOrchestrationDecisionStatus, SkillOrchestrationDecision[]>()
  for (const decision of plan.decisions) {
    const bucket = grouped.get(decision.status) ?? []
    bucket.push(decision)
    grouped.set(decision.status, bucket)
  }

  return (
    <div className="skill-capability-plan" aria-label="本轮编排计划">
      <h4>本轮计划</h4>
      {STATUS_ORDER.filter((status) => (grouped.get(status)?.length ?? 0) > 0).map((status) => (
        <div key={status} className={`skill-capability-plan__row is-${status}`}>
          <span className="skill-capability-plan__label">{STATUS_LABEL[status]}</span>
          <ul>
            {(grouped.get(status) ?? []).map((decision) => (
              <li key={decision.skillId}>
                <strong>{skillLabel(decision.skillId, catalog)}</strong>
                {autoAdded.has(decision.skillId) ? (
                  <em className="skill-capability-plan__auto">自动加入的前置能力</em>
                ) : null}
                <span>{decision.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {plan.diagnostics.length > 0 ? (
        <ul className="skill-capability-plan__diagnostics">
          {plan.diagnostics.map((diagnostic) => (
            <li key={diagnostic.code} className={`is-${diagnostic.severity}`}>
              {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
