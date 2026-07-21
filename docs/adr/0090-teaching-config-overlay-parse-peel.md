# ADR-0090：TeachingConfig overlay 纯解析 peel

- **状态：** 已实施（ADOPTION S-03 residual by-touch peel）
- **日期：** 2026-07-21
- **范围：** 将 `teaching-config-resolver` 中**纯** overlay 字段解析 / assign 助手抽到旁路模块；**不**改层序、denylist、secret 投影或 fingerprint CAS
- **相关：** [ADR-0025](0025-teaching-config-resolver-secret-free-layers.md)、[ADR-0071](0071-workspace-config-denylist.md)、[ADR-0075](0075-module-size-policy-and-giant-peel.md)、[ADR-0086](0086-managed-config-overlay-layer.md)、[ADOPTION S-03](0121-improvements-adoption-closeout.md)
- **证据路径：**
  - `src/main/teaching-config-overlay-parse.ts`（新）
  - `src/main/teaching-config-resolver.ts`（import + 保留 merge / fingerprint / 公共导出）
  - `tests/unit/teaching-config-resolver.unit.test.ts`（无行为变更；导入面不变）
  - `docs/adr/0090-teaching-config-overlay-parse-peel.md`（本文件）

## 背景

ADR-0075 将模块尺寸政策与巨石 **按触达 peel** 纪律正式化；`teaching-config-resolver.ts` 在 S-11 managed 层加入后逼近 / 越过 ~1000 行软高告警带。文件内同时承载：

1. 层序 merge / SOURCE_ORDER / diagnostics 聚合 / secret walk / fingerprint（产品边界）；
2. 单层 overlay 的严格字段解析与 `assign*` 助手（纯函数、无 I/O）。

第 2 类与第 1 类无状态耦合，适合按触达 peel，避免继续把 resolver 当「最大文件垃圾桶」。

## 决定

### 1. 新模块边界

| 模块 | 职责 |
| --- | --- |
| `teaching-config-overlay-parse.ts` | `parseTeachingLoopOverlay`、`ParsedOverlay`、以及仅被解析使用的 `assignString` / `assignBoolean` / `assignInteger` / `assignNumber` / `assignEnum` / `requireObject` / `invalidField` 与局部 `isPlainObject` |
| `teaching-config-resolver.ts` | `resolveTeachingConfig` / `createTeachingConfigResolver` / SOURCE_ORDER / layer merge（`applyOverlay`）/ denylist 再投影语义 / secret strip / fingerprint / 既有 **public exports** |

解析模块仍调用 denylist 谓词（`isDeniedForConfigLayer` / `isWorkspaceConfigDenylistLayer`）以在 **parse 阶段** 忽略 workspace `baseUrl` 并记 `workspace_denylist`——与 peel 前行为一致；**产品策略**仍以 ADR-0071 / denylist 模块为准。

### 2. 公共 API 稳定性

- 外部继续只从 `teaching-config-resolver` 导入（`resolveTeachingConfig`、`fingerprintTeachingConfig`、denylist re-export 等）。
- **不**把 `parseTeachingLoopOverlay` / `ParsedOverlay` 提升为产品公共面（内部实现细节；测试不依赖它们）。
- 无配置字段增删、无 YOLO / shell / MCP marketplace、无层序变更。

### 3. 层序与安全不变量（不变）

```
default < managed < user < workspace < session_override
```

- 普通 snapshot **无密钥**；secret path 仍由 resolver 的 `collectSecretDiagnostics` / `assertNoSecrets` 处理。
- Fingerprint 仍对最终 secret-free value 做 `sha256:<hex>`（ADR-0033 CAS 语义不变）。
- Workspace baseUrl denylist 仍仅 workspace（ADR-0071）；managed 可设 baseUrl（ADR-0086）。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/teaching-config-resolver.unit.test.ts
```

可选：`pnpm run check:module-size`（warning-only；resolver 行数应实质下降）。

## 不变量

- 解析行为与 peel 前字段诊断一致（同测套绿）。
- Resolver 公共导出符号名不变。
- 无 I/O、无 host managed FS inject（S-11 residual 另项）。
- 不触达 `teaching-workspace` / `learning-session-ledger` / `teaching-turn-coordinator` 巨石。

## 明确不包含 / non-claims

1. **不** peel teaching-workspace / ledger / coordinator 三巨石（仍为 S-03 residual by-touch）。
2. **不** 改 managed/user/workspace 层语义或 SOURCE_ORDER。
3. **不** 新增 managed FS/host 自动注入（S-11 residual）。
4. **不** 改 denylist 路径集合或 session_override 信任边界。
5. **不** 把 `check:module-size` 升为 Blocking CI。
6. **不** 引入 shell / YOLO / MCP marketplace / 远程 telemetry。

## 与 ADOPTION S-03 的关系

- ADR-0075 政策切片已落地；本 ADR 是 **触达优先** 的单文件 residual peel。
- 建议 residual 措辞：S-03 政策 + config-resolver overlay-parse peel 已落地；**巨石**（workspace / ledger / coordinator 等）仍仅按触达 peel，禁止三线并行大搬家。
