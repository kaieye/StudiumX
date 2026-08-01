import { Layers, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  listSkillOrchestrationPresets,
  type SkillOrchestrationPresetId
} from '../../../shared/skill-orchestration-presets'
import type {
  SkillOrchestrationDecision,
  SkillOrchestrationDecisionStatus,
  SkillOrchestrationMode,
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
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const requestSeq = useRef(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const panelTitleId = useId()

  // Eligibility comes from the main-process host projection. The renderer
  // never reconstructs the builtin registry or treats a catalog entry as formal
  // teaching authority on its own.
  //
  // The preset path is intentionally separate: its host-owned intent may
  // explicitly request an artifact workflow. Raw capability selection, by
  // contrast, must only offer capabilities admitted to the current composer
  // mode, so the renderer never offers a choice the planner will immediately
  // reject as mode-ineligible.
  const orchestrationMode: SkillOrchestrationMode = options.isTeachingMode
    ? 'teaching_turn'
    : 'instant_help'
  const selectable = useMemo(
    () =>
      catalog.skills.filter(
        (skill) =>
          skill.id !== KERNEL_SKILL_ID &&
          skill.orchestration?.formalTeachingEligible === true &&
          skill.orchestration.selectionSurface === 'default' &&
          skill.orchestration.trustLevel === 'host_governed' &&
          skill.orchestration.allowedModes.includes(orchestrationMode)
      ),
    [catalog.skills, orchestrationMode]
  )
  const advancedOnly = useMemo(
    () =>
      catalog.skills.filter(
        (skill) =>
          skill.id !== KERNEL_SKILL_ID &&
          skill.orchestration?.selectionSurface === 'advanced'
      ),
    [catalog.skills]
  )

  const clear = useCallback(() => {
    setSelectedSkillIds([])
    setPresetId(null)
    setPreview(null)
    setNotice(null)
    setAdvancedOpen(false)
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
      // Web's fail-closed adapter may throw before returning a Promise. Start
      // from a resolved Promise so the preview remains an inert, dismissible
      // enhancement instead of producing an uncaught timer exception.
      void Promise.resolve()
        .then(() => api.previewSkillOrchestration({
          selectedSkillIds,
          userInput: userInputRef.current,
          isTeachingConversation: options.isTeachingMode,
          ...(presetId ? { presetId } : {}),
          ...(options.conversationId ? { conversationId: options.conversationId } : {}),
          ...(options.workspaceId ? { workspaceId: options.workspaceId } : {})
        }))
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

  // ADR-0165: the always-on "教学内核已启用" chip is removed from above the
  // composer input. The teaching kernel is host-injected, fail-closed, and
  // never a learner-selectable slot (ADR-0151 §2.1), so the chip conveyed no
  // actionable state. Selected-capability chips still render when chosen.
  const chips =
    selectedSkillIds.length > 0 ? (
      <div className="skill-capability-chips" aria-label="已选教学能力">
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
      aria-label="教学意图与能力设置"
      title="先选择教学意图；高级能力不会自动获得正式教学权威"
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
        <span id={panelTitleId}>教学意图与能力设置</span>
        <button ref={closeButtonRef} type="button" aria-label="关闭教学能力设置" onClick={closePanel}>
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

      {selectable.length > 0 || advancedOnly.length > 0 ? (
        <div className="skill-capability-panel__section skill-capability-panel__advanced">
          <button
            type="button"
            className="skill-capability-advanced-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            高级能力设置
          </button>
          {advancedOpen ? (
            <>
              <h4>受平台治理的能力</h4>
              <p className="skill-capability-hint">正式教学仍由统一教学内核和编排计划决定；安装更多能力不会自动提升教学权威。</p>
              <div className="skill-capability-list" role="group" aria-label="可选的受平台治理教学能力">
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

              {advancedOnly.length > 0 ? (
                <div className="skill-capability-advisory" role="group" aria-label="高级个人或未注册能力">
                  <h4>个人与未注册能力</h4>
                  <div className="skill-capability-list">
                    {advancedOnly.map((skill) => (
                      <div key={skill.id} className="skill-capability-option is-advisory">
                        <span className="skill-capability-option__copy">
                          <strong>{skill.name}</strong>
                          <span>{skill.orchestration?.reason}</span>
                        </span>
                        <small>不参与正式教学链路</small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

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
