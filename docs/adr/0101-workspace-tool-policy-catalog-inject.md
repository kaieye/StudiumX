# ADR-0101：catalog/read 探针路径注入 workspace tool-policy

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION B-08 residual：capability + connector catalog/read probes）
- **日期：** 2026-07-21
- **范围：** 仅在 `teaching-capability-catalog` 与 `connector-health-catalog` 两条 catalog/read 探针路径，将 workspace 内可选 tool-policy 文档注入 `buildToolContext`；缺文件保持 default-equivalent
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0063](0063-declarative-tool-policy.md)、[ADR-0079](0079-workspace-tool-policy-fs-loader.md)、[ADR-0083](0083-workspace-tool-policy-product-inject.md)、[ADR-0088](0088-workspace-tool-policy-secondary-inject.md)、[ADOPTION B-08](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/main/teaching-capability-catalog.ts`（option B：preloaded `toolPolicyDocument` + `loadToolPolicyForCapabilityCatalog`）
  - `src/main/connector-health-catalog.ts`（option C：async `evaluate` 内 load + inject）
  - `src/main/ai/tools/tool-policy-fs.ts`（loader + `toolPolicyDocumentOption`；本切片无 API 语义变更）
  - `tests/unit/catalog-tool-policy-inject.unit.test.ts`
  - `tests/unit/tool-policy-fs.unit.test.ts`
  - `tests/unit/teaching-capability-catalog.unit.test.ts`

## 背景

ADR-0063 交付声明式 tool-policy；ADR-0079 交付 workspace-contained FS loader；ADR-0083 已在 **primary** `teaching-conversation-runtime` 完成可选注入；ADR-0088 已在 **次级** agent-run（delegation + lesson-plan）完成可选注入，并 **明确推迟** capability / connector catalog 探针路径。

B-08 residual 仍开放：catalog/read 探针里 `buildToolContext` 调用点是否接线，使 readiness / connector 健康表面与 run 路径看到同一 optional workspace policy 文档（缺文件 default-equivalent）。

本切片只接 **两条 catalog/read 探针**：

1. `TeachingCapabilityCatalog` → `describeWebSearch`（web_search readiness 探针）
2. `ConnectorHealthCatalog.evaluate`（connector-health 表面）

不重接 primary/secondary agent-run（已由 0083/0088 负责）。

## 决定

### 1. capability catalog — option B（同步 snapshot + 预加载 optional doc）

`snapshot` / `describeWebSearch` 保持 **同步**（纯测试与 TTL 缓存语义不变）。

1. 扩展 `TeachingCapabilityCatalogRequest`：`toolPolicyDocument?: ToolPolicyDocument | null`（预加载）。
2. `describeWebSearch` 调用：
   `buildToolContext(settings, { workspaceRoot, ...toolPolicyDocumentOption(request.toolPolicyDocument ?? null) })`。
3. 新增薄 async 边沿 helper `loadToolPolicyForCapabilityCatalog(workspaceRoot)`：
   - 非空字符串 root → `loadToolPolicyDocumentFromWorkspace`
   - 缺席 / 空 / 空白 → **不发起 FS 读**，返回 `null`
4. 组合根 / 产品调用方可：`const doc = await loadToolPolicyForCapabilityCatalog(root)` 后传入 `snapshot({ ..., toolPolicyDocument: doc })`。
5. 当前 `src/main` 无额外 snapshot 产品组合根需要强制改接线；helper 作为公共边沿，避免在 sync snapshot 内做 IO。
6. cache key 包含 `toolPolicyDocument` 引用，避免不同 policy 误命中同一 readiness 缓存。

**不** 将 `snapshot` 整体改为 async；**不** 在纯 sync 路径偷偷读盘。

### 2. connector-health catalog — option C（已 async）

`ConnectorHealthCatalog.evaluate` 已是 `async`：

1. 当 `workspace?.rootPath` trim 后非空：`await loadToolPolicyDocumentFromWorkspace({ workspaceRoot })`。
2. 经 `toolPolicyDocumentOption(doc)` 展开注入 `buildToolContext`；`null` → **省略**字段。
3. root 缺席或空：不发起 FS 读。
4. `buildConnectorStatuses` 等调用方无需变更签名。

### 3. Fail-closed / default-equivalent

- Loader 语义仍以 ADR-0079 为准：缺失 / 非法 / 超限 / 逃逸 → `null`。
- **缺文件 ≡ 未注入文档 ≡ 默认 in-process 文档**（`DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT`）。
- **禁止** YOLO / always-approve / argv / `prefix_rule` 产品语言。
- **禁止** 因 policy 文件存在而授予 workspace 工具；grant 门与 capability policy 不变。
- catalog 探针 **不执行** 工具，仅构建 `ToolContext` 供 readiness/provider 查询。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/catalog-tool-policy-inject.unit.test.ts `
  tests/unit/tool-policy-fs.unit.test.ts `
  tests/unit/teaching-capability-catalog.unit.test.ts `
  tests/unit/secondary-tool-policy-inject.unit.test.ts
```

## 不变量

- capability：`snapshot` 保持 sync；FS 仅经 `loadToolPolicyForCapabilityCatalog` 边沿。
- connector：仅 `evaluate` 内按 root 可选 load。
- 磁盘读仅经 ADR-0079 contained / bounded loader。
- 无 shell / MCP marketplace / YOLO / always-approve / autoDrain 翻转。
- 不触碰 settlement sole-writer、`expectedRevision`、`toolsReplayed`。
- 不因 policy 文件绕过 workspace grant / capability policy。

## 明确不包含 / non-claims

- **不** 改 primary conversation inject（ADR-0083）或 secondary agent-run inject（ADR-0088）。
- **不** 改 pure FS loader denylist 或 approvalMode lattice。
- **不** 合并多文件 course policy pack。
- **不** 提供 Granular 审批 UI。
- **不** Capture 全量 tool 执行结果进 catalog；catalog 仍只读 readiness。
- **不** 编辑 ADOPTION.md 正文（协调者 residual 文案）。
