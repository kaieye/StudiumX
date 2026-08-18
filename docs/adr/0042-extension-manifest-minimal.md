# ADR-0042：最小 ExtensionManifest（本地安装优先）

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-21
- **范围：** 声明式 extension/plugin manifest 类型（schemaVersion=1）+ 本地 fail-closed 校验；local-install first，无 marketplace / 远程 auto-trust。
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0046](0046-teaching-footprint-ladder.md)、[ADR-0040](0040-teaching-session-protocol-facade.md)
- **证据：** `src/shared/teaching-types/extension-manifest.ts`、`tests/unit/teaching-session-protocol.unit.test.ts`（manifest guard）

## 决定

引入最小 **ExtensionManifest**（schemaVersion=1）：id/name/version + 可选 contributions（skills/commands/hooks/mcpServers/lessonStylePacks/resourceGrounders）与 userConfig 字段描述。

**Local-install first**：无 marketplace、无远程 auto-trust。`isExtensionManifest` 做 fail-closed 校验。loaders 保持关闭，直到各自 contribution kind 通过独立 design gate。

## 已实施范围与验证入口

- `src/shared/teaching-types/extension-manifest.ts`
- barrel export via `src/shared/teaching-types.ts`
- `tests/unit/teaching-session-protocol.unit.test.ts`（manifest guard）

```powershell
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/teaching-session-protocol.unit.test.ts
```

## 不变量

- 敏感 userConfig 字段不得进入 logs/doctor evidence/support bundles。
- 未获 design gate 的 contribution 不得自动加载。

## 不包含

- 不授权 marketplace、远程插件自动信任、MCP auto-connect。
- 不实现完整 skill 多根发现 / hooks bus / slash commands（Phase B）。
