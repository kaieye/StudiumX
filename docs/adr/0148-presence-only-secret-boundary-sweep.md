# ADR-0148：Presence-only 密钥边界扫尾（LiveAgent Phase B）

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** **已实施**（2026-07-24）
- **日期：** 2026-07-24
- **范围：** 跨 IPC、Doctor、support-bundle 公共面（及未来多窗口）统一 **presence-only** 密钥语义：对外通信只暴露「已配置 / 未配置」；**从不**带 raw key/token；**无**默认远程 telemetry。
- **取代：** 无
- **被取代：** 无
- **相关：** LiveAgent 历史研究清单（已结项） §3.4 / Phase B；[ADR-0007](0007-persisted-user-history-redaction.md)；[ADR-0025](0025-teaching-config-resolver-secret-free-layers.md)；[ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)；[ADR-0034](0034-redacted-support-bundle.md)；[ADR-0107](0107-support-bundle-common-redact-switch.md)；[ADR-0127](0127-user-configurable-mcp-design-gate.md)；[ADR-0135](0135-mcp-oauth-pkce-and-secret-token-lifecycle.md)；[ADR-0142](0142-mcp-product-surface-settings-only.md)；[ADR-0121](0121-improvements-adoption-closeout.md)；`AGENTS.md`；`SECURITY.md`
- **证据：** `src/shared/secret-presence.ts`；MCP `toPublicServer` / import-export `SECRET_FIELD_KEY_RE`；`src/main/mcp/redact.ts`；Doctor config facts；support-bundle denied-field 扩展；capability cache `hasApiKey` presence

## 1. 问题

本地优先产品已有多边界（IPC、Doctor、support-bundle、Settings 投影）上的脱敏路径，但密钥语义不完全统一。LiveAgent（Gateway 只传「已配置」不传真 key）启发 **间隙扫尾**：避免新字段或 collector 漏 secret。

本 ADR 是 **边界一致性**，不是 telemetry 平台。

## 2. 决定

### 2.1 Presence-only 语义

| 表面 | 允许 | 禁止 |
| --- | --- | --- |
| **Public DTO / IPC 终站** | `configured: true/false`、`hasApiKey`、`envSecretConfigured` 等 **无密钥** 指示 | raw API key、OAuth refresh/access token、client secret、明文 Authorization |
| **Doctor facts** | 密钥配置齐全 / 缺失类布局与安全元数据 | 把 secret 写入 facts JSON |
| **Support-bundle** | 经统一 redact 且 **经用户同意** 导出 | 默认带 raw secrets；未同意外发 |
| **日志** | 既有 redact 边界 | 打印 header 中的 Bearer / x-api-key 值 |

### 2.2 共享 helper

`src/shared/secret-presence.ts`：

- `SECRET_FIELD_KEY_RE` / `isSecretFieldKey` — 字段名 detector（MCP parse/export 共用）
- `isSecretConfigured` / `hasAnySecretConfigured` — presence 检查，永不返回原值
- `projectSecretPresenceMap` — ref map → `Record<string, boolean>`

MCP public DTO（`toPublicServer`）对 command/args 做轻量 assignment/provider-token scrub（不重写路径；路径 scrub 仍属 doctor/support）。

### 2.3 扫尾清单（本 PR）

1. MCP public DTO / Settings 投影：presence map + args scrub。
2. Provider capability cache：`hasApiKey` 仅 boolean。
3. TeachingDoctor config collector：`isSecretConfigured` 判定。
4. Support-bundle：扩展 denied fields + compact secret-name heuristic（不误伤 `authorizationState`）。
5. `mcp/redact.ts`：re-export presence helper for main MCP path.

### 2.4 红线

1. **无默认远程 telemetry** / phone-home（`AGENTS.md` 产品地板）。
2. Support-bundle **同意门控** 不变。
3. Secret 存储仍 main-only / OS 安全存储路径；本 ADR **不**把 secret 新导入 renderer「为了调试」。
4. 扫尾 **不** 放开 settlement、effect lattice 或 MCP marketplace Settings（ADR-0142）。

## 3. 证据路径

```text
src/shared/secret-presence.ts
src/shared/mcp/config-schema.ts          # toPublicServer + SECRET_FIELD_KEY_RE
src/shared/mcp/import-export.ts          # SECRET_FIELD_KEY_RE
src/main/mcp/redact.ts                   # projectMcpSecretPresence
src/main/observability/teaching-doctor-config-facts.ts
src/main/support-bundle.ts               # denied-field expansion
src/main/teaching-capability-catalog.ts  # hasApiKey presence comment
tests/unit/secret-presence.unit.test.ts
tests/unit/mcp-config-schema.unit.test.ts
tests/unit/support-bundle.unit.test.ts
```

```powershell
CI=true pnpm exec vitest run --project unit `
  tests/unit/secret-presence.unit.test.ts `
  tests/unit/mcp-config-schema.unit.test.ts `
  tests/unit/mcp-secret-merge.unit.test.ts `
  tests/unit/support-bundle.unit.test.ts `
  tests/unit/teaching-doctor-config-facts.unit.test.ts
```

## 4. 与其它 ADR 的关系

| 文档 | 关系 |
| --- | --- |
| ADR-0025 / 0007 | secret-free 配置与历史 redact **基线** |
| ADR-0034 / 0107 | support-bundle 同意 + common redact **叠加** 扫尾 |
| ADR-0135 / 0142 | OAuth token main-only；Settings 无 marketplace；public 无 secret |
| ADR-0121 | 开放项须新 ADR；本条关闭 Phase B presence 扫尾 |

## 5. 非目标

- 不建设远程密钥同步或云端 vault 产品。
- 不实施会话 Pin / FTS。
- 不把 presence 标志当作 teaching evidence。

## 6. 一句话

**跨 IPC / Doctor / support-bundle 统一 presence-only：只报是否配置，不报 raw key；无默认远程 telemetry；扫尾查漏不降产品地板。**
