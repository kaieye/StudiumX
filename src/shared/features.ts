/**
 * Thin teaching-only FeatureRegistry (ADOPTION S-05 / ADR-0073).
 *
 * Pure metadata + stage lifecycle for product features. This is **not**:
 * - a second capability / authorization system (see TeachingCapabilityCatalog)
 * - a Footprint Ladder replacement (ADR-0046)
 * - an effect / settlement / toolsReplayed bypass
 *
 * Invariants:
 * - Features are documentation + stage metadata only. Execution still goes through
 *   TOOL_CONTRACT, effect lattice, CapabilityCatalog readiness, and settlement
 *   sole-writer (`expectedRevision`, `toolsReplayed: false`).
 * - Must not introduce shell, code_mode, remote telemetry, YOLO, or always-approve
 *   as enablement bypass keys. Local MCP marketplace may be registered as
 *   under_development metadata only (ADR-0140); it is never an authorization bypass.
 * - `isFeatureEnabled` is a pure stage gate for product/doctor consumers; it does
 *   not grant tools, write policy, or network.
 */

/** Stage lifecycle aligned with Codex intent (snake_case for JSON/doctor). */
export type FeatureStage =
  | 'under_development'
  | 'experimental'
  | 'stable'
  | 'deprecated'
  | 'removed'

export const FEATURE_STAGES = [
  'under_development',
  'experimental',
  'stable',
  'deprecated',
  'removed'
] as const satisfies readonly FeatureStage[]

/** Footprint Ladder step hint (ADR-0046) — documentation only, not enforcement. */
export type FootprintHint = 1 | 2 | 3 | 4 | 5

/**
 * Metadata-only feature definition.
 * `id` is a stable kebab-case product id (not a tool name / capability kind).
 */
export type FeatureDefinition = Readonly<{
  id: string
  stage: FeatureStage
  /** Short human label (Chinese OK). */
  title: string
  summary?: string
  /** Semver-ish or date string when the feature entered this stage. */
  since?: string
  /** Successor feature id when deprecated/removed. */
  replacedBy?: string
  /** ADR-0046 ladder step documentation only. */
  footprintHint?: FootprintHint
}>

export type FeatureEnableOptions = Readonly<{
  /** When true, `experimental` features report enabled. Default false. */
  allowExperimental?: boolean
  /**
   * When true, `under_development` features report enabled.
   * Default false — never product-on without explicit opt-in.
   */
  allowUnderDevelopment?: boolean
}>

/**
 * Known-dangerous keys that must never appear in a feature-flag bag as product
 * bypasses of effect / settlement / tools / shell policy.
 * Pure list; used by `assertNoBypassKeys`.
 */
export const DANGEROUS_FEATURE_FLAG_KEYS = [
  'yolo',
  'danger_full_access',
  'always_approve',
  'tools_replayed',
  'bypass_settlement',
  'shell',
  'code_mode'
] as const

export type DangerousFeatureFlagKey = (typeof DANGEROUS_FEATURE_FLAG_KEYS)[number]

/** Forbidden feature ids that must never appear in the FEATURES table. */
export const FORBIDDEN_FEATURE_IDS = [
  'shell',
  'code_mode',
  'yolo',
  'danger_full_access',
  'always_approve',
  'remote_telemetry',
  'tools_replayed',
  'bypass_settlement'
] as const

/**
 * Static seed of real StudiumX teaching product features.
 * Stages are honest: shipped product paths = stable; planned/experimental only when true.
 */
