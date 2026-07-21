# Database 验收总闸（活清单）

> 对应 [`database-roadmap.md`](./database-roadmap.md) **§8 验收总闸**  
> 本文件是 **任何 Database / LocalDataIndex / projection / usage ledger 相关 PR** 的合并前活清单。  
> 日期：2026-07-21  
> 状态：**强制 checklist**（文档权威；Blocking CI 仍保持窄门，不因本清单自动扩全量 suite）

相关：

- 边界与 P2 触发：[`database-p2-boundaries.md`](./database-p2-boundaries.md)
- 改造清单：[`database-roadmap.md`](./database-roadmap.md)
- 基线 ADR：0001 / 0002 / 0006 / 0027 / 0034 / 0038 / 0048 / 0050 / 0051
- 分层权威：[`database-authority-model.md`](./database-authority-model.md)
- 贡献入口：[`CONTRIBUTING.md`](../../CONTRIBUTING.md)

---

## 何时必须填写

PR 触及下列任一路径或主题时，作者与审查者须在 PR 描述中勾选本节闸门（可复制下方 Markdown）：

- `src/main/local-data-index/**`
- `studiumx-index.sqlite` / analytics adapter / projection schema migration
- usage / approval receipt / memory projection 相关持久化
- doctor / support-bundle 中与 index 诊断相关的输出
- `docs/improvements/database-*.md` 政策变更
- 任何「借鉴 Marvis / ZCode database」的实现 PR

纯文档 typo 且不改变闸门语义时，可在 PR 中声明 `Database-gates: n/a (docs typo only)`。

---

## 1. 六大强制闸（roadmap §8）

合并前必须 **全部为真**。每一项给出「如何证明」；不得只写「LGTM」。

### Gate 1 — Canonical 不变性

- [ ] **声明**：projection quarantine / rebuild / migration **不修改** JSON / JSONL / Memory 源文件字节（除该 PR 明确授权且有业务写入路径的变更）。
- [ ] **证明**：unit 或 integration 对比 quarantine/rebuild 前后 canonical 文件 bytes / checksum；或说明为何本 PR 不触及 rebuild 路径并指出既有测试仍覆盖。
- [ ] **拒绝**：借「索引优化」改写、搬迁或物理删除 canonical。

### Gate 2 — Drift 安全

- [ ] **声明**：source fingerprint / mtime / checksum 变更后，adapter **不得** 静默返回 `ready` 的 stale 数据。
- [ ] **证明**：存在覆盖 source drift → unavailable / rebuild 调度 / 文件回退 的测试，或本 PR 未改 currentness 逻辑且链接既有用例。
- [ ] **拒绝**：为了「体验顺滑」缓存过期 projection 而不标记 incomplete/unavailable。

### Gate 3 — 无秘密进索引

- [ ] **声明**：usage / projection / receipt / doctor / support-bundle **默认** 不落 API key、raw prompt、完整 tool 敏感 args、未脱敏绝对路径（政策允许的 digest 除外）。
- [ ] **证明**：schema 字段审查说明 + 相关 redaction 测试 / `check:security` 仍适用；新增列有 allowlist 注释。
- [ ] **拒绝**：调试方便把 prompt 正文或密钥写入 SQLite。

### Gate 4 — 失败可降级

- [ ] **声明**：native `better-sqlite3` 不可用、migration 冲突、或 index `unavailable` 时，**产品主路径仍可用**（文件扫描 / 跳过 analytics / doctor 可读错误）。
- [ ] **证明**：fallback 测试或手动矩阵说明；CI 在 native 缺失环境不把主路径打成硬失败（除非该 PR 明确只修 native 构建）。
- [ ] **拒绝**：index 成为打开 workspace 或完成 turn 的硬依赖。

### Gate 5 — 政策对齐

