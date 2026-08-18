# ADR-0006：Secret-free 配置与主进程解析

- **状态：** accepted
- **日期：** 2026-08-18
- **领域：** configuration-security

## 背景

配置来自默认值、用户设置、工作区与受管策略，但 provider key、OAuth token 和注入的 header 不能随公共配置在 renderer、诊断或日志中传播。分层覆盖也必须避免静默丢失并发修改。

## 决定

- 公共配置模型只保存 secret reference 或存在性状态，不保存明文 secret、token 或解析后的敏感 header/env。
- secret 只在主进程、最接近使用点的位置解析；renderer/preload IPC 只能获得 allowlisted、secret-free DTO。
- 配置层按明确优先级合并，受管策略与 denylist 可以收窄能力；工作区配置不能覆盖受保护安全字段。
- 可写配置使用 revision / compare-and-set 语义；冲突显式返回，不采用静默 last-write-wins。
- Doctor、support bundle、日志与 audit metadata 只报告脱敏状态，不回显 secret 值。

## 边界与后果

- “已配置”只表示引用可解析，不证明 provider 或远端服务可用。
- 环境变量和系统凭据存储仍属于 secret 来源，不因此成为公共配置。
- 新配置来源必须定义 provenance、优先级、可写性与 secret 处理边界。
- 改变 secret 所在进程或公共 DTO 范围需要新的 ADR。

## 实施锚点

- [TeachingConfigResolver](../../src/main/teaching-config-resolver.ts)
- [安全边界](../../SECURITY.md)
- [Provider privacy 检查](../../scripts/check-provider-privacy.mjs)
