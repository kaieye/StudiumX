# ADR-0072：Node engines / .nvmrc 与 SOURCE_REV 构建身份

- **决策状态：** accepted
- **实施状态：** complete
- **实施说明：** 已实施（ADOPTION S-12）
- **日期：** 2026-07-21
- **范围：** 声明 Node 运行时主线、纯本地 `SOURCE_REV` 构建身份，以及 doctor 非阻塞展示
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0027](0027-read-only-teaching-doctor-and-workspace-inspector.md)、[ADR-0034](0034-redacted-support-bundle.md)、[ADR-0066](0066-local-observability-and-crash-marker.md)、[ADOPTION S-12](0121-improvements-adoption-closeout.md)
- **证据：** 
  - `.nvmrc`
  - `package.json`（`engines.node`）
  - `src/shared/build-identity.ts`
  - `scripts/lib/doctor-snapshot.mjs`（identity 行）
  - `tests/unit/build-identity.unit.test.ts`

## 背景

仓库此前没有根 `.nvmrc` 与 `package.json#engines`，本地 Node 与 CI 的 22.x 约定仅散落在 workflow。支持诊断也缺少**离线**可复现的源码修订标签，容易把“跑了哪一版”混成口头说明。

S-12 要求把 Node 身份写死为可机读约定，并提供 fail-closed 的 `SOURCE_REV`（或等价）身份，供 doctor / support 本地展示——**不**引入 phone-home，也**不**把身份系统做成供应链全量 SBOM。

## 决定

### 1. Node 主线：major 22

| 落点 | 值 | 理由 |
| --- | --- | --- |
| `.nvmrc` | `22` | 与 CI `node-version: '22.x'` 对齐；不钉死 patch，避免本地与 Actions 次要漂移时误伤 |
| `package.json` `engines.node` | `>=22 <25` | 声明工具链 / 脚本期望；允许 22–24 开发，拒绝 Node 20 及更早；不为 Electron 产品 runtime 另开矩阵 |

点验证据（实施时）：

- `.github/workflows/blocking-ci.yml`、`contained-durable-replace-linux.yml`、`main-release-audit.yml`、`release_dispatch.yml` 均为 `node-version: '22.x'`
- 本 ADR **不**改动 Electron 版本矩阵，也不把 Electron 内嵌 Node 与 host tooling Node 混为一谈

### 2. `SOURCE_REV` 身份（纯函数、fail-closed）

`src/shared/build-identity.ts` 导出：

- `readBuildIdentity(env?) → { sourceRev: string; nodeEngine?: string }`
- 解析顺序（仅 env，不 `git` shell、不网络）：
  1. `SOURCE_REV`（显式构建注入）
  2. `GITHUB_SHA`（CI）
  3. `GIT_DESCRIBE`（可选构建期预计算标签）
  4. 稳定占位 `unknown`
- 消毒：长度上限、拒绝绝对路径 / `..` / URL / 空白与非白名单字符；失败不抛、回落 `unknown`
- `nodeEngine` 默认回落 `>=22 <25`（与 `engines` 一致）

### 3. Doctor 非阻塞展示

`scripts/lib/doctor-snapshot.mjs` 在 `app` 节合并 `sourceRev` / `nodeEngine`，并在文本报告 `app:` 行追加身份片段。  
**不**改变 readiness / exit code 语义；缺省 `unknown` 不构成 doctor failure。

## 已实施范围与验证入口

```powershell
CI=true pnpm exec vitest run --project unit tests/unit/build-identity.unit.test.ts
pnpm run check:doctor
```

## 不变量

- 本地优先：无默认远程 telemetry / phone-home / 自动版本上报。
- 身份字段不含 secrets、可避免的绝对用户路径。
- Unknown 不抛、不阻断 doctor 或启动。
- Node engines 声明工具链期望，**不是** Electron 嵌入运行时矩阵。

## 不包含 / non-claims

- **不是** 完整 SBOM / SPDX / 依赖图导出。
- **不是** 发布签名、公证、或可验证 build provenance（SLSA 等）。
- **不是** 强制 `engine-strict` 安装策略或 nvm 强制钩子。
- **不** 重写 CI matrix / Actions Node 钉 pin（S-06 另项）；本 ADR 只对齐既有 `22.x`。
- **不** 在 doctor 中自动 `git describe` 或访问网络取 rev。
- **不** 修改 Electron 主版本或 native 重建策略。
