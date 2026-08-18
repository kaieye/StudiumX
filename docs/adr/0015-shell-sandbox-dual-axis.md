# ADR-0015：Workspace Shell 的 Sandbox 双轴

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** shell-security

## 背景

主流 Agent 需要在工作区运行命令，但“是否允许调用”和“操作系统如何约束进程”是不同问题。把审批关闭误写成 sandbox，或把应用级围栏宣称为 Docker/VM 隔离，会制造错误安全预期。

## 决定

- `workspaceShell` 默认可用；执行始终受具体 capability、工作区 trust、effect classification、path/cwd fence 与 argv spawn 约束。
- `approvalMode` 决定何时需要用户批准，`sandboxMode` 决定可用的执行约束；两轴独立，任一轴不能替代另一轴。
- shell 与 `run_workspace_command` 共享同一受控执行边界，不提供绕过 dispatcher、policy 或 audit 的备用入口。
- 不受支持或未配置的 OS helper 必须报告真实状态；应用级限制不得宣称具备 Docker/VM 级完整隔离。
- 产品文案不使用 YOLO、DangerFullAccess 或 always-approve；宽松审批仅描述为本课范围内的用户授权。

## 边界与后果

- shell 输出与退出状态不是 Teaching Evidence，也不自动授权后续写入。
- sandbox 不能替代 protected path、secret 边界或 settlement sole-writer。
- 新 OS helper 必须保持 fail-closed 探测与一致的双轴语义。
- 改变默认可用性、双轴含义或隔离声明需要新的 ADR。

## 实施锚点

- [Agent sandbox policy](../../src/main/ai/tools/agent-sandbox-policy.ts)
- [Workspace shell](../../src/main/ai/tools/workspace-shell.ts)
- [Shell security contract](../../tests/unit/agent-shell-security-contract.unit.test.ts)
