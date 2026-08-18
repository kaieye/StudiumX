# ADR-0092：Managed 配置 fail-closed FS loader 与产品 re-resolve 保真

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-11 residual：FS loader + optimistic-writer preserve）
- **日期：** 2026-07-21
- **范围：** 在调用方供给的绝对根（典型为 Electron `userData` 或测试 temp）下，通过 contained / bounded IO 可选读取 secret-free managed 配置 JSON；提供薄 inject helper；修复 config optimistic writer 在 CAS 重解析时丢弃 `managed` 的 residual bug
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0086](0086-managed-config-overlay-layer.md)、[ADR-0033](0033-config-optimistic-concurrency.md)、[ADR-0071](0071-workspace-config-denylist.md)、[ADR-0079](0079-workspace-tool-policy-fs-loader.md)、[ADR-0090](0090-teaching-config-overlay-parse-peel.md)、[ADOPTION S-11](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `src/main/teaching-managed-config-fs.ts`（新）
  - `src/main/config-optimistic-writer.ts`（preserve `managed`）
  - `src/shared/teaching-types/config-optimistic-write.ts`（store snapshot 可选 `managed`）
  - `tests/unit/teaching-managed-config-fs.unit.test.ts`
  - `tests/unit/config-optimistic-writer.unit.test.ts`

## 背景

ADR-0086 交付了 resolver 纯层：`default < managed < user < workspace < session_override`，调用方注入 raw 文档；明确 **无** 产品 FS 路径与 MDM。S-11 residual 需要：

1. 与 tool-policy FS loader（ADR-0079）同构的 **fail-closed** 磁盘读，但根在 **userData / 调用方根**，**不** 落在不可信 workspace。
2. 产品 CAS 重解析路径（`compareAndProjectConfigWrite` / `writeConfigOptimistic`）在 user/workspace 写入时 **不得** 丢掉已注入的 `managed` 层。

产品地板：无 MDM、无 remote policy fetch、managed 文档不承载密钥存储特性、无 YOLO。

## 决定

### 1. 新模块 `teaching-managed-config-fs.ts`

| 导出 | 含义 |
| --- | --- |
| `DEFAULT_MANAGED_CONFIG_RELATIVE_PATH` | `'studiumx-managed-config.json'` |
| `MANAGED_CONFIG_MAX_BYTES` | `64 * 1024` |
| `loadManagedConfigDocumentFromRoot({ rootPath, relativePath?, maxBytes? })` | 异步：contained 读 → plain-object JSON → `unknown \| null` |
| `loadManagedConfigDocumentFromJsonText(text)` | 纯 helper：`JSON.parse` + plain-object 门禁 |
| `managedConfigOption(document)` | 仅当 plain object 时 spread `{ managed }`；miss 省略字段 |
| `scopeWithManaged(scope, managed)` | 组合根薄 helper：有文档则挂 `managed`，否则省略 |
| `normalizeManagedRelativePath` | 本地相对路径规范化（拒 `..` / 绝对 / 盘符），不拉 write-policy 图 |

### 2. 路径与根模型

- **根：** 调用方供给的绝对（或 cwd 相对）路径，典型 Electron `userData`；**不是** 工作区根。
- **默认相对路径：** `studiumx-managed-config.json`。
- 相对路径经 `normalizeManagedRelativePath` + `isLexicallyInsideRoot` 后，调用 `readContainedRegularFileBounded`。

### 3. Fail-closed 语义

下列情况一律返回 **`null`（不抛）**：

- 根路径为空
- 相对路径非法 / 逃逸
- 文件缺失、非普通文件、符号链接、contained 校验失败
- 超过 bounded 上限（默认 64 KiB）
- JSON 非法
- 顶层非 plain object（array / null / primitive）

**不** 在此模块重实现 teaching-loop schema：解析出的 `unknown` 交 resolver（ADR-0086）做字段校验与 secret strip。

### 4. Inject helper

```ts
managedConfigOption(doc) // → {} | { managed: unknown }
scopeWithManaged(scope, doc) // → TeachingConfigScope with optional managed
```

缺文件 / 非法文档时 **省略** `managed` 字段，resolver 跳过 managed 层（与 ADR-0086 一致）。

### 5. Optimistic writer 保真（product path residual）

- `compareAndProjectConfigWrite` 构建 `nextScope` 时 **复制** `baseScope.managed`（若存在）。
- `writeConfigOptimistic` 在 `currentResolved` 与 `baseScope` 中透传 `current.managed`（store snapshot 可选字段）。
- `ConfigOptimisticStoreRead` 增加可选 `managed?: unknown`。
- **不** 在 writer 内自动读盘；FS 加载由组合根调用 `loadManagedConfigDocumentFromRoot` + `managedConfigOption` / `scopeWithManaged`。

### 6. 不变边界

- 层序仍为 ADR-0086。
- Workspace denylist 仍仅 workspace（ADR-0071）。
- Fingerprint / CAS 协议不变（ADR-0033）；仅保证 re-resolve 输入层完整。
- Secret strip 仍由 resolver 负责；loader 不把密钥写入磁盘特性。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/teaching-managed-config-fs.unit.test.ts `
  tests/unit/config-optimistic-writer.unit.test.ts `
  tests/unit/teaching-config-resolver.unit.test.ts
```

## 不变量

- Managed 文档根在调用方 root（userData），不在 untrusted workspace。
- 磁盘读仅经 `path-access` contained / bounded API。
- 缺文件 / 坏文档 → `null` → 省略 managed 字段 → resolver 跳过层。
- CAS 重解析不丢 `baseScope.managed` / store `managed`。
- 无 MDM、无 remote fetch、无 YOLO。

## 明确不包含 / non-claims

- **不是** MDM / Intune / 设备管理集成。
- **不是** remote policy download / phone-home。
- **不是** renderer 上传 UI 或 Electron 自动分发。
- **不是** 在 managed 文档中存储 / 投影密钥为特性。
- **不** 改变 workspace denylist 作用域。
- **不** 翻转 B-02 autoDrain / 改 teaching-ipc-gateway。
- **不** peel teaching-workspace 巨石。
- **不** 编辑 ADOPTION.md 正文（由协调者更新 residual 文案）。