export const FEATURES: readonly FeatureDefinition[] = [
  {
    id: 'consent-gated-learner-memory',
    stage: 'stable',
    title: '同意门控学习者记忆',
    summary:
      '无人批不自动注入 / 不启动自动 memory phase；词法 recall 仅在同意后可用。',
    since: '2026-07',
    footprintHint: 3
  },
  {
    id: 'temporary-chat',
    stage: 'stable',
    title: '临时对话（严格 schema 子集）',
    summary:
      'temporary-chat 与 teaching-chat 对齐工具面，差距仅限教学文件生成（如 generate_lesson）；可共享用户 MCP；不得变成 teaching 超集，不得因临时扩大诊断面/shell。',
    since: '2026-07',
    footprintHint: 5
  },
  {
    id: 'teaching-capability-catalog',
    stage: 'stable',
    title: '教学能力就绪投影',
    summary:
      'TeachingCapabilityCatalog 只读 readiness 投影；不进 prompt 旁路，不替代 effect policy。',
    since: '2026-07',
    footprintHint: 3
  },
  {
    id: 'support-bundle-redacted-export',
    stage: 'stable',
    title: '脱敏支持包导出',
    summary: '预览 + 同意门控导出；无 raw prompt/secret/完整绝对路径；无自动上传。',
    since: '2026-07',
    footprintHint: 2
  },
  {
    id: 'local-observability-crash-marker',
    stage: 'stable',
    title: '本地可观测性与 crash marker',
    summary:
      '进程内 turn/tool 相关与 appData crash marker；fail-closed 脱敏；无默认远程 telemetry。',
    since: '2026-07',
    footprintHint: 2
  },
  {
    id: 'workspace-config-denylist',
    stage: 'stable',
    title: 'Workspace 配置 denylist',
    summary:
      '不可信 workspace 层拒绝 provider.providers.*.baseUrl 等敏感 endpoint 覆盖。',
    since: '2026-07',
    footprintHint: 2
  },
  {
    id: 'agent-session-facade',
    stage: 'stable',
    title: 'Agent 会话门面与 busy 队列',
    summary:
      'AgentSessionFacade 有状态门面；busy 输入有界队列；不替换 TeachingSessionProtocol / settlement。',
    since: '2026-07',
    footprintHint: 2
  },
  {
    id: 'lexical-memory-search',
    stage: 'stable',
    title: '词法记忆检索',
    summary: 'main-only 词法检索（零 LLM、无 FTS/向量库产品搜索）；人批 remember/forget。',
    since: '2026-07',
    footprintHint: 3
  },
  {
    id: 'post-turn-review-candidates',
    stage: 'experimental',
    title: '回合后复习候选（人批）',
    summary:
      '教学安全版 post-turn review：仅候选 + 人批；禁止自动 skill 创建与静默改 learner-profile。',
    since: '2026-07',
    footprintHint: 2
  },
  {
    id: 'headless-teaching-agent-protocol',
    stage: 'under_development',
    title: 'Headless Teaching Agent Protocol',
    summary: 'stdio JSON-RPC 薄层，默认仅测试/CI；不默认产品暴露。',
    since: '2026-07',
    footprintHint: 2
  },
  {
    id: 'managed-config-overlay',
    stage: 'under_development',
    title: 'Managed 配置层（校/团）',
    summary: 'secret-free managed overlay 规划中；须与 CAS / denylist 仔细设计。',
    since: '2026-07',
    footprintHint: 2
  },
  {
    id: 'user_mcp_servers',
    stage: 'experimental',
    title: '用户可配置 MCP',
    summary:
      'userData opt-in MCP servers (default off); stdio/HTTP/SSE; tools use registry/effect/approval (no YOLO); Settings = list/editor only (ADR-0142).',
    since: '2026-07',
    footprintHint: 4
  },
  {
    id: 'mcp-marketplace',
    stage: 'under_development',
    title: 'MCP Marketplace',
    summary:
      'Main/shared marketplace catalog foundation (ADR-0140). No Settings marketplace UI (ADR-0142). Tool calls still use effect/approval. Not a YOLO bypass; secrets stay in main.',
    since: '2026-07',
    footprintHint: 3
  }
] as const

const FEATURE_BY_ID: ReadonlyMap<string, FeatureDefinition> = new Map(
  FEATURES.map((feature) => [feature.id, feature])
)

export function isFeatureStage(value: unknown): value is FeatureStage {
  return typeof value === 'string' && (FEATURE_STAGES as readonly string[]).includes(value)
}

/**
 * Pure stage → enabled matrix (no table lookup).
 * Used by `isFeatureEnabled` and unit tests for deprecated/removed without seeding them.
 */
export function isStageEnabled(stage: FeatureStage, opts: FeatureEnableOptions = {}): boolean {
  switch (stage) {
    case 'stable':
      return true
    case 'experimental':
      return opts.allowExperimental === true
    case 'under_development':
      return opts.allowUnderDevelopment === true
    case 'deprecated':
    case 'removed':
      return false
    default: {
      const _exhaustive: never = stage
      return _exhaustive
    }
  }
}

/** Pure list of all registered feature definitions (stable order). */
export function listFeatures(): readonly FeatureDefinition[] {
  return FEATURES
}

/** Lookup by stable feature id. */
export function getFeature(id: string): FeatureDefinition | undefined {
  if (typeof id !== 'string' || !id) return undefined
  return FEATURE_BY_ID.get(id)
}

/**
 * Stage-based enablement (metadata only).
 * Default product surface: only `stable`.
 * - experimental → require allowExperimental
 * - under_development → require allowUnderDevelopment (never default product-on)
 * - deprecated / removed → always false
 * Unknown ids → false
 */
export function isFeatureEnabled(id: string, opts: FeatureEnableOptions = {}): boolean {
  const feature = getFeature(id)
  if (!feature) return false
  return isStageEnabled(feature.stage, opts)
}

/**
 * Scan a feature-flag bag for known-dangerous bypass keys.
 * Returns rejected key names present in `flags` (case-sensitive exact match on
 * the dangerous set; also rejects common casing variants via lower-case compare).
 * Pure; does not throw.
 */
export function assertNoBypassKeys(flags: Record<string, unknown>): string[] {
  if (!flags || typeof flags !== 'object') return []
  const rejected: string[] = []
  const dangerous = new Set<string>(DANGEROUS_FEATURE_FLAG_KEYS)
  for (const key of Object.keys(flags)) {
    const normalized = key.trim().toLowerCase().replace(/-/g, '_')
    if (dangerous.has(normalized)) {
      rejected.push(key)
    }
  }
  return rejected
}

/** Count of seeded features (doctor / diagnostics convenience). */
export function featureCount(): number {
  return FEATURES.length
}
