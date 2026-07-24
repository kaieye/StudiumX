# ADR-0143：移动端远程控制（局域网默认 + 可选自建中继）

- **状态：** 已采纳（设计 + Phase 0/1 骨架实施中；全控制业务面分阶段）
- **日期：** 2026-07-24
- **范围：** 在 StudiumX 桌面端提供与 Zcode「Web 远程控制」**形态对齐**的手机浏览器控制面：工作区 / 会话列表、对话流、工具审批等；**传输默认局域网**，**可选用户配置的自建 WSS 中继**。
- **相关：** `AGENTS.md` 产品地板、`SECURITY.md`、`src/shared/features.ts`、`src/shared/web-remote-control/*`、`src/main/web-remote-control/*`；参考实现 `ref_project/Zcode`（只读）。

## 1. 背景

Zcode 通过云端 WSS relay（默认 `wss://zcode.z.ai/ws`）+ 移动页 + workspace host RPC 帧实现「手机控制桌面」。StudiumX 需要同类能力，但产品地板要求：

1. **本地优先**，无默认 phone-home / 远程 telemetry。
2. 工具仍走 **effect lattice + TOOL_CONTRACT + 三态审批**；禁止 YOLO / always-approve。
3. Secret 不进 public DTO / Doctor / support bundle。
4. Settlement sole-writer 与 `toolsReplayed: false` 不变。
5. 无默认 Shell 产品路径。

因此 **禁止** 默认依赖 Zcode 云；协议可 **兼容 Zcode 的 `zcode_type` 外壳** 以便自建 relay 对照，**rpc-frame 内载荷为 StudiumX Control RPC JSON**，不嵌入 Zcode host 二进制协议。

## 2. 决策

| 项 | 决策 |
| --- | --- |
| Feature id | `web-remote-control`，stage **`under_development`**（显式 opt-in；默认关） |
| 默认传输 | **LAN**：本机 `http` 托管 mobile 静态页 + `/ws` 配对 |
| 默认 bind | **`loopback`**；用户显式选择 `lan` 才绑定私网接口 |
| 可选中继 | `relayMode: external` 且用户填写 `externalRelayWsUrl`（及可选 mobile base URL）时才出站；**空默认** |
| 配对 | `deviceSid` + `passHash`；算法对齐 Zcode（`sha256(password)→base64`；proof = `HMAC-SHA256(passHash, nonce\|role\|deviceSid)` base64url）以便自建 relay 互通 |
| Secret | `passHash` 经 settings `safeStorage` 路径；status DTO **不含** passHash/password |
| 业务执行 | main 内 Control surface 调用现有 teaching/agent 服务（与 IPC gateway 同权路径）；**不**经 renderer IPC 转发 |
| 手机能力 v1 | 工作区 + 会话列表、对话读写/流式、cancel/steer/follow-up、工具审批；**无** Bot 通道、**无** SSH/WSL/Docker 远程 workspace 全链路 |
| 云 | **永不**默认填充 `zcode.z.ai` |

## 3. 威胁模型（摘要）

| 威胁 | 缓解 |
| --- | --- |
| 局域网嗅探 / 同网伪基站 | 默认 loopback；LAN 模式用户确认；配对 challenge-response；短时连接参数 `t` |
| 二维码 / 链接泄露 | 刷新配对清空 sid/hash 并踢会话；UI 提示 |
| External relay 中间人 | 仅用户 URL；建议 wss；不捆绑第三方默认 |
| 手机端“全权”绕过审批 | Control RPC allowlist；工具仍走 pending + answer；禁止 YOLO |
| Secret 外泄 | passHash 加密存储；日志/status 仅 sid 后缀；stream 镜像前 redaction |

## 4. 状态机（桌面 runtime）

`idle → starting → running → connecting → active | error`（与 Zcode 对齐语义）。

Transport（LAN 服务端视角）：等待手机 → authenticating → paired。

单窗口单 active pair；冲突 → `session-conflict` / kick。

## 5. 明确不包含（v1）

- 默认 Zcode 云 relay / 官方移动站。
- Bot Channel（微信/飞书/Telegram）。
- SSH/WSL/Docker 远程 workspace 桥。
- Shell / code-mode / always-approve。
- 自动 memory 注入或远程 telemetry。

## 6. 实施分期

| Phase | 内容 |
| --- | --- |
| 0 | 本 ADR、feature、settings 字段 |
| 1 | 协议类型、pairing-crypto、manager、LAN server、IPC status start/stop/reset |
| 2 | mobile SPA + Control RPC（列表/对话/流/审批） |
| 3 | external relay client |
| 4 | 桌面 Dialog/入口产品化、stage → experimental |

## 7. 验证

- 单元：pairing crypto、payload fail-closed、manager state。
- `pnpm run check:web-remote-control`、`check:security`（无默认外连新域名）。
- 手工：loopback/LAN pair、刷新配对吊销、工具审批不旁路。

## 8. 相关代码

```text
src/shared/web-remote-control/
src/main/web-remote-control/
src/shared/features.ts  # web-remote-control
docs/adr/0143-web-remote-control-lan-and-self-hosted-relay.md
```
