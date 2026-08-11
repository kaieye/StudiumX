# 安全与隐私对比

## 1. 权限模型

### IMA Copilot：Chrome 扩展权限模型

IMA 的 24 个扩展各自申请权限，**权限范围非常广泛**：

| 权限 | 使用扩展数 | 风险等级 |
| --- | --- | --- |
| `<all_urls>` / `*://*/*` | 5 | 高：可访问所有网页 |
| `cookies` | 24（全部） | 高：可读取所有 Cookie |
| `webRequest` | 21 | 高：可拦截网络请求 |
| `imaFrame` | 23 | 中：原生桥接（自定义） |
| `fileSystem` | 22 | 中：文件系统访问 |
| `clipboardRead/Write` | 22 | 低：剪贴板 |
| `scripting` | 22 | 中：可注入脚本 |
| `contextMenus` | 22 | 低 |
| `background` | 21 | 中：后台运行 |
| `debugger` | 1（copilot） | 高：可调试页面 |
| `management` | 7 | 中：可管理其他扩展 |
| `proxy` | 1（设置） | 中：代理配置 |
| `tabGroups` | 1（copilot） | 低 |
| `downloads` | 2 | 中 |

**关键安全特征：**
- **所有扩展都申请 `cookies` 权限**：可读取所有网站的 Cookie
- **copilot 扩展有 `debugger` 权限**：可附加到任意标签页，提取页面内容
- **`<all_urls>` 在 5 个扩展中**：无 URL 限制
- **externally_connectable 白名单**：23 个扩展 ID 互相可通信
- 权限模型基于 Chrome 的声明式权限，用户在安装时无法选择性授权

### StudiumX：Effect Lattice + 审批策略

StudiumX 的安全模型是**多层防御**：

```
工具请求 -> Effect 分类（read / workspace_write / external_write / privileged）
         -> 审批策略（sandboxMode × approvalMode 双轴）
         -> 路径围栏（path-access.ts）
         -> 沙箱（workspaceShell / DangerFullAccess）
         -> ToolOutcome 结算
```

**关键安全特征：**
- **effect lattice 三态审批**：`read` 自动放行，`workspace_write` 需审批，`external_write`/`privileged` 严格审批
- **禁止 YOLO / always-approve 标签**
- **路径围栏**：`path-access.ts` 限制文件访问范围
- **沙箱双轴**：`sandboxMode`（沙箱开关）× `approvalMode`（审批模式）
- **settlement sole-writer**：唯一写入路径
- **`expectedRevision` 乐观并发**：防止并发写入冲突
- **fail-closed**：未知工具直接失败关闭
- **密钥隔离**：API key 不进 Git / public DTO / Doctor / 支持包

**对比结论：** IMA 的权限模型是**宽授权型**（所有扩展都有 cookies/webRequest 等高危权限），StudiumX 的权限模型是**最小授权型**（每个操作都经过 effect 分类和审批）。StudiumX 的安全边界**显著优于** IMA Copilot。

---

## 2. 数据归属与传输

### IMA Copilot：云优先 + 远程遥测

```
文件 -> 腾讯云 COS（对象存储）
会话 -> 服务端数据库
错误 -> galileotelemetry.tencent.com（远程上报）
配置 -> 本地 Preferences + 云同步
IM 消息 -> ImSDKForMac_Plus.framework -> 微信
```

**遥测行为（从 injected-script.js 分析）：**

```javascript
// 全局错误捕获，自动上报到腾讯遥测
fetch('https://galileotelemetry.tencent.com/collect', {
  body: JSON.stringify({
    topic: 'SDK-8252ca67359fbfb43771',
    data: [{
      message: JSON.stringify({ msg: message, level, timestamp: Date.now() }),
      fields: JSON.stringify({ id: reportId, env: 'production', guid, q36, qua }),
      timestamp: Date.now(),
    }]
  }),
  method: 'POST',
});
```

**关键隐私问题：**
- **默认远程错误上报**：`galileotelemetry.tencent.com`，包含设备 ID（guid, q36, qua）
- **文件上传到云**：知识库文件存储在腾讯 COS
- **账号绑定**：`onAccountInfoChange` 事件，腾讯账号体系
- **IM SDK 集成**：可导入微信聊天记录
- **Service Worker 缓存**：81 个 Web 脚本缓存在本地

