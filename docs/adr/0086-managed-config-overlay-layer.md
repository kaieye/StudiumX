# ADR-0086：Managed 校/团 secret-free 配置 overlay 层

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-11 纯层切片）
- **日期：** 2026-07-21
- **范围：** TeachingConfigResolver 增加可选 `managed` 层；调用方注入 raw 文档；保持 secret-free 投影与 fingerprint CAS 语义
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0025](0025-teaching-config-resolver-secret-free-layers.md)、[ADR-0033](0033-config-optimistic-concurrency.md)、[ADR-0071](0071-workspace-config-denylist.md)、[ADOPTION S-11](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/main/teaching-config-resolver.ts`
  - `src/main/teaching-config-denylist.ts`（层策略注释）
  - `tests/unit/teaching-config-resolver.unit.test.ts`

## 背景

ADR-0025 建立了 `default < user < workspace < session_override` 的 secret-free 分层解析与字段级 provenance；ADR-0071 将 workspace 标为不可信并对 `provider.providers.*.baseUrl` 做 denylist。学校/组织需要在**产品默认之上、个人用户偏好之前**注入一条 baseline（例如统一模型 endpoint 风格、默认 tools 开关、memory 上限），且：

1. 不得把密钥写入普通 resolved snapshot；
2. 不得在本切片绑定产品级 FS 路径或 MDM；
3. 不得改写 CAS 协议——仍对最终 secret-free value 做 `fingerprintTeachingConfig`。

## 决定

### 1. 层序（严格实施）

优先级（低 → 高）：

```
default < managed < user < workspace < session_override
```

| 层 | 角色 | 信任（相对 endpoint denylist） |
| --- | --- | --- |
| `default` | 产品内置 preset | 可设 baseUrl |
| `managed` | 校/团 baseline（调用方注入） | **可设 baseUrl**（信任 org 层，denylist 不生效） |
| `user` | 本机用户偏好 | 可设 baseUrl |
| `workspace` | 工作区 overlay | **denylist 生效**（ADR-0071） |
| `session_override` | 进程内最高覆盖 | 可设 baseUrl |

**排序理由：**

- Managed 落在 default 之后、user 之前：组织 baseline 生效，教师/学习者仍可用 user 层个性化。
- Workspace 仍不可信：endpoint denylist **仅**作用于 workspace（ADR-0071 不变）。
- session_override 保持最高信任进程内覆盖。
- Managed **不是**第二用户 store，也**不是** remote policy fetch 结果；只是 resolver 的一个可选输入槽。

### 2. Scope 与适配器（纯输入）

```ts
export type TeachingConfigSourceKind =
  | 'default'
  | 'managed'
  | 'user'
  | 'workspace'
  | 'session_override'

export type TeachingConfigScope = {
  fallbackDefaultRoot: string
  managed?: unknown
  user?: unknown
  workspace?: unknown
  sessionOverride?: unknown
}
```

`resolveTeachingConfigFromSettings(settings, options)` 增加可选 `options.managed`，原样传入 `resolveTeachingConfig`。

**无 FS loader：** 本切片不规定 managed 文件路径、不读磁盘；未来 host / Electron / 部署脚本可注入 raw 文档。设计允许后续 FS 注入，但不授权本 ADR 实现加载器。

### 3. Secret-free 与诊断

- Managed 与其它层共用 `collectSecretDiagnostics` / secret path 剥离；出现密钥记 `secret_stripped`（severity `warning`），**永不**进入普通 snapshot。
- 非法 managed 层（非 plain object）记 `invalid_layer` 并整层跳过，与现有层行为一致。
- 无效字段记 `invalid_field` 并省略该字段。

### 4. CAS / fingerprint 语义（不变）

- `fingerprint` 仍为最终 secret-free `TeachingLoopConfigValue` 的确定性 `sha256:<hex>`。
- **不**引入独立 managed CAS 协议；optimistic writer 继续对最终 fingerprint 做 `expectedFingerprint` 比对（ADR-0033）。
- Managed 改变有效 teaching-loop 字段 → fingerprint 变；仅非投影噪声字段 → fingerprint 不变。

### 5. Denylist 边界

- `WORKSPACE_CONFIG_DENYLIST_LAYERS` 仍仅为 `['workspace']`。
- Managed 可设置 `provider.providers.*.baseUrl`（信任 org）；workspace 仍不可覆盖该路径，且不得把 baseUrl 的 field source 标为 `workspace`。
- Secret strip 与 denylist 正交：managed 若携带 apiKey 仍被剥离。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/teaching-config-resolver.unit.test.ts
```

## 不变量

- 层序固定为 `default < managed < user < workspace < session_override`。
- 普通 snapshot 无密钥（含 managed 输入中的密钥路径）。
- Fingerprint 仅对最终 secret-free value；无单独 managed CAS。
- Resolver 纯函数、无 I/O。
- Workspace baseUrl denylist 仅 workspace；managed 可设 baseUrl。

## 明确不包含 / non-claims

- **不是** MDM / Intune / 设备管理集成。
- **不是** remote policy fetch / phone-home / 默认远程 telemetry。
- **不是** 产品级 managed 文件路径或 Electron IPC / UI 上传面。
- **不是** 在 managed 文档中存储或投影密钥；密钥路径一律 strip。
- **不是** YOLO / always-approve / shell 工具或工具策略改动。
- **不** 修改 optimistic writer CAS 协议本身（仅 resolver 接受新层）。
- **不** peel teaching-workspace / 触碰 tool-policy / doctor / turn-review。
- 产品 inject / FS residual 为可选后续；本切片仅 pure layer + adapter 接线。
