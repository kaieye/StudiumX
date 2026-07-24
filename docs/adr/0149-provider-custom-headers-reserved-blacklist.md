# ADR-0149：Provider custom headers + 保留键黑名单（LiveAgent Phase B）

- **状态：** **已实施**（2026-07-24）：`src/shared/provider-custom-headers.ts` + settings normalize + `request-builder` / probe 接线
- **日期：** 2026-07-24
- **范围：** 用户可配置 **有序** custom HTTP headers 注入 provider 请求；**禁止**覆盖保留认证头（Authorization、x-api-key 等闭集）；**诚实 User-Agent**；**拒绝** CLI 身份伪装头包；日志对 secret-looking 值脱敏。
- **相关：** [liveagent-worth-learning.md](../improvements/liveagent-worth-learning.md) §3.5 / Phase B、[ADR-0051](0051-provider-finish-reason-and-length-tool-rejection.md)、[ADR-0052](0052-provider-error-and-recovery-taxonomy.md)、[ADR-0057](0057-provider-bounded-retry-and-shared-budget.md)、[ADR-0125](0125-provider-overflow-patterns-and-silent-heuristics.md)、[ADR-0148](0148-presence-only-secret-boundary-sweep.md)、[ADR-0121](0121-improvements-adoption-closeout.md)、`AGENTS.md`、`SECURITY.md`
- **实现落点：** `src/shared/provider-custom-headers.ts`；`src/shared/teaching-types/settings.ts`（`customHeaders`）；`src/shared/teaching-settings-schema.ts`；`src/main/ai/provider-adapter/request-builder.ts`；`src/main/provider-connection.ts`（probe）；`src/main/teaching-ipc-commands.ts`（parse）；unit：`tests/unit/provider-custom-headers.unit.test.ts`

## 1. 背景

校园网关与 OpenAI-compat 中转常要求自定义头（路由、租户、追踪 id）。LiveAgent 以有序列表 + 保留键黑名单避免用户头撞官方 auth。

StudiumX 采纳同等能力时必须：**不**伪装成第三方 CLI；日志/DTO 不泄漏 header 中的密钥值（与 ADR-0148 presence 精神一致）。

## 2. 决策

### 2.1 有序 custom headers

| 规则 | 说明 |
| --- | --- |
| **形状** | 有序列表 `{ name, value }[]`（后写同名覆盖，大小写不敏感） |
| **来源** | `TeachingModelProviderProfile.customHeaders`；settings normalize 校验 |
| **边界** | 名称 token 规则、长度上限、禁止 CR/LF；非法项 drop |
| **空列表** | 规范化后省略字段 |

### 2.2 保留键黑名单

用户 custom headers **不得设置或覆盖**（大小写不敏感），至少：

- `Authorization`、`Proxy-Authorization`
- `x-api-key`、`api-key`、`api_key`
- `Cookie`、`Set-Cookie`、`Host`、`Content-Length`、`Transfer-Encoding`、`Connection`
- `User-Agent`、`WWW-Authenticate`、`Proxy-Authenticate`

冲突策略：**drop 用户侧保留键**（fail-closed），官方 adapter 注入的 auth 始终胜出。settings normalize 与 request merge **两处** enforcement。

### 2.3 User-Agent 与身份诚实

| 规则 | 说明 |
| --- | --- |
| **User-Agent** | 固定产品身份 `StudiumX/0.1.0`（`PROVIDER_PRODUCT_USER_AGENT`）；**禁止** 用户覆盖 |
| **反 spoof** | 拒绝 `X-Client-Name` / `X-Stainless-*` 等及值含 `claude-cli` / `openai-python` / `codex-cli` 等身份串的头包 |
| **日志** | `redactProviderCustomHeadersForLog` / `redactProviderHeaderMapForLog`：secret-looking 值 → `[redacted]` |

### 2.4 合并顺序

1. Base：`adapterAuthHeaders` / `providerProbeHeaders`
2. Custom：非保留、非 spoof、且不与 base 同名键冲突
3. User-Agent：产品固定值最后写入

### 2.5 红线

- 不把 custom headers 当默认 remote telemetry phone-home
- 不绕过 provider 隐私门禁
- 无 Shell / YOLO；无 FTS 产品搜索

## 3. 实现形状（已落地）

```text
src/shared/provider-custom-headers.ts
src/shared/teaching-types/settings.ts          # customHeaders?: { name, value }[]
src/shared/teaching-settings-schema.ts         # normalizeProviderCustomHeaders
src/main/ai/provider-adapter/request-builder.ts
src/main/provider-connection.ts                # probe merge
src/main/teaching-ipc-commands.ts              # parseProbeProviderPayload
tests/unit/provider-custom-headers.unit.test.ts
```

## 4. 与其它 ADR 的关系

| 文档 | 关系 |
| --- | --- |
| ADR-0052 / 0057 / 0125 | provider 错误与预算路径 **不变**；headers 为请求构建层 |
| ADR-0148 | 对外投影 / 日志 presence-only 精神一致 |
| ADR-0121 | 四源借鉴独立 ADR；本条为 Phase B 可实现项 |

## 5. 非目标

- 不实现独立 HTTP 中间件子系统
- Settings 完整 header 编辑器 UI 可后续薄层
- 不默认开启浏览器 CORS / 任意源放行式改写

## 6. 一句话

**有序 custom headers 友好校园/中转网关；保留键禁止覆盖 Authorization/x-api-key 等；诚实 User-Agent；拒绝 CLI 身份伪装头包。**
