# ADR-0026：CourseDefinition 持久化与 Session 顺序权威

- **状态：** 已实施（P1-7；合入 main `2f83389` / feature `ef8b326`）
- **范围：** 每 Course 的 `course-definition.json`、lazy materialize、安全 repair、catalog Session 顺序
- **证据提交：** `ef8b326`、merge `2f83389`

## 决定

每个 Course 目录持有 durable `course-definition.json`（`COURSE_DEFINITION_SCHEMA_VERSION = 1`），记录稳定 `courseId`、Mission 链接、goals 与 **有序 Session 槽位**。**文件系统布局仍是 Lesson 可发现真相源**；CourseDefinition 只恢复 intentional order 与 status，**禁止**把 SQLite 或 catalog projection 当作 Course/Session 真相源。

`CourseDefinitionStore.read` **从不改写**文件系统；缺失/无效时可返回内存 materialize（lazy view）。`materialize` / `repair` 经既有 `.bak` durable publish 写入；dry-run 报告仅聚合字段，不嵌入 Mission 全文、learner answers 或 provider payloads。

Workspace catalog 在 definition 存在时，用 `orderSessionsByCourseDefinition` 恢复 intentional Session 顺序。

## 已实施范围与验证入口

- `src/main/course-definition-store.ts`
- `src/main/teaching-workspace-catalog.ts`（顺序消费）
- `scripts/check-course-definition-store.mjs`

```powershell
pnpm run check:course-definition-store
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/course-definition-store.unit.test.ts
```

## 不变量

- Read path 无副作用；repair 与 materialize 显式、可 dry-run。
- 报告与日志不泄露 Mission 正文 / learner content / provider payload。
- 不引入 SQLite-as-truth 或第二 Course registry。

## 不包含

- 不授权跨 Course 事务、云同步 Course 图谱或完整 curriculum planner 产品。
- 不把 definition 当作 LearningSession / Evidence / Outcome 的 settlement authority。
- 不替代 Lesson 文件系统发现与 placement 规则。
