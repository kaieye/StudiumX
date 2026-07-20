# StudiumX P0 发布完成证明执行计划

> **文档状态：** P0 已实施模块的剩余 release-closure 计划；不是功能待实施清单，也不是完成声明。
>
> **基线确认日期：** 2026-07-19
>
> **唯一事实来源：** `main` 的已合入提交、可执行自动化和已沉淀 ADR。产品文件仍是运行时教学事实的来源；本文只规定尚未满足的发布证明。

---

## 1. 已实施基线（不在本计划重复维护）

所有完成内容已经从本计划移除，并以 [ADR 索引](../adr/README.md) 中 ADR-0008 至 ADR-0016 作为范围、不变量和 Git 证据的权威记录。本文件不再维护实现包、合入提交或已通过测试的完成清单。

因此，原先用于描述功能实现的 work package 不再作为可领取事项；下文仅保留尚未关闭的发布证明。

## 2. 当前阻塞：为什么仍不能声称 P0 发布完成

### 2.1 失效的 committer 交付 gate

以下静态脚本匹配重构前的实现形态，当前失败；不能把失败脚本当作已通过的 P0 证明：

```powershell
node scripts/check-learning-outcome-committer.mjs
node scripts/check-learning-outcome-recovery.mjs
node scripts/check-learning-record-read-repair.mjs
```

它们必须替换为覆盖当前 writer-lock scope、ordered publish、authority-first reconcile/read-repair 语义的等价或更强检查。仅修改正则以让命令变绿不足；新 gate 必须有正例、负例和与 unit/integration 的互补边界。

### 2.2 全量 integration 与干净 checkout 尚未证明

`pnpm run test:integration` 在本次 Windows 审计中并非全绿，并有被跳过的 suite。必须逐项在干净 checkout 中确认：

- 属于产品或测试回归的失败必须最小修复并增加回归覆盖；
- 属于平台缺少能力或环境基础设施的问题必须显式建模、受控隔离，并在目标发布环境获得可执行证据；
- 不得通过 `skip`、删除测试或污染开发 workspace 来宣称通过。

此外，需要留存全量发布命令结果、review、handoff、风险和 final integration hash；当前本地 Git 历史本身不足以证明每个包都具备计划要求的交接材料。

### 2.3 真实纵向 Electron Golden 与 crash/restart 未证明

现有 `tests/e2e/teaching-learning-loop.e2e.spec.ts` 使用真实 Electron 窗口验证 learner presentation、键盘、语义状态和 redaction，但其输入是硬编码 snapshot。它不是完整的 evidence → preload/IPC → committer → canonical files → catalog → restart 路径。

剩余 E2E 必须：

1. 从真实 preview/review 输入提交 Evidence；
2. 经实际 preload / IPC 触发 outcome commit；
3. 断言 canonical outcome / Learning record、catalog reconciliation 和 UI 对同一 identity 一致；
4. 在 artifact rename 后/catalog 更新前，以及 staged publish 后/最终 publish 前注入故障；
5. 终止并重启真实 main/Electron process，再验证 read-repair、幂等 operation 和 learner-safe presentation；
6. 重复运行三次排查 flaky。

## 3. 严格 closure 顺序与写域

```text
1. 回写失效 static gate，并保留/加强定向 unit + integration
2. 解决或受控隔离全量 integration 的失败与 skip
3. 新增真实纵向 Electron Golden 和真实 crash/restart injection
4. 在干净 checkout 执行完整发布审计与 repeat-each=3
5. 记录 review/handoff/风险/最终 hash，才可关闭 P0
```

默认写域仅为相关 checker、tests/fixtures/harness、必要的 platform compatibility 或 CI 记录。若发现已实施深模块存在真正产品缺陷，可做最小修复，但必须在对应 ADR 的边界内，且不得搭载 P1/P2 重构。

## 4. 可复制的现有命令与最终门

Playwright 的可执行参数顺序如下：

```powershell
pnpm exec playwright test tests/e2e/teaching-learning-loop.e2e.spec.ts --project=electron-e2e
pnpm exec playwright test tests/e2e/teaching-learning-loop.e2e.spec.ts --project=electron-e2e --repeat-each=3
```

这些命令在现状下仅覆盖 presentation/a11y harness；完整纵向测试完成后，发布审计至少应在干净 checkout 执行：

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test:unit
pnpm run test:integration
pnpm run build
pnpm run check:security
pnpm run check:provider-privacy
pnpm run check:settings-secret-storage
pnpm run check:repository-hygiene
pnpm run check:agent-run-recovery
pnpm run check:agent-operation-idempotency
pnpm run check:workspace-write-tool
pnpm run check:web-fetch-safe-url
pnpm run check:external-link-controls
node scripts/check-workspace-catalog-reconciliation.mjs
node scripts/check-teaching-learning-loop.mjs
pnpm exec playwright test tests/e2e/teaching-learning-loop.e2e.spec.ts --project=electron-e2e --repeat-each=3
git diff --check
```

任何失败、未解释 skip、不可复制命令、隐私/安全回归、canonical/catalog/UI 不一致、重复 record 或不确定写入自动重试都阻塞 P0 发布完成声明。

## 5. 完成声明

只有所有第 2 至第 4 节的门关闭，才可以表述“P0 发布完成”。在此之前，唯一准确表述是：**P0 教学领域模块已实施；发布级 gate、真实 Electron crash/restart Golden 和干净 checkout 全量审计仍待证明。**

---

## 6. Closure evidence (2026-07-20)

Win/Mac P0 release proof closed at `a797f07a65ed7a598bb96d1666e496fcf0275f67`.

- Clean audit: [docs/release/p0-clean-checkout-audit-2026-07-20.md](../release/p0-clean-checkout-audit-2026-07-20.md) (`passed: true`)
- Handoff / risks: [docs/release/p0-release-handoff-2026-07-20.md](../release/p0-release-handoff-2026-07-20.md)
- Skip inventory: [docs/release/p0-windows-platform-skip-inventory.md](../release/p0-windows-platform-skip-inventory.md)
- Manifest (host path): `D:\release-evidence\p0-clean-checkout-audit.json` SHA-256 `e1802af6d0b80a53a982fb3309adc2ea93773ec1bee5b9c02cbb5be56dcd75e4`
- Tip re-audit at 7aa205fa2337d8290038274046f4f97118b635db: passed: true (D:\\release-evidence\\p0-clean-checkout-audit-tip.json)
