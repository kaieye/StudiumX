# StudiumX 产品指南

StudiumX 是面向 **本地教学工作区** 的 Electron 应用。磁盘上的文件是 mission、lesson、资源与学习记录的真相源；应用负责索引、生成与预览，而不是用云库替换文件。

## 首次运行清单

1. 安装 Node 22+，启用 Corepack（`corepack enable`），执行 `pnpm install`。
2. 启动桌面端：`pnpm dev`。
3. 在「设置」中配置模型提供方（API 密钥走平台密钥存储；**不要**把密钥写进仓库或工作区示例文件）。
4. 打开或创建教学工作区文件夹（将容纳 `MISSION.md`、课程、资源与学习记录）。
5. 可选：配置网页搜索/抓取类工具（仍勿把密钥写进工作区文件）。
6. 诊断：`pnpm doctor -- --json --no-checks`（提交 issue 时可附带 posture 段）。

## 打开工作区 → 第一节课

1. 打开本地教学工作区。
2. 写清 **Mission** 的可观察成功标准。
3. 通过教学对话或 Lesson 生成入口产出第一节短小 HTML Lesson。
4. 在工作台审阅与保存；早期课尽量包含一次明确检索练习。
5. 之后从 ledger 支持的会话恢复入口 resume（不要把 Agent run 状态机当作学习过程真相）。

## 恢复、记录与支持包

- **学习结果 / outcome** 仅经 evidence-gated 宿主路径结算；agent 循环不是 settlement 权威。
- **支持包**须同意后导出且脱敏（ADR-0034）。日常粘贴诊断优先 `pnpm doctor`。
- Doctor 的 **runtime posture** 会汇总审批模式、工具开关、代理是否启用、密钥存储形态，并明确 shell / MCP 市场未产品化。

## 明确不做

- 默认不提供 shell / 任意代码执行。
- 默认不开放 MCP 插件市场。
- 默认无自动遥测与 crash 上传。
- 不做 SQLite FTS 产品搜索（ADR-0001）。

## 延伸阅读

| 文档 | 用途 |
| --- | --- |
| `docs/GUIDE.md` | 英文产品指南 |
| `docs/CONFIG_PATHS.md` | 配置与密钥路径 |
| `docs/adr/README.md` | 架构决定（权威） |
| `SECURITY.md` | 信任模型 |
| `docs/testing.md` | 测试教义 / pre-push |
| `docs/tools/TOOL_CONTRACT.md` | 工具合同 |
| `CONTRIBUTING.md` | 贡献入口 |
| `studiumx-settings.example.json` | 无密钥设置示例 |