- [ ] **声明**：不引入 analytics 库 FTS 产品面；不引入 canonical 物理删除（age/size）；不绕过工具 effect lattice；不把 SQLite 当教学/会话**写权威**（projection 优选读路径允许；见 authority model）。
- [ ] **证明**：对照 [`database-p2-boundaries.md`](./database-p2-boundaries.md)；若触及 P2 能力，必须有 **已合并** 新 ADR 链接，否则标为 won't-do / out-of-scope。
- [ ] **拒绝**：DB-P2-1/2/3/4 的 forbidden 实现（见边界文档拒绝信号）。

### Gate 6 — 测试

- [ ] **声明**：unit + 必要 integration；涉及 migration 时覆盖 checksum 冲突。
- [ ] **证明**：列出命令与结果（至少 targeted vitest；推荐 `pnpm run test:unit -- tests/unit/local-data-index.unit.test.ts` 或本 PR 对应文件）。
- [ ] **拒绝**：仅改 production 无测试、或只靠手动点一点。

---

## 2. PR 描述可复制块

```markdown
### Database acceptance gates (roadmap §8)

- [ ] Gate 1 Canonical immutability — evidence: …
- [ ] Gate 2 Drift safety — evidence: …
- [ ] Gate 3 No secrets in index — evidence: …
- [ ] Gate 4 Degrade on failure — evidence: …
- [ ] Gate 5 Policy alignment (no analytics FTS / no canonical purge / no SQLite teaching write-SoT / effect lattice / authority model) — evidence: …
- [ ] Gate 6 Tests (unit + migration checksum if touched) — evidence: …

P2 boundary check (see docs/improvements/database-p2-boundaries.md):
- [ ] Does **not** implement DB-P2-1 vector memory without new ADR
- [ ] Does **not** implement DB-P2-2 FTS/Tantivy without new ADR overriding ADR-0001
- [ ] Does **not** implement DB-P2-3 SQLite teaching/session **write** source-of-truth (won't do; runtime store needs separate ADR)
- [ ] Does **not** implement DB-P2-4 workflow-run tree store without trigger + new ADR
```

---

## 3. 审查速查（reviewer）

| 问题 | 期望答案 |
| --- | --- |
| 写权威是文件还是 SQLite？ | **写权威=文件**（教学/正文/ledger）；list/analytics 可读 projection |
| 损坏 index 怎么办？ | quarantine + rebuild；canonical 不动 |
| native 挂了？ | 主路径仍可用 |
| 有搜索/向量/workflow 入库吗？ | 默认否；有则要新 ADR + 本清单全绿 |
| 有 secret/prompt 进投影吗？ | 否 |

---

## 4. 与 CI 的关系

| 层 | 作用 |
| --- | --- |
| 本清单 | 人工 + PR 模板约束；政策权威 |
| `tests/unit/database-pr-gates.unit.test.ts` | 锁定本文件与 P2 边界文档关键条款仍存在 |
| `pnpm run check:security` 等 | 既有隐私/路径硬门；不替代本清单 |
| Blocking CI | 保持窄门（ADR-0023 / 0045）；**不**因本清单自动跑全量 database suite |

---

## 4.5 优化 backlog 指针

下一波实现优化请引用 [`database-roadmap.md`](./database-roadmap.md) §6.5 / [`database-authority-model.md`](./database-authority-model.md) 的 **DB-OPT-***，仍须勾选本节六闸。

## 5. 维护规则

1. roadmap §8 与本文件冲突时，**以本文件为活清单**，并在同一 PR 回写 roadmap §8 摘要与变更记录。
2. 新增第 7 条闸门时：更新本文件、roadmap §8、单元测试断言、PR 模板指针。
3. 不得删除六大闸；只能收紧或拆分子检查项。

## 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-21 | 初版：将 roadmap §8 落成可勾选活清单 + PR 复制块 |
| 2026-07-21 | 修订：Gate 5/审查速查对齐分层权威；P2-3 明确为写权威拒绝 |