### StudiumX：本地优先 + 无默认遥测

```
教学事实 -> 工作区文件（MISSION.md / RESOURCES.md / 课程 / 记录）
         -> LearningSession Ledger（JSONL）
         -> SQLite 投影（不取代文件权威）

工具执行 -> 本地 Node.js 进程
配置 -> 本地安全存储（密钥隔离）
诊断 -> Doctor（脱敏输出）
支持包 -> 预览 + 同意 -> 脱敏导出
```

**关键隐私特征：**
- **不静默上传**：无 phone-home / Statsig / Mixpanel 式外发
- **不默认上传遥测**：`check:analytics` 是本地学习分析测试，不是远程遥测
- **Doctor 脱敏**：`pnpm doctor -- --json` 输出脱敏诊断
- **支持包同意**：预览后经同意才脱敏导出
- **crash marker 本地**：ADR-0066 本地崩溃标记
- **密钥永不外泄**：secret/token 永不进 public DTO / Doctor / 支持包

**对比结论：** 在隐私方面，StudiumX **显著优于** IMA Copilot。IMA 默认远程上报错误和设备信息，文件存储在云端。StudiumX 完全本地优先，无默认遥测。

---

## 3. 沙箱与隔离

### IMA Copilot：Chromium 多进程隔离

- Chromium 原生多进程隔离（renderer sandbox）
- 扩展运行在独立的扩展进程
- `HTML沙箱` 扩展（`ocabijiofglkcngiibeoenlbhgaffkki`, v5.4.0）专门用于沙箱执行
- 但 `debugger` 权限可绕过 renderer 隔离

### StudiumX：Electron + 工具沙箱

- Electron renderer 隔离（contextIsolation + nodeIntegration: false）
- `agent-sandbox-policy.ts`：Agent 沙箱策略
- `codex-sandbox-transform.ts`：Codex 沙箱转换
- `shell-command-safety.ts`：Shell 命令安全检查
- `shell-env-scrub.ts`：Shell 环境变量清洗
- `shell-hardline.ts`：Shell 硬限制
- `tool-policy-fs.ts`：工具文件系统策略
- ADR-0152/0153：工作区 shell + 沙箱双轴

**对比结论：** IMA 依赖 Chromium 原生沙箱（成熟但不可控），StudiumX 有自研的工具级沙箱策略（更细粒度但需要持续维护）。两者各有优势。

---

## 4. 密钥与敏感数据管理

### IMA Copilot：服务端鉴权

- 用户通过腾讯账号登录（`ImaFrame.HandleLogin`）
- API key 在服务端管理，前端不接触
- `Secure_Preferences.json`（105KB）存储扩展配置
- COS 上传凭证由服务端临时签发

### StudiumX：本地安全存储

- API key 存储在本地安全存储（Keychain / DPAPI）
- `provider-connection.ts`：提供商连接管理
- `proxy-fetch.ts`：代理请求
- `provider-adapter/`：提供商适配（不暴露密钥）
- managed overlay（校/团级免密钥配置注入）
- `agent-secret-redaction.ts`：密钥脱敏
- `learner-profile-record-policy.ts`：学习者档案记录策略

**对比结论：** IMA 的服务端鉴权对用户更**无感**（不碰 API key），StudiumX 的本地存储对用户更**自主**（完全控制密钥）。这是产品定位差异。

---

## 5. 安全检查与验证

### StudiumX 独有：领域安全检查套件

StudiumX 有 166 个检查脚本，形成多层安全验证：

| 检查 | 命令 | 说明 |
| --- | --- | --- |
| 安全全套 | `check:security` | 含 external-content boundary |
| 工具契约 | `check:tool-contract` | 注册表漂移检测 |
| 教学证据 | `check:teaching-evidence` | P0 教学证据链门禁 |
| 教学 IPC | `check:teaching-ipc-contract` | IPC 契约 |
| 路径访问 | `check:path-access` | 路径围栏 |
| Provider 隐私 | `check:provider-privacy` | 提供商隐私 |
| 教学影响 | `check:teaching-impact` | PR 路径敏感元数据 |
| 发布审计 | `audit:release` | 发布前重审计 |

**IMA Copilot 无对应物**：IMA 没有公开的安全检查或领域门禁体系。

**对比结论：** StudiumX 的安全验证体系是**行业领先**的，IMA Copilot 无法与之相比。
