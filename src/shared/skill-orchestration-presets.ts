/**
 * Host-owned product intent presets for skill orchestration (ADR-0163 §2.3).
 *
 * A preset is a *selection convenience*: it expands a product intent into
 * builtin capability skill ids. It is NOT an authority — the expanded set still
 * goes through the pure `plan(...)` planner, which retains final adjudication
 * over readiness, dependencies, conflicts and budget.
 *
 * Personal / custom skills can never extend this catalog (ADR-0151 §2.2:
 * host registry is the trust authority, skill self-declaration is only a hint).
 *
 * `teach` never appears here — the Teaching Kernel is injected by the host in
 * teaching mode and never occupies a user-facing selection slot (ADR-0151 §2.1).
 */

export type SkillOrchestrationPresetId =
  | 'learn_topic'
  | 'check_mastery'
  | 'make_lesson'
  | 'build_course_site'
  | 'audit_course'
  | 'publish_package'

export type SkillOrchestrationPreset = {
  id: SkillOrchestrationPresetId
  label: string
  /** One-line product description shown under the preset chip. */
  description: string
  /** Builtin capability skill ids, excluding the `teach` kernel. */
  skillIds: string[]
  /** Prefer the artifact kernel profile (course production, not learner outcome). */
  preferArtifactProfile: boolean
}

const PRESETS: readonly SkillOrchestrationPreset[] = [
  {
    id: 'learn_topic',
    label: '教我掌握一个主题',
    description: '教学内核带你学；需要时再阶段性加入评估能力。',
    skillIds: [],
    preferArtifactProfile: false
  },
  {
    id: 'check_mastery',
    label: '测测我学会没有',
    description: '先诊断并提问，结果仍走 typed Evidence 与既有结算路径。',
    skillIds: ['learning-assessor'],
    preferArtifactProfile: false
  },
  {
    id: 'make_lesson',
    label: '生成一节课或练习',
    description: '按大纲 → 讲义 → 练习产出课程材料；生成本身不是学习结果。',
    skillIds: ['course-outline-design', 'course-content-authoring', 'teaching-resource-generator'],
    preferArtifactProfile: true
  },
  {
    id: 'build_course_site',
    label: '制作完整课程网站',
    description: '由 teaching-site 路由，按阶段激活 SPA、交互与视觉能力。',
    skillIds: [
      'teaching-site',
      'static-spa-conversion',
      'static-spa-interactions',
      'teaching-site-design-system',
      'web-visual-assets'
    ],
    preferArtifactProfile: true
  },
  {
    id: 'audit_course',
    label: '审核课程产物',
    description: '内容与视觉审计；verifier 只产出诊断，不等于学习结果。',
    skillIds: ['web-content-audit', 'web-visual-verification'],
    preferArtifactProfile: true
  },
  {
    id: 'publish_package',
    label: '发布企业版或电子书',
    description: '需要稳定的 canonical 课程产物；缺少前置产物时会被阻止。',
    skillIds: ['course-corporate-edition', 'course-ebook-publishing'],
    preferArtifactProfile: true
  }
]

const BY_ID = new Map(PRESETS.map((preset) => [preset.id, preset] as const))

export function listSkillOrchestrationPresets(): readonly SkillOrchestrationPreset[] {
  return PRESETS
}

export function getSkillOrchestrationPreset(
  presetId: string
): SkillOrchestrationPreset | null {
  const id = String(presetId ?? '').trim()
  return BY_ID.get(id as SkillOrchestrationPresetId) ?? null
}

/** Allow-listed preset id echo for diagnostics — unknown ids collapse to undefined. */
export function sanitizeSkillOrchestrationPresetId(
  presetId: string | undefined
): SkillOrchestrationPresetId | undefined {
  return getSkillOrchestrationPreset(String(presetId ?? ''))?.id
}
