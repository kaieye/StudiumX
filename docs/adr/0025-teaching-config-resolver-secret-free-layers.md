# ADR-0025：TeachingConfigResolver 分层无密钥快照

- **状态：** 已实施（P1-4；合入 main `a6072a1` / feature `a21de1b`）
- **范围：** 教学闭环配置分层解析、字段级来源、密钥剥离与可解释诊断
- **证据提交：** `a21de1b`、merge `a6072a1`

## 决定

教学闭环配置由 `TeachingConfigResolver` 从既有 settings 文档投影，优先级（低 → 高）：

`default < user < workspace < session_override`

解析结果为 **secret-free** 的 `ResolvedTeachingConfig`：`apiKey` 与 web-search provider key 等密钥路径被剥离并记为 `secret_stripped` 诊断，**永不**进入普通 resolved snapshot。解析器不做文件系统 I/O；调用方负责加载已有 settings / overlay。

无效层或无效字段产生 diagnostics 并跳过，不半应用整层文档。`fingerprintTeachingConfig` 对 secret-free value 做确定性 `sha256`，供变更检测使用。

## 已实施范围与验证入口

- `src/main/teaching-config-resolver.ts`
- `tests/unit/teaching-config-resolver.unit.test.ts`

```powershell
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/teaching-config-resolver.unit.test.ts
```

## 不变量

- 普通 snapshot 不含 provider / web-search API keys。
- 字段来源可解释（`TeachingConfigFieldSource`）；覆盖可审计。
- Resolver 不是第二 settings store，也不建立独立 secret storage。

## 不包含

- 不授权新 runtime、第二 provider 产品路径或云同步配置面。
- 不替代 `check:settings-secret-storage` / 既有 secret storage 边界。
- 不把 session_override 扩张为任意 prompt 旁路。
